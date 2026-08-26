/**
 * Facebook Reels, published to the SMB Solved Page.
 *
 * Three phases: open an upload session on the Page, send the bytes to
 * rupload.facebook.com (a different host from the Graph API, which is easy to
 * miss), then finish and publish. No public URL needed, unlike Instagram: the
 * file is uploaded rather than fetched.
 *
 * Auth is a PAGE access token, not a user token, and the difference is the
 * whole trap here. A user token carries the same three permissions, looks
 * identical in .env.local, and cannot post to anything. `assertPage()` checks
 * it up front and says so plainly rather than failing three calls later. Get
 * the right one with `npm run authorize -- facebook`.
 *
 * A Page token derived from a long-lived user token does not expire, so unlike
 * LinkedIn there is nothing to renew.
 *
 * Requirements met by every reel we render: 9:16, 1080x1920, 3-90s, H.264.
 */
import '../env';
import { readFileSync, statSync } from 'node:fs';
import { requireEnv } from '../env';
import { postBody, now, type PostInput, type Poster } from './types';

const version = () => process.env.FACEBOOK_API_VERSION?.trim() || 'v25.0';
const graph = () => `https://graph.facebook.com/${version()}`;

type Identity = { id: string; name: string };

/**
 * Confirms the token is a Page token for the Page we mean to post to.
 *
 * With a Page token, /me IS the Page. With a user token, /me is the person,
 * and `/me/accounts` is where the Page tokens live. Telling them apart here
 * turns a baffling permissions error into one sentence.
 */
export async function assertPage(): Promise<Identity> {
  const pageId = requireEnv('FACEBOOK_PAGE_ID');
  const token = requireEnv('FACEBOOK_PAGE_TOKEN');
  const at = encodeURIComponent(token);

  // `category` exists on a Page and not on a User, and Meta rejects the field
  // outright rather than returning null. Comparing ids is not enough on its
  // own: someone who pastes their user id into FACEBOOK_PAGE_ID alongside a
  // user token gets a match, and a "Page" called Ji Hu.
  const res = await fetch(`${graph()}/me?fields=id,name,category&access_token=${at}`);
  const me = (await res.json()) as Identity & { category?: string; error?: { message: string } };

  if (me.error || !me.category) {
    const who = (await (await fetch(`${graph()}/me?fields=id,name&access_token=${at}`)).json()) as Partial<Identity>;
    throw new Error(
      `FACEBOOK_PAGE_TOKEN is a USER token${who.name ? ` for "${who.name}"` : ''}, not a Page token, so it cannot post to a Page. ` +
        'Run: npm run authorize -- facebook',
    );
  }
  if (me.id !== pageId)
    throw new Error(
      `FACEBOOK_PAGE_TOKEN is for the Page "${me.name}" (${me.id}), but FACEBOOK_PAGE_ID says ${pageId}. ` +
        'Run: npm run authorize -- facebook',
    );
  return { id: me.id, name: me.name };
}

export type TokenInfo = { type: string; expiresAt: number; scopes: string[] };

/**
 * What kind of token this is and when it dies.
 *
 * A Page token inherits the life of the user token it came from. Derived from
 * a SHORT-lived one it lasts about an hour, which looks perfect in every other
 * check and then breaks the next morning; derived from a long-lived one it
 * never expires (`expires_at: 0`). That difference is invisible unless you ask
 * for it, so we ask.
 */
export async function pageTokenInfo(): Promise<TokenInfo> {
  const token = requireEnv('FACEBOOK_PAGE_TOKEN');
  const at = encodeURIComponent(token);
  const res = await fetch(`${graph()}/debug_token?input_token=${at}&access_token=${at}`);
  const body = (await res.json()) as {
    data?: { type?: string; expires_at?: number; scopes?: string[] };
    error?: { message: string };
  };
  if (body.error || !body.data) throw new Error(`Facebook: ${body.error?.message ?? 'could not inspect the token'}`);
  return { type: body.data.type ?? '?', expiresAt: body.data.expires_at ?? 0, scopes: body.data.scopes ?? [] };
}

async function fb<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${graph()}${path}`, {
    method: 'POST',
    body: new URLSearchParams({ ...params, access_token: requireEnv('FACEBOOK_PAGE_TOKEN') }),
  });
  const data = (await res.json()) as T & { error?: { message: string; code?: number } };
  if (data.error) throw new Error(`Facebook: ${data.error.message}${data.error.code ? ` (code ${data.error.code})` : ''}`);
  return data;
}

export async function publishReel(input: PostInput): Promise<{ id: string; url: string }> {
  const page = await assertPage();
  const size = statSync(input.mp4).size;

  // 1. open the session
  const start = await fb<{ video_id: string; upload_url: string }>(`/${page.id}/video_reels`, {
    upload_phase: 'start',
  });

  // 2. the bytes, to rupload rather than graph
  const put = await fetch(start.upload_url, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${requireEnv('FACEBOOK_PAGE_TOKEN')}`,
      offset: '0',
      file_size: String(size),
      'Content-Type': 'application/octet-stream',
    },
    body: readFileSync(input.mp4) as unknown as BodyInit,
  });
  const putBody = (await put.json()) as { success?: boolean; error?: { message: string } };
  if (!put.ok || !putBody.success)
    throw new Error(`Facebook upload → ${put.status} ${putBody.error?.message ?? JSON.stringify(putBody).slice(0, 200)}`);

  // 3. publish
  await fb<{ success: boolean }>(`/${page.id}/video_reels`, {
    video_id: start.video_id,
    upload_phase: 'finish',
    video_state: 'PUBLISHED',
    description: postBody(input.reel).slice(0, 2200),
  });

  // The permalink appears once Facebook has processed the file, which is not
  // instant. Worth a short wait for a usable link, never worth failing a post
  // that already published.
  let url = `https://www.facebook.com/${page.id}/videos/${start.video_id}`;
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(
      `${graph()}/${start.video_id}?fields=permalink_url&access_token=${encodeURIComponent(requireEnv('FACEBOOK_PAGE_TOKEN'))}`,
    );
    const body = (await res.json()) as { permalink_url?: string };
    if (body.permalink_url) {
      url = body.permalink_url.startsWith('http') ? body.permalink_url : `https://www.facebook.com${body.permalink_url}`;
      break;
    }
  }

  return { id: start.video_id, url };
}

export const facebook: Poster = {
  name: 'facebook',
  needs: ['FACEBOOK_PAGE_ID', 'FACEBOOK_PAGE_TOKEN'],
  post: async (input) => {
    const { id, url } = await publishReel(input);
    return { state: 'posted', at: now(), id, url };
  },
};
