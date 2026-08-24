/**
 * Reviewer: the second and last model call. Checks what Excel cannot — the
 * truth of the narrated claims, version caveats, data realism, the hook,
 * variety against previous reels. Never re-checks formula results.
 *
 *   npx tsx pipeline/review.ts content/reels/002-sumif-text-dates.json
 */
import './env';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { reelSchema, type Reel } from '../src/reel/schema';
import { askForJson } from './llm';

export const reviewSchema = z.object({
  verdict: z.enum(['pass', 'revise']),
  findings: z.array(
    z.object({
      severity: z.enum(['blocking', 'minor']),
      /** e.g. "script[6].vo", "hook", "sheet.rows", "post.description" */
      where: z.string(),
      issue: z.string(),
      fix: z.string(),
    }),
  ),
  hook: z.object({ score: z.number(), note: z.string() }),
  claims: z.array(
    z.object({
      claim: z.string(),
      verdict: z.enum(['true', 'false', 'overstated', 'unverifiable']),
      note: z.string(),
    }),
  ),
});
export type Review = z.infer<typeof reviewSchema>;

const REELS_DIR = 'content/reels';

/** Hooks and payoffs of every other reel, for the variety check. */
export function previousReels(excludeId?: string): string {
  const lines: string[] = [];
  for (const f of readdirSync(REELS_DIR)) {
    if (!/^\d{3}-.*\.json$/.test(f) || f.includes('.review.') || f.includes('.timing.')) continue;
    try {
      const r = reelSchema.parse(JSON.parse(readFileSync(join(REELS_DIR, f), 'utf8')));
      if (r.id === excludeId) continue;
      lines.push(
        `- ${r.id} ${r.slug}: hook "${r.hook.lead} ${r.hook.body.replace(/\n/g, ' ')}" → payoff "${r.payoff.headline.replace(/\n/g, ' ')}"`,
      );
    } catch {
      /* skip unparsable */
    }
  }
  return lines.length ? lines.join('\n') : '(none yet)';
}

function systemPrompt(): string {
  const reviewer = readFileSync('prompts/reviewer.md', 'utf8');
  const rules = readFileSync('CLAUDE.md', 'utf8');
  return [
    reviewer,
    '\n---\n# House rules (CLAUDE.md), for reference\n',
    rules,
  ].join('\n');
}

export async function reviewReel(reel: Reel): Promise<{ review: Review; costUsd: number }> {
  const user = [
    'Review this reel. Real Excel has already verified both formulas (see `verification`).',
    '',
    '## Previous reels (for the variety check)',
    previousReels(reel.id),
    '',
    '## The reel',
    '```json',
    JSON.stringify(reel, null, 2),
    '```',
  ].join('\n');

  const { output, costUsd } = await askForJson({
    label: 'reviewer',
    system: systemPrompt(),
    messages: [{ role: 'user', content: user }],
    schema: reviewSchema,
    effort: 'high',
  });
  return { review: output, costUsd };
}

export function formatReview(r: Review): string {
  const lines = [`verdict: ${r.verdict} · hook ${r.hook.score}/5 — ${r.hook.note}`];
  for (const f of r.findings) lines.push(`  [${f.severity}] ${f.where}: ${f.issue} → ${f.fix}`);
  for (const c of r.claims) if (c.verdict !== 'true') lines.push(`  claim ${c.verdict}: "${c.claim}" — ${c.note}`);
  return lines.join('\n');
}

// CLI
if (process.argv[1]?.endsWith('review.ts')) {
  const file = process.argv[2];
  if (!file) throw new Error('usage: review.ts <reel.json>');
  const reel = reelSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  reviewReel(reel)
    .then(({ review }) => {
      console.log(formatReview(review));
      const out = file.replace(/\.json$/, '.review.json');
      writeFileSync(out, JSON.stringify(review, null, 2) + '\n');
      console.log(`wrote ${basename(out)}`);
      process.exit(review.verdict === 'pass' ? 0 : 2);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
