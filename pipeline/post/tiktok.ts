/**
 * TikTok. Read this before believing the word "posted".
 *
 * Until the app passes TikTok's content-posting audit, the API cannot publish
 * anything publicly. What it CAN do is push the file into the account's inbox
 * as a draft, which then has to be opened in the TikTok app and published by
 * hand. That is what this does, and it reports `drafted`, never `posted`.
 * Anything that claims otherwise is lying to the owner about whether a reel
 * went out. See DECISIONS.md 2026-08-24.
 *
 * The direct-publish endpoint is deliberately not wired up: an unaudited app
 * calling it is forced to SELF_ONLY, so it would produce a private post that
 * looks published in the logs and is invisible to everyone.
 *
 * TikTok rotates the refresh token on every use, so the new one is written
 * back to .env.local immediately.
 */
import '../env';
import { readFileSync, statSync } from 'node:fs';
import { requireEnv, setEnvLocal } from '../env';
import { now, type PostInput, type Poster } from './types';

const API = 'https://open.tiktokapis.com/v2';

async function accessToken(): Promise<string> {
  const res = await fetch(`${API}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: requireEnv('TIKTOK_CLIENT_KEY'),
      client_secret: requireEnv('TIKTOK_CLIENT_SECRET'),
      grant_type: 'refresh_token',
      refresh_token: requireEnv('TIKTOK_REFRESH_TOKEN'),
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!data.access_token)
    throw new Error(`TikTok token refresh failed: ${data.error_description ?? data.error ?? 'no token'}`);
  // Rotated on every redemption. Losing it means authorising by hand again.
  if (data.refresh_token && data.refresh_token !== process.env.TIKTOK_REFRESH_TOKEN)
    setEnvLocal('TIKTOK_REFRESH_TOKEN', data.refresh_token);
  return data.access_token;
}

export async function pushDraft(input: PostInput): Promise<{ id: string }> {
  const token = await accessToken();
  const size = statSync(input.mp4).size;

  // One chunk: TikTok allows a single chunk to be the whole file up to 64MB,
  // and a reel is single-digit megabytes.
  const init = await fetch(`${API}/post/publish/inbox/video/init/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 },
    }),
  });
  const initBody = (await init.json()) as {
    data?: { publish_id: string; upload_url: string };
    error?: { code: string; message: string };
  };
  if (!initBody.data?.upload_url)
    throw new Error(`TikTok init → ${initBody.error?.message ?? init.status} (${initBody.error?.code ?? '?'})`);

  const put = await fetch(initBody.data.upload_url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(size),
      'Content-Range': `bytes 0-${size - 1}/${size}`,
    },
    body: readFileSync(input.mp4) as unknown as BodyInit,
  });
  if (!put.ok) throw new Error(`TikTok upload → ${put.status} ${(await put.text()).slice(0, 200)}`);

  return { id: initBody.data.publish_id };
}

export const tiktok: Poster = {
  name: 'tiktok',
  needs: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REFRESH_TOKEN'],
  post: async (input) => {
    const { id } = await pushDraft(input);
    return {
      state: 'drafted',
      at: now(),
      id,
      note: 'in your TikTok inbox as a draft. Open the app, add the caption from this message, publish. The API cannot post publicly until the app is audited.',
    };
  },
};
