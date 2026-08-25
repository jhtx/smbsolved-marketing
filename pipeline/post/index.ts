/**
 * Posting a reel to the platforms, once a human has approved it.
 *
 * Every platform is independent. One failing never stops another, a platform
 * that already succeeded is never retried, and nothing here decides on its own
 * that a reel is ready — poll.ts calls this only after seeing the ✅.
 *
 * Order is the one CLAUDE.md named: YouTube, Instagram, LinkedIn, TikTok.
 */
import '../env';
import { basename } from 'node:path';
import type { Reel } from '../../src/reel/schema';
import { MAX_ATTEMPTS, linkedinHold, type DeliveryRecord, type Platform, type PostResult } from '../delivery';
import { hostPublicly, configured as hostConfigured } from './host';
import { instagram } from './instagram';
import { linkedin } from './linkedin';
import { tiktok } from './tiktok';
import { now, type PostInput, type Poster } from './types';
import { youtube } from './youtube';

export const POSTERS: Poster[] = [youtube, instagram, linkedin, tiktok];

/** Platforms needing the MP4 to be reachable at a public URL. */
const NEEDS_PUBLIC_URL: Platform[] = ['instagram'];

const missingEnv = (p: Poster) => p.needs.filter((n) => !process.env[n]?.trim());

export type PostAllOptions = {
  /** work out what would happen and record nothing */
  dryRun?: boolean;
  /** restrict to these platforms; default is every pending one */
  only?: Platform[];
  log?: (line: string) => void;
};

/**
 * Runs the pending platforms for one reel and returns the updated record.
 * The record is the source of truth for what has and has not gone out, so it
 * is the caller's job to persist it.
 */
export async function postAll(
  rec: DeliveryRecord,
  reel: Reel,
  pendingPlatforms: Platform[],
  opts: PostAllOptions = {},
): Promise<DeliveryRecord> {
  const log = opts.log ?? console.log;
  const wanted = opts.only ? pendingPlatforms.filter((p) => opts.only!.includes(p)) : pendingPlatforms;

  // Uploaded at most once per reel, and only if a platform actually needs it.
  let hosted = rec.hostedUrl;
  const publicUrl = async () => {
    if (hosted) return hosted;
    hosted = await hostPublicly(rec.mp4, `reel-${rec.stem}`);
    rec.hostedUrl = hosted;
    return hosted;
  };

  const input: PostInput = { reel, mp4: rec.mp4, stills: rec.stills, publicUrl };

  for (const poster of POSTERS) {
    if (!wanted.includes(poster.name)) continue;

    const missing = missingEnv(poster);
    const needsUrl = NEEDS_PUBLIC_URL.includes(poster.name);
    let result: PostResult | null = null;

    if (missing.length) {
      result = {
        state: 'skipped',
        at: now(),
        note: `not configured. Add ${missing.join(', ')} to .env.local, then post this one by hand.`,
      };
    } else if (needsUrl && !hostConfigured()) {
      result = {
        state: 'skipped',
        at: now(),
        note: 'needs the MP4 at a public URL. Add GITHUB_TOKEN to .env.local (see .env.example), then post this one by hand.',
      };
    } else if (poster.name === 'linkedin') {
      const hold = linkedinHold();
      if (hold) result = { state: 'skipped', at: now(), note: hold };
    }

    if (result) {
      log(`  ${poster.name}: ${result.note}`);
      if (!opts.dryRun) rec.posts[poster.name] = result;
      continue;
    }

    if (opts.dryRun) {
      log(`  ${poster.name}: would post ${basename(rec.mp4)}`);
      continue;
    }

    const attempts = (rec.posts[poster.name]?.attempts ?? 0) + 1;
    try {
      log(`  ${poster.name}: posting`);
      const ok = await poster.post(input);
      rec.posts[poster.name] = ok;
      log(`  ${poster.name}: ${ok.state}${ok.url ? ' ' + ok.url : ''}`);
    } catch (e) {
      const error = (e as Error).message;
      rec.posts[poster.name] = { state: 'failed', at: now(), error, attempts };
      log(
        `  ${poster.name}: FAILED (${attempts}/${MAX_ATTEMPTS}) ${error}`,
      );
    }
  }

  return rec;
}

/**
 * What the ✅ will actually do, so the delivery message can say so honestly
 * instead of promising automation that has no credentials behind it.
 */
export function automation(): { platform: Platform; ready: boolean; missing: string[]; note: string }[] {
  return POSTERS.map((p) => {
    const missing = missingEnv(p);
    if (NEEDS_PUBLIC_URL.includes(p.name) && !hostConfigured()) missing.push('GITHUB_TOKEN');
    return {
      platform: p.name,
      ready: missing.length === 0,
      missing,
      note:
        p.name === 'tiktok'
          ? 'draft pushed to your inbox, finish it in the app'
          : p.name === 'linkedin'
            ? 'automatic, held to two a week and never two in 24h'
            : 'automatic',
    };
  });
}

/** One line per platform, for the Slack thread. */
export function summarise(rec: DeliveryRecord): string {
  const icon = { posted: '✅', drafted: '📝', skipped: '⏭️', failed: '⚠️' } as const;
  return POSTERS.map((p) => {
    const r = rec.posts[p.name];
    if (!r) return `• ${p.name}: waiting`;
    const tail = r.url ? ` ${r.url}` : r.note ? ` ${r.note}` : r.error ? ` ${r.error}` : '';
    return `• ${p.name}: ${icon[r.state]} ${r.state}${tail}`;
  }).join('\n');
}
