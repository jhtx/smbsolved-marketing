/**
 * Instagram Reels, via the Content Publishing API.
 *
 * Three steps and a wait: create a media container pointing at a public video
 * URL, poll until Instagram has finished ingesting it, publish. Instagram
 * fetches the file itself, which is why pipeline/post/host.ts exists.
 *
 * The token is the same long-lived Instagram Login token pipeline/instagram.ts
 * already refreshes, but it needs the `instagram_business_content_publish`
 * scope on top of the basic one. A token without it fails at the container
 * step with a permissions error, which is the message the poller reports.
 */
import '../env';
import { requireEnv } from '../env';
import { postBody, now, type PostInput, type Poster } from './types';

const G = 'https://graph.instagram.com/v23.0';

async function ig<T>(path: string, params: Record<string, string>, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  const body = new URLSearchParams({ ...params, access_token: requireEnv('INSTAGRAM_ACCESS_TOKEN') });
  const res =
    method === 'GET'
      ? await fetch(`${G}${path}?${body}`)
      : await fetch(`${G}${path}`, { method, body });
  const data = (await res.json()) as T & { error?: { message: string; code: number } };
  if (data.error) throw new Error(`Instagram: ${data.error.message} (code ${data.error.code})`);
  return data;
}

const userId = async () =>
  process.env.INSTAGRAM_USER_ID?.trim() || (await ig<{ user_id: string }>('/me', { fields: 'user_id' })).user_id;

/** Instagram ingests the video asynchronously; nothing can publish until then. */
async function waitForContainer(id: string, timeoutMs = 5 * 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let wait = 4_000;
  for (;;) {
    const { status_code, status } = await ig<{ status_code: string; status?: string }>(`/${id}`, {
      fields: 'status_code,status',
    });
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED')
      throw new Error(`Instagram could not ingest the video (${status_code}${status ? `: ${status}` : ''})`);
    if (Date.now() > deadline) throw new Error('Instagram is still processing the video after 5 minutes');
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 1.5, 20_000);
  }
}

export async function publishReel(input: PostInput): Promise<{ id: string; url: string }> {
  const uid = await userId();
  const videoUrl = await input.publicUrl();

  const container = await ig<{ id: string }>(
    `/${uid}/media`,
    {
      media_type: 'REELS',
      video_url: videoUrl,
      caption: postBody(input.reel).slice(0, 2200),
      share_to_feed: 'true',
    },
    'POST',
  );
  await waitForContainer(container.id);

  const published = await ig<{ id: string }>(`/${uid}/media_publish`, { creation_id: container.id }, 'POST');
  const { permalink } = await ig<{ permalink: string }>(`/${published.id}`, { fields: 'permalink' });
  return { id: published.id, url: permalink };
}

export const instagram: Poster = {
  name: 'instagram',
  needs: ['INSTAGRAM_ACCESS_TOKEN'],
  post: async (input) => {
    const { id, url } = await publishReel(input);
    return { state: 'posted', at: now(), id, url };
  },
};
