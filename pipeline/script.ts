/**
 * Writer: backlog topic -> reel JSON, looped against the gate.
 *
 * The model writes; verify.ts (structure + real Excel) and, optionally, the
 * reviewer judge; findings go back to the model verbatim. Three loops, then
 * the topic is parked for a human. Nothing here can set a reel as verified —
 * only Excel does that, inside verify().
 *
 *   npx tsx pipeline/script.ts --next                 # first unchecked backlog item
 *   npx tsx pipeline/script.ts --id 002               # a specific backlog item
 *   npx tsx pipeline/script.ts --topic "..." --id 014 # ad-hoc topic
 *   add --review to run the reviewer and loop on blocking findings
 *   add --no-excel-loop to stop after the first verified-or-not attempt
 */
import './env';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { CUES, reelSchema, type Reel } from '../src/reel/schema';
import { CAPTION } from '../src/reel/theme';
import { askForJson } from './llm';
import { verify, formulasHash } from './verify';
import { reviewReel, formatReview, previousReels } from './review';

/* ------------------------------------------------------------------ */
/* writer output schema — the reel, relaxed for constrained decoding    */
/* (no regex/min/max/defaults; records as arrays; null for "omit")      */
/* ------------------------------------------------------------------ */

const wRow = z.object({
  n: z.number(),
  a: z.string(),
  b: z.string(),
  /** third data column; only a reel that inserts a column renders it */
  c: z.string(),
  hdr: z.boolean(),
  /** true = Excel holds a NUMBER in column A (renders right-aligned). false = text. */
  right: z.boolean(),
  group: z.enum(['top', 'bottom', 'none']),
});
const wFormula = z.object({
  cell: z.string(),
  text: z.string(),
  expected: z.string(),
  isError: z.boolean(),
  numberFormat: z.string().nullable(),
  /** insert reels, `before` only: what it displayed before the insert */
  expectedInitial: z.string().nullable(),
  /** insert reels, `before` only: the formula as Excel rewrites it */
  textAfter: z.string().nullable(),
});
const wLine = z.object({
  vo: z.string(),
  caption: z.string().nullable(),
  cue: z.enum(CUES).nullable(),
});
export const writerSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  hook: z.object({ lead: z.string(), body: z.string() }),
  payoff: z.object({ headline: z.string(), sub: z.string() }),
  sheet: z.object({
    target: z.string(),
    rows: z.array(wRow),
    fillDown: z.array(z.object({ row: z.number(), value: z.string() })),
    alignment: z.object({ textCell: z.string(), numberCell: z.string() }).nullable(),
    /** the one sheet change a reel may make; null for most reels */
    mutation: z
      .object({ kind: z.enum(['insertColumn', 'insertRow']), at: z.string() })
      .nullable(),
  }),
  formulas: z.object({ before: wFormula, after: wFormula }),
  script: z.array(wLine),
  post: z.object({
    title: z.string(),
    description: z.string(),
    hashtags: z.array(z.string()),
  }),
});
type WriterOut = z.infer<typeof writerSchema>;

/** Writer output -> the strict reel shape verify/render expect. */
function toReel(w: WriterOut): unknown {
  const strip = <T extends object>(o: T) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as T;
  return {
    id: w.id,
    slug: w.slug,
    title: w.title,
    hook: w.hook,
    payoff: w.payoff,
    sheet: {
      target: w.sheet.target,
      rows: w.sheet.rows,
      fillDown: Object.fromEntries(w.sheet.fillDown.map((f) => [String(f.row), f.value])),
      ...(w.sheet.alignment ? { alignment: w.sheet.alignment } : {}),
      ...(w.sheet.mutation ? { mutation: w.sheet.mutation } : {}),
    },
    formulas: { before: strip(w.formulas.before), after: strip(w.formulas.after) },
    script: w.script.map((l) => strip(l)),
    post: w.post,
  };
}

/* ------------------------------------------------------------------ */
/* backlog                                                             */
/* ------------------------------------------------------------------ */

