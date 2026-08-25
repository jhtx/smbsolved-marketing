/**
 * LinkedIn, native video on the founder's personal profile (`w_member_social`).
 *
 * Four calls: initialize an upload and get one URL per part, PUT the parts,
 * finalize with the part etags, then create the post referencing the video urn.
 * LinkedIn hands back a part id in the `etag` response header of each PUT and
 * refuses the finalize without them, which is the step that catches people out.
 *
 * Cadence is NOT decided here. poll.ts holds LinkedIn back to two posts a week
 * and never two inside 24 hours (see delivery.ts, linkedinHold).
 */
import '../env';
import { openSync, readSync, closeSync, statSync } from 'node:fs';
import { requireEnv } from '../env';
import { postBody, now, type PostInput, type Poster } from './types';

const API = 'https://api.linkedin.com';
/** LinkedIn requires a dated version header on every /rest call. */
const version = () => process.env.LINKEDIN_VERSION?.trim() || '202608';

const headers = () => ({
  Authorization: `Bearer ${requireEnv('LINKEDIN_ACCESS_TOKEN')}`,
  'LinkedIn-Version': version(),
  'X-Restli-Protocol-Version': '2.0.0',
  'Content-Type': 'application/json',
});

async function li<T>(path: string, init?: RequestInit): Promise<{ data: T; res: Response }> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...headers(), ...(init?.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`LinkedIn ${init?.method ?? 'GET'} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return { data: text ? (JSON.parse(text) as T) : ({} as T), res };
}

/** urn:li:person:… — from the env, or from the token's own userinfo. */
export async function memberUrn(): Promise<string> {
  const set = process.env.LINKEDIN_MEMBER_URN?.trim();
  if (set) return set;
  const res = await fetch(`${API}/v2/userinfo`, {
    headers: { Authorization: `Bearer ${requireEnv('LINKEDIN_ACCESS_TOKEN')}` },
  });
  if (!res.ok) throw new Error(`LinkedIn userinfo → ${res.status}. Set LINKEDIN_MEMBER_URN in .env.local instead.`);
  return `urn:li:person:${((await res.json()) as { sub: string }).sub}`;
}

type Init = {
  value: {
    video: string;
    uploadInstructions: { uploadUrl: string; firstByte: number; lastByte: number }[];
  };
};

/** Reads one byte range without pulling the whole file into memory twice. */
function slice(file: string, first: number, last: number): Uint8Array {
  const fd = openSync(file, 'r');
  try {
    const buf = new Uint8Array(last - first + 1);
    readSync(fd, buf, 0, buf.length, first);
    return buf;
  } finally {
    closeSync(fd);
  }
}

export async function postVideo(input: PostInput): Promise<{ id: string; url: string }> {
  const owner = await memberUrn();
  const size = statSync(input.mp4).size;

  const { data: init } = await li<Init>('/rest/videos?action=initializeUpload', {
    method: 'POST',
    body: JSON.stringify({
      initializeUploadRequest: { owner, fileSizeBytes: size, uploadCaptions: false, uploadThumbnail: false },
    }),
  });

  const partIds: string[] = [];
  for (const part of init.value.uploadInstructions) {
    const res = await fetch(part.uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${requireEnv('LINKEDIN_ACCESS_TOKEN')}`,
        'Content-Type': 'application/octet-stream',
      },
      body: slice(input.mp4, part.firstByte, part.lastByte) as BodyInit,
    });
    if (!res.ok) throw new Error(`LinkedIn video part ${part.firstByte}-${part.lastByte} → ${res.status}`);
    const etag = res.headers.get('etag');
    if (!etag) throw new Error('LinkedIn returned no etag for an uploaded part; finalize would be rejected');
    partIds.push(etag.replace(/"/g, ''));
  }

  await li('/rest/videos?action=finalizeUpload', {
    method: 'POST',
    body: JSON.stringify({
      finalizeUploadRequest: { video: init.value.video, uploadToken: '', uploadedPartIds: partIds },
    }),
  });

  const { res } = await li('/rest/posts', {
    method: 'POST',
    body: JSON.stringify({
      author: owner,
      commentary: postBody(input.reel).slice(0, 2900),
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { media: { title: input.reel.post?.title ?? input.reel.title, id: init.value.video } },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }),
  });

  const urn = res.headers.get('x-restli-id') ?? init.value.video;
  return { id: urn, url: `https://www.linkedin.com/feed/update/${urn}/` };
}

export const linkedin: Poster = {
  name: 'linkedin',
  needs: ['LINKEDIN_ACCESS_TOKEN'],
  post: async (input) => {
    const { id, url } = await postVideo(input);
    return { state: 'posted', at: now(), id, url };
  },
};
