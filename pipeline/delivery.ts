/**
 * What was delivered, what has been posted, and what is still waiting.
 *
 * One record per reel, `content/reels/NNN-slug.delivery.json`, written by
 * deliver.ts and updated by poll.ts. It is deliberately a sidecar rather than
 * a field in the reel JSON: the reel is the contract between the writer and
 * the renderer, and it should not change after the fact. Delivery is pipeline
 * state and changes for days afterwards.
 *
 * A reel with no record is invisible to the poller. That is what makes the
 * ones delivered before auto-posting existed safe: they cannot be posted twice
 * because nothing knows how to post them.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PLATFORMS = ['youtube', 'instagram', 'linkedin', 'tiktok'] as const;
export type Platform = (typeof PLATFORMS)[number];

export type PostResult = {
  /** posted | drafted (TikTok, until the app is audited) | skipped | failed */
  state: 'posted' | 'drafted' | 'skipped' | 'failed';
  at: string;
  url?: string;
  id?: string;
  /** why it was skipped, or what the human still has to do */
  note?: string;
  error?: string;
  /** failures only: how many times this platform has been tried */
  attempts?: number;
};

/**
 * A failed platform is retried on later polls, because the common failure is a
 * network blip or a platform having a bad ten minutes. Three tries, then it
 * stays failed and the human sees it in the thread: past that it is a
 * credential or a policy problem, and retrying forever would hide it.
 */
export const MAX_ATTEMPTS = 3;

export type DeliveryRecord = {
  /** file stem, e.g. 006-vlookup-column-insert */
  stem: string;
  reelPath: string;
  mp4: string;
  stills: string[];
  deliveredAt: string;
  slack?: { channel: string; ts: string; permalink?: string };
  /** when the ✅ was first seen */
  approvedAt?: string;
  /** public URL the MP4 was hosted at for the platforms that need one */
  hostedUrl?: string;
  posts: Partial<Record<Platform, PostResult>>;
};

const DIR = 'content/reels';
export const recordPath = (stem: string) => join(DIR, `${stem}.delivery.json`);

export function readRecord(stem: string): DeliveryRecord | null {
  const p = recordPath(stem);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as DeliveryRecord) : null;
}

export function writeRecord(rec: DeliveryRecord): void {
  writeFileSync(recordPath(rec.stem), JSON.stringify(rec, null, 2) + '\n');
}

export function allRecords(): DeliveryRecord[] {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.delivery.json'))
    .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as DeliveryRecord)
    .sort((a, b) => a.deliveredAt.localeCompare(b.deliveredAt));
}

/**
 * Platforms still to try: nothing recorded, or a failure with tries left.
 * Anything that reached `posted`, `drafted` or `skipped` is never touched
 * again, which is what makes a poll every ten minutes safe.
 */
export const pending = (rec: DeliveryRecord): Platform[] =>
  PLATFORMS.filter((p) => {
    const r = rec.posts[p];
    return !r || (r.state === 'failed' && (r.attempts ?? 1) < MAX_ATTEMPTS);
  });

/** True once every platform has an outcome, whatever that outcome was. */
export const settled = (rec: DeliveryRecord) => pending(rec).length === 0;

/**
 * LinkedIn is the one platform with a cadence rule rather than a limit: two
 * posts a week from the founder's profile, never two inside 24 hours
 * (CLAUDE.md, and the evidence behind it is in the strategy document). Reels
 * ship 3–4 times a week, so posting every one of them there would break it.
 *
 * Returns the reason to hold, or null when it is clear to post.
 */
export function linkedinHold(now = new Date(), records = allRecords()): string | null {
  const posted = records
    .map((r) => r.posts.linkedin)
    .filter((p): p is PostResult => !!p && p.state === 'posted')
    .map((p) => new Date(p.at).getTime())
    .sort((a, b) => b - a);
  if (!posted.length) return null;

  const hours = (t: number) => (now.getTime() - t) / 3_600_000;
  if (hours(posted[0]) < 24)
    return `held: LinkedIn had a post ${Math.round(hours(posted[0]))}h ago and the rule is never two inside 24 hours`;
  if (posted.filter((t) => hours(t) < 24 * 7).length >= 2)
    return 'held: LinkedIn is already at two posts this week, which is the cadence';
  return null;
}
