/**
 * A public HTTPS URL for the finished MP4, because Instagram's publishing API
 * does not accept an upload: it fetches the video from a URL you give it.
 *
 * The file is attached to a GitHub release on the public marketing repo.
 * Release assets are stored outside git history, so a 5MB MP4 a day never
 * touches the repo's size, the URL is permanent, and it doubles as an
 * off-machine copy of every reel. See DECISIONS.md 2026-08-24.
 *
 * Needs GITHUB_TOKEN: a fine-grained PAT on jhtx/smbsolved-marketing with
 * Contents read/write. The plain-git path used for the website cannot do this
 * — releases are API-only.
 *
 *   npx tsx pipeline/post/host.ts out/006-vlookup-column-insert.mp4
 */
import '../env';
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { requireEnv } from '../env';

const REPO = process.env.REELS_ASSET_REPO ?? 'jhtx/smbsolved-marketing';
const API = 'https://api.github.com';

const headers = () => ({
  Authorization: `Bearer ${requireEnv('GITHUB_TOKEN')}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'smbsolved-reels',
});

async function gh<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...headers(), ...(init?.headers ?? {}) } });
  const body = await res.text();
  if (!res.ok) throw new Error(`GitHub ${init?.method ?? 'GET'} ${path} → ${res.status} ${body.slice(0, 300)}`);
  return body ? (JSON.parse(body) as T) : ({} as T);
}

type Release = { id: number; upload_url: string; tag_name: string };
type Asset = { name: string; browser_download_url: string; id: number };

/** One release per reel, tagged `reel-NNN-slug`, created on first use. */
async function release(tag: string): Promise<Release> {
  try {
    return await gh<Release>(`/repos/${REPO}/releases/tags/${tag}`);
  } catch (e) {
    if (!String(e).includes('404')) throw e;
  }
  return gh<Release>(`/repos/${REPO}/releases`, {
    method: 'POST',
    body: JSON.stringify({
      tag_name: tag,
      name: tag,
      body: 'Rendered reel, attached so the publishing APIs can fetch it. Verified in real Excel before render.',
      draft: false,
      prerelease: false,
    }),
  });
}

/**
 * Uploads the file and returns its public URL. Idempotent: an asset of the
 * same name that is already there is reused rather than duplicated, so a
 * retried post never uploads twice.
 */
export async function hostPublicly(file: string, tag: string): Promise<string> {
  const name = basename(file);
  const rel = await release(tag);

  const existing = await gh<Asset[]>(`/repos/${REPO}/releases/${rel.id}/assets`);
  const already = existing.find((a) => a.name === name);
  if (already) return already.browser_download_url;

  const bytes = readFileSync(file);
  const url = `https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'video/mp4', 'Content-Length': String(statSync(file).size) },
    body: bytes,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`GitHub asset upload → ${res.status} ${body.slice(0, 300)}`);
  return (JSON.parse(body) as Asset).browser_download_url;
}

export const configured = () => !!process.env.GITHUB_TOKEN?.trim();

// CLI
if (process.argv[1]?.endsWith('host.ts')) {
  const file = process.argv[2];
  if (!file) throw new Error('usage: host.ts <file.mp4> [tag]');
  hostPublicly(file, process.argv[3] ?? `reel-${basename(file).replace(/\.mp4$/, '')}`)
    .then((u) => console.log(u))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
