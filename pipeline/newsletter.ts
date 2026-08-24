/**
 * Drafts "The Tie-Out" — the biweekly letter — from the latest delivered
 * reels. Deterministic assembly: every sentence in the fix sections comes
 * from reel JSON that already passed the reviewer, so no model runs here.
 *
 * The close-process note is deliberately a placeholder: that part is
 * Jimmy's, by design.
 *
 * Output, in order:
 *   1. out/newsletter/tie-out-<date>.html (always)
 *   2. a DRAFT broadcast in Kit (send_at: null) when the plan allows it
 *   3. a Slack notice either way
 *
 *   npx tsx pipeline/newsletter.ts                # two newest reels
 *   npx tsx pipeline/newsletter.ts --reels content/reels/004-trim-trailing-spaces.json
 *   add --no-kit to skip the Kit draft
 */
import './env';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reelSchema, type Reel } from '../src/reel/schema';
import { kit, LANDING_URL } from './kit';
import { notify } from './deliver';

const REELS_DIR = 'content/reels';

function latestReels(n: number): Reel[] {
  const reels: Reel[] = [];
  for (const f of readdirSync(REELS_DIR)) {
    if (!/^\d{3}-.*\.json$/.test(f) || f.includes('.review.') || f.includes('.timing.')) continue;
    try {
      const r = reelSchema.parse(JSON.parse(readFileSync(join(REELS_DIR, f), 'utf8')));
      if (r.verification) reels.push(r);
    } catch {
      /* skip */
    }
  }
  return reels.sort((a, b) => Number(b.id) - Number(a.id)).slice(0, n);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const flat = (s: string) => s.replace(/\n/g, ' ');

function fixSection(r: Reel, link: string | null): string {
  const title = r.post?.title ?? r.title;
  return [
    `<h3>${esc(title)}</h3>`,
    `<p><em>${esc(flat(r.hook.lead))} ${esc(flat(r.hook.body))}</em></p>`,
    `<p>The broken version:</p>`,
    `<pre><code>${esc(r.formulas.before.text)}</code></pre>`,
    `<p>Excel shows <strong>${esc(r.formulas.before.expected)}</strong>. The fix:</p>`,
    `<pre><code>${esc(r.formulas.after.text)}</code></pre>`,
    `<p>Excel shows <strong>${esc(r.formulas.after.expected)}</strong>. ${esc(flat(r.payoff.headline))}. ${esc(r.payoff.sub)}</p>`,
    link
      ? `<p><a href="${link}">Watch the 40 second version</a></p>`
      : `<p>Watch the 40 second version: [LINK TO REEL ${r.id}]</p>`,
  ].join('\n');
}

/**
 * Owner's call 2026-08-24: the close note is drafted by the model and marked
 * for review, instead of an empty placeholder. It stays the one part the
 * owner rewrites in their own words before sending.
 */
async function draftCloseNote(reels: Reel[]): Promise<string> {
  const { askForJson } = await import('./llm');
  const { z } = await import('zod');
  const { output } = await askForJson({
    label: 'close-note',
    system: [
      'You draft one short section of a biweekly email letter called The Tie-Out, written by Jimmy, who runs month-end closes and builds internal tools for small and mid-sized companies. The section is called "One close note": 120 to 180 words about one specific thing that goes wrong in a month-end close and what to change about the process.',
      'Voice: a competent colleague, slightly dry, first person. Contractions. Short sentences, unevenly. No em or en dashes, no semicolons, no rhetorical questions, no "pro tip", no "simply", no exclamation marks, no bullet lists. It must read like a person typed it between meetings.',
      'Ground it in real close mechanics: cutoff, accruals, reconciliations, tie-outs, review sign-off, exports from accounting systems. Do not repeat the Excel fixes below; the note is about process, not formulas. Do not invent specific client stories as fact; write from the pattern ("the version of this I keep seeing is...").',
      'Return body text only. No title, no heading, and do not open with the words "One close note" — the heading already exists above your text.',
    ].join('\n\n'),
    messages: [
      {
        role: 'user',
        content:
          'This issue covers these Excel fixes, for context only. Write the close note about an adjacent process problem, not these formulas:\n' +
          reels.map((r) => `- ${r.title}`).join('\n'),
      },
    ],
    schema: z.object({ note: z.string() }),
    effort: 'medium',
  });
  return output.note;
}

export function draftIssue(
  reels: Reel[],
  closeNote: string,
  links: Record<string, string | null> = {},
): { subject: string; previewText: string; html: string } {
  const date = new Date().toISOString().slice(0, 10);
  const lead = reels[0];
  const subject = `The Tie-Out: ${(lead.post?.title ?? lead.title).replace(/\.$/, '')}`;
  const previewText = 'One Excel fix, one close note, one template.';
  const html = [
    `<p><em>One fix, one close note, one template.</em></p>`,
    `<h2>The fix${reels.length > 1 ? 'es' : ''}</h2>`,
    ...reels.map((r) => fixSection(r, links[r.id] ?? null)),
    `<h2>One close note</h2>`,
    `<p>[DRAFT FOR REVIEW]</p>`,
    `<p>${esc(closeNote)}</p>`,
    `<h2>The template shelf</h2>`,
    `<p>The fixed asset roll-forward: book and tax depreciation, disposals with gain or loss, and a tie-out row that catches drift before it ships. <a href="${LANDING_URL}">Get it here</a>.</p>`,
    `<p>Reply if a formula in your close is misbehaving. The good ones become reels.</p>`,
    `<p>Jimmy<br>SMB Solved</p>`,
    `<!-- drafted ${date} from reels ${reels.map((r) => r.id).join(', ')} -->`,
  ].join('\n');
  return { subject, previewText, html };
}

async function main() {
  const args = process.argv.slice(2);
  // Permalinks from Instagram, when creds exist. Posted reels come first:
  // the letter should link to live videos, not placeholders.
  const links: Record<string, string | null> = {};
  const ri = args.indexOf('--reels');
  let reels =
    ri >= 0
      ? args[ri + 1].split(',').map((p) => reelSchema.parse(JSON.parse(readFileSync(p, 'utf8'))))
      : latestReels(6);
  if (!reels.length) throw new Error('no verified reels found to draft from');

  if (process.env.INSTAGRAM_ACCESS_TOKEN) {
    try {
      const { igMedia, matchPermalink, refreshToken } = await import('./instagram');
      await refreshToken().catch(() => undefined);
      const media = await igMedia(25);
      for (const r of reels) links[r.id] = matchPermalink(r, media);
      console.log(
        `instagram: ${media.length} media, matched ${Object.values(links).filter(Boolean).length} of ${reels.length} reels`,
      );
    } catch (e) {
      console.log(`instagram skipped: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  if (ri < 0) {
    const posted = reels.filter((r) => links[r.id]);
    const unposted = reels.filter((r) => !links[r.id]);
    reels = [...posted, ...unposted].slice(0, 2);
  }
  console.log(`drafting from reels ${reels.map((r) => r.id).join(', ')}`);

  let closeNote = '[JIMMY: 120 to 180 words. One real thing that went wrong in a close and what to change.]';
  if (!args.includes('--no-note')) {
    try {
      closeNote = await draftCloseNote(reels);
    } catch (e) {
      console.log(`close-note draft skipped: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  const issue = draftIssue(reels, closeNote, links);
  mkdirSync('out/newsletter', { recursive: true });
  const outPath = `out/newsletter/tie-out-${new Date().toISOString().slice(0, 10)}.html`;
  writeFileSync(outPath, `<h1>${esc(issue.subject)}</h1>\n${issue.html}`);
  console.log(`wrote ${outPath}`);

  let inKit = false;
  if (!args.includes('--no-kit')) {
    try {
      await kit('POST', '/broadcasts', {
        subject: issue.subject,
        description: `The Tie-Out draft ${new Date().toISOString().slice(0, 10)}`,
        content: issue.html,
        preview_text: issue.previewText,
        public: false,
        published_at: new Date().toISOString(),
        send_at: null,
      });
      inKit = true;
      console.log('draft broadcast created in Kit (Send → Broadcasts → Drafts)');
    } catch (e) {
      console.log(`Kit draft skipped: ${(e as Error).message.slice(0, 160)}`);
    }
  }

  await notify(
    `The Tie-Out draft is ready (reels ${reels.map((r) => r.id).join(', ')}). ` +
      (inKit ? 'It is in Kit under Send → Broadcasts → Drafts. ' : `Kit draft was not created; the HTML is at ${outPath}. `) +
      'Write the close note, paste the reel links, then send and mirror to LinkedIn 24h later.',
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