const BACKLOG = 'content/backlog.md';

export type BacklogItem = { id: string; text: string; done: boolean; line: number };

/** Parses `- [ ] **NNN** symptom → fix` entries, joining wrapped lines. */
export function readBacklog(): BacklogItem[] {
  const lines = readFileSync(BACKLOG, 'utf8').split('\n');
  const items: BacklogItem[] = [];
  lines.forEach((ln, i) => {
    const m = /^- \[( |x)\] \*\*(\d{3})\*\* (.+)$/.exec(ln);
    if (!m) return;
    let text = m[3].trim();
    for (let j = i + 1; j < lines.length && /^\s{4,}\S/.test(lines[j]); j++) text += ' ' + lines[j].trim();
    items.push({ id: m[2], text, done: m[1] === 'x', line: i });
  });
  return items;
}

function markDone(id: string) {
  const src = readFileSync(BACKLOG, 'utf8');
  writeFileSync(BACKLOG, src.replace(new RegExp(`^- \\[ \\] \\*\\*${id}\\*\\*`, 'm'), `- [x] **${id}**`));
}

/* ------------------------------------------------------------------ */
/* prompt                                                              */
/* ------------------------------------------------------------------ */

function systemPrompt(): string {
  const writer = readFileSync('prompts/script-writer.md', 'utf8');
  const rules = readFileSync('CLAUDE.md', 'utf8');
  const example = readFileSync('content/reels/001-vlookup-text-numbers.json', 'utf8');
  return [
    writer,
    '\n---\n# House rules (CLAUDE.md)\n',
    rules,
    '\n---\n# The reel JSON, field by field\n',
    `- \`id\`: three digits, given to you. \`slug\`: lowercase-hyphenated, 2–5 words.`,
    `- \`hook.lead\`: the oversized red line on the hook card — usually the error value or the wrong number (≤7 characters). \`hook.body\`: the turn, ≤10 words, \`\\n\` for the line break.`,
    `- \`payoff.headline\`: 2–3 short lines, uppercase on screen; \`payoff.sub\`: one sentence.`,
    `- \`sheet.rows\`: 6–10 rows, \`n\` = Excel row number starting at 1. Columns A and B carry data; \`c\` stays empty unless this reel inserts a column, in which case A, B and C all carry data. \`hdr\` = bold header row. \`right: true\` means Excel holds a NUMBER in column A (it renders right-aligned); \`right: false\` means the digits are TEXT, the way a GL export delivers them. Column B numbers are always numbers. \`group\`: \`top\` rows reveal first, \`bottom\` rows reveal on \`revealBottom\`, \`none\` for blank spacer rows.`,
    `- \`sheet.target\`: the ONE cell where the formula lives and the audit marks attach, in the LAST data column (B normally, C on an insert-a-column reel, and written in the coordinates AFTER the insert). \`formulas.before.cell\` and \`after.cell\` must equal it.`,
    `- \`sheet.fillDown\`: rows that populate on the \`fillDown\` cue, with the value each shows. Empty array if the reel has no fill-down.`,
    `- \`sheet.alignment\`: only for the text-vs-number concept (cells the TEXT / NUMBER pills point at). null otherwise.`,
    `- \`sheet.mutation\`: null for most reels. Set it only for the "it worked until somebody changed the sheet" family: \`{ kind: "insertColumn", at: "B" }\` or \`{ kind: "insertRow", at: "10" }\`. \`rows\` then describes the sheet AFTER the insert and \`at\` names the newcomer. With it you must use the \`showInitial\` cue and the matching \`insertColumn\`/\`insertRow\` cue, and fill \`formulas.before.expectedInitial\` (what the formula displayed before the insert) and \`formulas.before.textAfter\` (the formula as EXCEL rewrites it during the insert: ranges stretch, index numbers do not). \`before.text\` is written in the coordinates BEFORE the insert; everything else uses the coordinates after it. Excel checks all three.`,
    `- \`formulas.*.text\`: the exact formula, starting with \`=\`, referencing only rendered rows. \`expected\`: exactly what the cell DISPLAYS in Excel after calculation — error values verbatim (\`#N/A\`, \`#VALUE!\`); numbers as General format shows them (\`4250\`) unless you set \`numberFormat\` (e.g. \`"#,##0.00"\` → \`4,250.00\`, \`"m/d/yyyy"\` → \`3/15/2026\`). \`isError\`: true only for Excel error values. \`expectedInitial\` and \`textAfter\` are null unless \`sheet.mutation\` is set.`,
    `- \`script\`: 8–12 lines. \`vo\` is spoken (spell symbols phonetically: "N slash A", "hash value"); \`caption\` is on screen (real symbols, \`\\n\` line break, max 2 lines, **${CAPTION.maxCharsPerLine} characters per line**, \`*asterisks*\` once per reel), null to reuse vo. \`cue\`: one of ${CUES.join(', ')} in that order, each at most once; \`hook\` and \`payoff\` required; \`showAlignment\` only if \`sheet.alignment\` is set; \`fillDown\` only if \`sheet.fillDown\` is non-empty. Lines with no cue are allowed.`,
    `- \`post\`: \`title\` ≤70 chars; \`description\` whose first line is the search phrase an accountant would type, then one plain sentence, no CTA beyond "save this"; \`hashtags\` ≤5 topical (#excel #accounting …), no # in the strings.`,
    '\n---\n# A complete reel, for STRUCTURE only (do not copy its content, data, or phrasing)\n',
    '```json',
    example,
    '```',
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* the loop                                                            */
/* ------------------------------------------------------------------ */

export async function writeReel(opts: {
  id: string;
  topic: string;
  review?: boolean;
  maxLoops?: number;
}): Promise<{ path: string; reel: Reel; costUsd: number } | { parked: string; costUsd: number }> {
  const maxLoops = opts.maxLoops ?? 3;
  const system = systemPrompt();
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        `Write reel **${opts.id}** for this backlog topic:`,
        '',
        `> ${opts.topic}`,
        '',
        '## Previous reels (do not repeat their hooks, data or phrasing)',
        previousReels(opts.id),
        '',
        'Return the complete reel JSON.',
      ].join('\n'),
    },
  ];

  let cost = 0;
  let lastPath = '';

  for (let attempt = 1; attempt <= maxLoops; attempt++) {
    console.log(`writer attempt ${attempt}/${maxLoops}`);
    const { output, costUsd } = await askForJson({
      label: 'writer',
      system,
      messages,
      schema: writerSchema,
      effort: 'high',
    });
    cost += costUsd;
    messages.push({ role: 'assistant', content: JSON.stringify(output) });

    // 1. strict schema
    const raw = toReel(output);
    const parsed = reelSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
      console.log(`  schema: ${parsed.error.issues.length} issue(s)`);
      messages.push({ role: 'user', content: `The JSON does not match the schema:\n${issues}\n\nReturn the corrected complete reel.` });
      continue;
    }
    const reel = parsed.data;
    if (reel.id !== opts.id) reel.id = opts.id;

    // 2. the gate — structure + real Excel
    const { findings, verification } = verify(reel);
    const errors = findings.filter((f) => f.level === 'error');
    const warns = findings.filter((f) => f.level === 'warn');
    for (const f of findings) console.log(`  ${f.level === 'error' ? 'ERR ' : 'warn'} ${f.message}`);

    if (errors.length || !verification) {
      messages.push({
        role: 'user',
        content: [
          'The reel failed verification. Real Excel computed the formulas; where a message says what Excel displays, that is the truth — change the reel (formula, data, or `expected`), never argue with it.',
          '',
          ...errors.map((f) => `- ERROR: ${f.message}`),
          ...warns.map((f) => `- warn: ${f.message}`),
          '',
          'Return the corrected complete reel.',
        ].join('\n'),
      });
      continue;
    }

    // 3. write it, stamped
    reel.verification = verification;
    lastPath = `content/reels/${reel.id}-${reel.slug}.json`;
    writeFileSync(lastPath, JSON.stringify(reel, null, 2) + '\n');
    console.log(`  verified in Excel ${verification.excel} · wrote ${lastPath}`);

    // 4. reviewer, optional
    if (opts.review) {
      const { review, costUsd: rc } = await reviewReel(reel);
      cost += rc;
      console.log(formatReview(review));
      writeFileSync(lastPath.replace(/\.json$/, '.review.json'), JSON.stringify(review, null, 2) + '\n');
      const blocking = review.findings.filter((f) => f.severity === 'blocking');
      if (review.verdict === 'revise' && blocking.length && attempt >= maxLoops) {
        // Last attempt still has blocking findings: leave the JSON + review on
        // disk for a human, do not mark the backlog item done.
        return {
          parked: `reel ${reel.id} still has ${blocking.length} blocking reviewer finding(s) after ${maxLoops} attempts — see ${lastPath.replace(/\.json$/, '.review.json')}`,
          costUsd: cost,
        };
      }
      if (review.verdict === 'revise' && blocking.length) {
        messages.push({
          role: 'user',
          content: [
            'An independent reviewer read the reel. Fix the blocking findings (and the minor ones where cheap), keeping everything that was verified unless a finding requires changing it:',
            '',
            ...review.findings.map((f) => `- [${f.severity}] ${f.where}: ${f.issue} → ${f.fix}`),
            `- hook score ${review.hook.score}/5: ${review.hook.note}`,
            '',
            'Return the corrected complete reel.',
          ].join('\n'),
        });
        continue;
      }
    }

    markDone(reel.id);
    dropEarlierSlugs(reel.id, lastPath);
    return { path: lastPath, reel, costUsd: cost };
  }

  return { parked: `reel ${opts.id} did not pass after ${maxLoops} attempts — parked for a human`, costUsd: cost };
}

