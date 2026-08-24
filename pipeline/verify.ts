/**
 * The gate. Nothing renders that does not pass this.
 *
 * Two layers, on purpose:
 *
 *   1. Structural checks — cheap, deterministic, and the ones that actually
 *      catch bad LLM output day to day: dead cell refs, cues out of order,
 *      captions that overflow, ranges pointing at rows that aren't rendered.
 *
 *   2. Recalculation in REAL Excel (pipeline/excel.ts, COM automation on the
 *      build machine). The sheet is written into a scratch workbook with the
 *      formulas and no cached values, Excel computes, and what Excel DISPLAYS
 *      must equal `expected` character for character — including error values.
 *      Excel also hands back the formula as it stored it; if that differs from
 *      what the script typed (auto-closed parenthesis, inserted `@`), that is
 *      an error too, because the viewer will see the typed text.
 *
 * There is no bypass. If Excel cannot run, the reel is not verified and does
 * not render. `--structure-only` exists for fast iteration on the writer and
 * it still reports "not verified" as an error.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { reelSchema, CUES, type Reel } from '../src/reel/schema';
import { CAPTION } from '../src/reel/theme';
import { jobFromReel, recalcInExcel, sameFormula, type ExcelReport } from './excel';

export type Finding = { level: 'error' | 'warn'; message: string };
export type VerifyResult = {
  findings: Finding[];
  /** set only when Excel ran and both formulas matched */
  verification?: Reel['verification'];
};

export function verify(raw: unknown, opts: { structureOnly?: boolean } = {}): VerifyResult {
  const reel = reelSchema.parse(raw);
  const f: Finding[] = [];

  const rowNums = new Set(reel.sheet.rows.map((r) => r.n));
  const cellExists = (ref: string) => {
    const m = /^([A-C])(\d+)$/.exec(ref);
    return !!m && rowNums.has(Number(m[2]));
  };

  // --- structure -----------------------------------------------------------
  if (!cellExists(reel.sheet.target))
    f.push({ level: 'error', message: `target ${reel.sheet.target} is not a rendered cell` });

  for (const [n] of Object.entries(reel.sheet.fillDown))
    if (!rowNums.has(Number(n)))
      f.push({ level: 'error', message: `fillDown references row ${n}, which does not exist` });

  if (reel.sheet.alignment)
    for (const ref of Object.values(reel.sheet.alignment))
      if (!cellExists(ref))
        f.push({ level: 'error', message: `alignment cell ${ref} is not rendered` });

  for (const key of ['before', 'after'] as const) {
    const fm = reel.formulas[key];
    if (fm.cell !== reel.sheet.target)
      f.push({ level: 'error', message: `formulas.${key} targets ${fm.cell}, sheet target is ${reel.sheet.target}` });
    if (!fm.expected.trim())
      f.push({ level: 'error', message: `formulas.${key}.expected is empty — nothing to verify against` });
    for (const ref of fm.text.match(/\$?[A-C]\$?\d{1,3}/g) ?? [])
      if (!cellExists(ref.replace(/\$/g, '')))
        f.push({ level: 'error', message: `formulas.${key} references ${ref}, outside the rendered sheet` });
  }

  if (reel.formulas.before.text === reel.formulas.after.text)
    f.push({ level: 'error', message: 'before and after formulas are identical — nothing to teach' });

  // --- script --------------------------------------------------------------
  const cues = reel.script.map((l) => l.cue).filter(Boolean) as string[];
  if (new Set(cues).size !== cues.length)
    f.push({ level: 'error', message: 'a cue is used more than once' });

  const order = cues.map((c) => CUES.indexOf(c as (typeof CUES)[number]));
  if (order.some((v, i) => i > 0 && v < order[i - 1]))
    f.push({ level: 'error', message: 'cues are out of order — see the table in CLAUDE.md' });

  for (const required of ['hook', 'payoff'] as const)
    if (!cues.includes(required))
      f.push({ level: 'error', message: `missing required cue: ${required}` });

  reel.script.forEach((l, i) => {
    const cap = l.caption ?? l.vo;
    const rows = cap.split('\n');
    if (l.cue !== 'hook' && l.cue !== 'payoff') {
      if (rows.length > 2)
        f.push({ level: 'error', message: `line ${i}: caption is ${rows.length} lines, max is 2` });
      for (const r of rows) {
        const n = r.replace(/\*/g, '').length;
        if (n > CAPTION.maxCharsPerLine)
          f.push({ level: 'warn', message: `line ${i}: caption line is ${n} chars (max ${CAPTION.maxCharsPerLine} at ${CAPTION.fontSize}px), will wrap to 3 lines` });
      }
    }
    if (l.vo.split(/\s+/).length > 30)
      f.push({ level: 'warn', message: `line ${i}: ${l.vo.split(/\s+/).length} words is long for one beat` });
  });

  // --- reads-like-a-person checks (owner rule 2026-08-23) -------------------
  // Em/en dashes are the loudest AI tell in short copy. Hard error anywhere a
  // viewer sees or hears the text. Sheet data is exempt ("Cash - Operating"
  // uses a plain hyphen anyway).
  const facing: [string, string][] = [
    ['hook.lead', reel.hook.lead],
    ['hook.body', reel.hook.body],
    ['payoff.headline', reel.payoff.headline],
    ['payoff.sub', reel.payoff.sub],
    ...(reel.post
      ? ([
          ['post.title', reel.post.title],
          ['post.description', reel.post.description],
        ] as [string, string][])
      : []),
    ...reel.script.flatMap((l, i): [string, string][] => [
      [`script[${i}].vo`, l.vo],
      ...(l.caption ? ([[`script[${i}].caption`, l.caption]] as [string, string][]) : []),
    ]),
  ];
  for (const [where, text] of facing) {
    if (/[—–]/.test(text))
      f.push({ level: 'error', message: `${where}: em/en dash. Rewrite with a period or a comma; nobody types those.` });
    if (/;/.test(text) && where.includes('caption'))
      f.push({ level: 'warn', message: `${where}: semicolon in a caption reads like a machine wrote it` });
  }

  // --- column fit (widths auto-size, but A and B compete for one card) ------
  {
    const aMax = Math.max(...reel.sheet.rows.map((r) => r.a.length), 0);
    const bMax = Math.max(
      ...reel.sheet.rows.map((r) => r.b.length),
      ...Object.values(reel.sheet.fillDown).map((s) => s.length),
      reel.formulas.before.expected.length,
      reel.formulas.after.expected.length,
    );
    if (aMax + bMax > 42)
      f.push({
        level: 'warn',
        message: `longest A (${aMax}) + longest B (${bMax}) chars exceed what both columns can show; one will clip — shorten the data`,
      });
  }

  const words = reel.script.reduce((n, l) => n + l.vo.split(/\s+/).length, 0);
  const est = words / 2.6;
  if (est > 60) f.push({ level: 'warn', message: `~${est.toFixed(0)}s of narration; 30–55s is the band` });
  if (est < 25) f.push({ level: 'warn', message: `~${est.toFixed(0)}s of narration; under 30s leaves reach on the table` });

  // --- recalculation in real Excel ------------------------------------------
  let verification: Reel['verification'] | undefined;
  if (opts.structureOnly) {
    f.push({ level: 'error', message: 'structure-only run: formulas NOT verified in Excel. Not renderable.' });
  } else {
    const r = recalc(reel);
    f.push(...r.findings);
    verification = r.verification;
  }

  return { findings: f, verification };
}

