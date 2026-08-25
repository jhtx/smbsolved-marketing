/**
 * YouTube Shorts, via the Data API v3.
 *
 * A vertical video under three minutes is treated as a Short by YouTube on its
 * own; there is no "shorts" flag to set and nothing to add to the title.
 *
 * Auth is a refresh token obtained once (`npm run authorize -- youtube`) and
 * kept in `.env.local`. Google refresh tokens for a published app do not
 * expire on a timer, so this is set up once and then left alone.
 *
 *   npx tsx pipeline/post/youtube.ts out/006-vlookup-column-insert.mp4 <reel.json>
 */
import '../env';
import { readFileSync, statSync } from 'node:fs';
import { requireEnv } from '../env';
import { postBody, postTitle, now, type PostInput, type Poster } from './types';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

/** Education. Tutorials sit here rather than in People & Blogs. */
const CATEGORY_EDUCATION = '27';

export async function accessToken(): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireEnv('YOUTUBE_CLIENT_ID'),
      client_secret: requireEnv('YOUTUBE_CLIENT_SECRET'),
      refresh_token: requireEnv('YOUTUBE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!data.access_token)
    throw new Error(`YouTube token refresh failed: ${data.error_description ?? data.error ?? 'no token'}`);
  return data.access_token;
}

export async function uploadShort(input: PostInput): Promise<{ id: string; url: string }> {
  const token = await accessToken();
  const size = statSync(input.mp4).size;

  const metadata = {
    snippet: {
      // YouTube caps titles at 100 characters and rejects < and >.
      title: postTitle(input.reel).replace(/[<>]/g, '').slice(0, 100),
      description: postBody(input.reel).slice(0, 4900),
      tags: (input.reel.post?.hashtags ?? []).map((t) => t.replace(/^#/, '')),
      categoryId: CATEGORY_EDUCATION,
    },
    status: {
      privacyStatus: 'public',
      selfDeclaredMadeForKids: false,
      // The channel's own default is fine for everything else; being explicit
      // here keeps a surprise setting change from altering what gets posted.
      embeddable: true,
    },
  };

  // 1. open a resumable session
  const start = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Upload-Content-Type': 'video/mp4',
      'X-Upload-Content-Length': String(size),
    },
    body: JSON.stringify(metadata),
  });
  if (!start.ok) throw new Error(`YouTube upload session → ${start.status} ${(await start.text()).slice(0, 300)}`);
  const location = start.headers.get('location');
  if (!location) throw new Error('YouTube upload session returned no Location header');

  // 2. send the bytes. One PUT: these files are single-digit megabytes, and a
  //    chunked upload only earns its complexity on an unreliable link.
  const put = await fetch(location, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size) },
    body: readFileSync(input.mp4),
  });
  const body = await put.text();
  if (!put.ok) throw new Error(`YouTube upload → ${put.status} ${body.slice(0, 300)}`);

  const id = (JSON.parse(body) as { id: string }).id;
  return { id, url: `https://www.youtube.com/shorts/${id}` };
}

export const youtube: Poster = {
  name: 'youtube',
  needs: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'],
  post: async (input) => {
    const { id, url } = await uploadShort(input);
    return { state: 'posted', at: now(), id, url };
  },
};

// CLI
if (process.argv[1]?.endsWith('youtube.ts')) {
  const { reelSchema } = await import('../../src/reel/schema');
  const [mp4, reelPath] = process.argv.slice(2);
  if (!mp4 || !reelPath) throw new Error('usage: youtube.ts <file.mp4> <reel.json>');
  uploadShort({
    reel: reelSchema.parse(JSON.parse(readFileSync(reelPath, 'utf8'))),
    mp4,
    stills: [],
    publicUrl: async () => '',
  })
    .then((r) => console.log(r.url))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