/**
 * Each attempt writes `NNN-slug.json`, and the model is free to rename the
 * slug as the reel changes shape, so a loop can leave earlier attempts behind
 * under dead names. Reel 007 left a `007-iferror-missing-name.json` next to
 * the real `007-iferror-vendor-master.json`. Only the reel that shipped should
 * be in content/reels, or the next person cannot tell which 007 is the reel.
 */
function dropEarlierSlugs(id: string, keep: string) {
  const keepStem = basename(keep).replace(/\.json$/, '');
  for (const f of readdirSync('content/reels')) {
    const m = /^(\d{3})-(.+?)\.(json|review\.json)$/.exec(f);
    if (!m || m[1] !== id) continue;
    if (f.startsWith(keepStem)) continue;
    rmSync(join('content/reels', f), { force: true });
    console.log(`  removed ${f} (earlier attempt under a different slug)`);
  }
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

if (process.argv[1]?.endsWith('script.ts')) {
  const args = process.argv.slice(2);
  const flag = (n: string) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const review = args.includes('--review');

  let id = flag('--id');
  let topic = flag('--topic');
  if (args.includes('--next') || (!topic && id)) {
    const items = readBacklog();
    const item = id ? items.find((x) => x.id === id) : items.find((x) => !x.done);
    if (!item) throw new Error(id ? `backlog item ${id} not found` : 'backlog has no unchecked items');
    id = item.id;
    topic = item.text;
  }
  if (!id || !topic) throw new Error('usage: script.ts --next | --id NNN | --topic "..." --id NNN  [--review]');
  if (existsSync(`content/reels/${id}-`)) throw new Error(`reel ${id} exists`);

  console.log(`topic ${id}: ${topic}`);
  writeReel({ id, topic, review })
    .then((r) => {
      if ('parked' in r) {
        console.log(`\n${r.parked} · $${r.costUsd.toFixed(2)}`);
        process.exit(2);
      }
      console.log(`\n${r.path} · hash ${formulasHash(r.reel)} · $${r.costUsd.toFixed(2)}`);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