/** Runs both formulas in Excel and compares what Excel displays to `expected`. */
function recalc(reel: Reel): VerifyResult {
  const out: Finding[] = [];
  let report: ExcelReport;
  try {
    report = recalcInExcel(jobFromReel(reel));
  } catch (e) {
    return {
      findings: [{ level: 'error', message: `${(e as Error).message} — not verified, not renderable.` }],
    };
  }

  for (const key of ['before', 'after'] as const) {
    const fm = reel.formulas[key];
    const got = report.results.find((x) => x.key === key);
    if (!got) {
      out.push({ level: 'error', message: `formulas.${key}: Excel returned no result` });
      continue;
    }
    if (got.setError) {
      out.push({ level: 'error', message: `formulas.${key}: Excel rejected the formula — ${got.setError}` });
      continue;
    }
    if (got.formulaReadback && !sameFormula(got.formulaReadback, fm.text))
      out.push({
        level: 'error',
        message: `formulas.${key}: Excel rewrote the formula to ${got.formulaReadback} (typed: ${fm.text}). Fix the text so the viewer sees exactly what Excel runs.`,
      });
    if (got.text !== fm.expected)
      out.push({
        level: 'error',
        message: `formulas.${key}: expected "${fm.expected}", Excel ${report.excel} displays "${got.text}"`,
      });
    if (got.isError !== fm.isError)
      out.push({
        level: 'error',
        message: `formulas.${key}: isError is ${fm.isError} but Excel ${got.isError ? 'returned an error value' : 'returned a normal value'}`,
      });
  }

  if (out.length) return { findings: out };
  return {
    findings: out,
    verification: {
      excel: report.excel,
      on: new Date().toISOString().slice(0, 10),
      formulasHash: formulasHash(reel),
    },
  };
}

/** Anything that changes what Excel would compute invalidates a stamp. */
export function formulasHash(reel: Reel): string {
  const h = createHash('sha256');
  h.update(JSON.stringify({ rows: reel.sheet.rows, formulas: reel.formulas }));
  return h.digest('hex').slice(0, 16);
}

/** Writes the verification record back into the reel JSON (informational). */
export function stamp(reelPath: string, verification: NonNullable<Reel['verification']>) {
  const raw = JSON.parse(readFileSync(reelPath, 'utf8'));
  raw.verification = verification;
  delete raw.verifiedInExcel;
  delete raw.verifiedOn;
  writeFileSync(reelPath, JSON.stringify(raw, null, 2) + '\n');
}

// CLI: npx tsx pipeline/verify.ts content/reels/001-*.json [--structure-only] [--stamp]
if (process.argv[1]?.endsWith('verify.ts')) {
  const file = process.argv[2];
  if (!file) throw new Error('usage: verify.ts <reel.json> [--structure-only] [--stamp]');
  const { findings, verification } = verify(JSON.parse(readFileSync(file, 'utf8')), {
    structureOnly: process.argv.includes('--structure-only'),
  });

  for (const x of findings) console.log(`${x.level === 'error' ? 'ERR ' : 'warn'}  ${x.message}`);
  const errors = findings.filter((x) => x.level === 'error').length;
  if (!errors && verification) {
    console.log(`\nPasses. Verified in Excel ${verification.excel} on ${verification.on}.`);
    if (process.argv.includes('--stamp')) {
      stamp(file, verification);
      console.log('stamped.');
    }
  } else {
    console.log(`\n${errors} error(s). Not renderable.`);
  }
  process.exit(errors ? 1 : 0);
}
