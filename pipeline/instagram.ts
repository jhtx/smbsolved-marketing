/**
 * Instagram Graph API (Instagram Login flavour), own-account only.
 *
 * What it is for today: reel PERMALINKS, so newsletter links populate
 * themselves, and later the insights loop. Auto-posting remains a separate,
 * unmade decision (DECISIONS.md).
 *
 * Token: long-lived (60 days). `refreshToken()` swaps it for a fresh one and
 * rewrites the line in .env.local, so it never expires as long as something
 * calls it more often than every 60 days (the newsletter run does).
 *
 *   npx tsx pipeline/instagram.ts            # who am I + latest media
 *   npx tsx pipeline/instagram.ts --refresh  # refresh the token now
 */
import './env';
import { readFileSync, writeFileSync } from 'node:fs';
import { requireEnv } from './env';
import type { Reel } from '../src/reel/schema';

const G = 'https://graph.instagram.com/v23.0';

const token = () => requireEnv('INSTAGRAM_ACCESS_TOKEN');

async function ig<T>(path: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${G}${path}${sep}access_token=${encodeURIComponent(token())}`);
  const data = (await res.json()) as T & { error?: { message: string; code: number } };
  if (data.error) throw new Error(`Instagram: ${data.error.message} (code ${data.error.code})`);
  return data;
}

export type IgMedia = { id: string; media_type: string; permalink: string; timestamp: string; caption?: string };

export async function igMedia(limit = 25): Promise<IgMedia[]> {
  const uid = process.env.INSTAGRAM_USER_ID || (await ig<{ user_id: string }>('/me?fields=user_id')).user_id;
  const res = await ig<{ data: IgMedia[] }>(`/${uid}/media?fields=id,media_type,permalink,timestamp,caption&limit=${limit}`);
  return res.data ?? [];
}

/**
 * Matches a reel to a posted media item by caption overlap: the caption Jimmy
 * posts is the reel's post.description, so the description's first line (the
 * search phrase) appearing in the caption is a confident hit; otherwise fall
 * back to counting shared distinctive words.
 */
export function matchPermalink(reel: Reel, media: IgMedia[]): string | null {
  const firstLine = (reel.post?.description ?? '').split('\n')[0].trim().toLowerCase();
  const words = new Set(
    `${reel.post?.title ?? ''} ${reel.title}`
      .toLowerCase()
      .split(/[^a-z0-9#/]+/)
      .filter((w) => w.length >= 5),
  );
  let best: { link: string; score: number } | null = null;
  for (const m of media) {
    if (m.media_type !== 'VIDEO' && m.media_type !== 'REELS') continue;
    const cap = (m.caption ?? '').toLowerCase();
    if (!cap) continue;
    if (firstLine && cap.includes(firstLine)) return m.permalink;
    let score = 0;
    for (const w of words) if (cap.includes(w)) score++;
    if (score >= 3 && (!best || score > best.score)) best = { link: m.permalink, score };
  }
  return best?.link ?? null;
}

/** Refreshes the long-lived token and rewrites .env.local in place. */
export async function refreshToken(): Promise<void> {
  const res = await fetch(
    `${G.replace('/v23.0', '')}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token())}`,
  );
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: { message: string } };
  if (!data.access_token) {
    console.log(`token refresh skipped: ${data.error?.message ?? 'no token returned'}`);
    return;
  }
  const env = readFileSync('.env.local', 'utf8');
  writeFileSync('.env.local', env.replace(/^INSTAGRAM_ACCESS_TOKEN=.*$/m, `INSTAGRAM_ACCESS_TOKEN=${data.access_token}`));
  process.env.INSTAGRAM_ACCESS_TOKEN = data.access_token;
  console.log(`token refreshed (expires in ${Math.round((data.expires_in ?? 0) / 86400)} days)`);
}

// CLI
if (process.argv[1]?.endsWith('instagram.ts')) {
  (async () => {
    if (process.argv.includes('--refresh')) await refreshToken();
    const me = await ig<{ username: string; account_type: string }>('/me?fields=username,account_type');
    console.log(`account: @${me.username} (${me.account_type})`);
    for (const m of await igMedia(10)) {
      console.log(`- ${m.media_type} ${m.timestamp} ${m.permalink} "${(m.caption ?? '').slice(0, 50)}"`);
    }
  })().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
