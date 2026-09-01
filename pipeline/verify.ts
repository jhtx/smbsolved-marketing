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
 *      A row carrying `stored` is checked the same way: Excel holds the serial
 *      and has to render exactly the text the sheet puts on screen.
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
import { DATA_KEYS, colIndex, colLetter, dataColumnCount, initialRows } from '../src/reel/sheet';
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
  /** A rendered DATA cell. The marks column past the data is not one. */
  const cellExists = (ref: string) => {
    const m = /^([A-Z])(\d{1,3})$/.exec(ref);
    return !!m && colIndex(m[1]) < dataColumnCount(reel) && rowNums.has(Number(m[2]));
  };
  /**
   * The same test against the sheet as it stood BEFORE the insert. Refs in
   * `formulas.before.text` are already written in those old coordinates, so
   * they are checked here rather than being translated first.
   */
  const initialRowNums = new Set(initialRows(reel).map((r) => r.n));
  const initialCols = dataColumnCount(reel) - (reel.sheet.mutation?.kind === 'insertColumn' ? 1 : 0);
  const cellExistedBefore = (ref: string) => {
    const m = /^([A-Z])(\d{1,3})$/.exec(ref);
    return !!m && colIndex(m[1]) < initialCols && initialRowNums.has(Number(m[2]));
  };
  const refsIn = (text: string) =>
    (text.match(/(?<![A-Z0-9$])\$?[A-Z]{1,2}\$?\d{1,3}/g) ?? []).map((r) => r.replace(/\$/g, ''));

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

  // --- cells that display other than they store -----------------------------
  // Excel is held to the display down in recalc(). Up here the sheet has to be
  // coherent to begin with: something visible to hold Excel to, and an
  // alignment that agrees with what Excel does to a real number.
  {
    const numeric = (s: string) => s.trim() !== '' && Number.isFinite(Number(s));
    for (const r of reel.sheet.rows)
      for (const key of DATA_KEYS) {
        const s = r.stored?.[key];
        if (!s) continue;
        if (!r[key])
          f.push({
            level: 'error',
            message: `row ${r.n} column ${key.toUpperCase()}: stores ${s.value} but shows nothing, so there is no display to verify`,
          });
        if (key === 'a' && numeric(s.value) && !r.right)
          f.push({
            level: 'error',
            message: `row ${r.n}: column A stores the number ${s.value}, which Excel right-aligns. Set right: true, or the sheet contradicts the alignment lesson from 001.`,
          });
      }
  }

  for (const key of ['before', 'after'] as const) {
    const fm = reel.formulas[key];
    if (fm.cell !== reel.sheet.target)
      f.push({ level: 'error', message: `formulas.${key} targets ${fm.cell}, sheet target is ${reel.sheet.target}` });
    if (!fm.expected.trim())
      f.push({ level: 'error', message: `formulas.${key}.expected is empty — nothing to verify against` });
    // `before.text` is what the viewer types BEFORE the insert, so its refs
    // are in the old sheet's coordinates; everything else is in the final
    // sheet's. Checking each against the right one is what stops a writer
    // quietly referencing a column that does not exist yet.
    const preInsert = key === 'before' && !!reel.sheet.mutation;
    for (const ref of refsIn(fm.text))
      if (preInsert ? !cellExistedBefore(ref) : !cellExists(ref))
        f.push({
          level: 'error',
          message: preInsert
            ? `formulas.before references ${ref}, which is outside the sheet as it stands before the insert`
            : `formulas.${key} references ${ref}, outside the rendered sheet`,
        });
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

  // --- the mutation, if there is one ---------------------------------------
  // The whole family of "it worked until someone changed the sheet" reels
  // hangs on three things agreeing: a newcomer that actually holds something,
  // a working value before it arrives, and a formula the insert rewrote.
  {
    const m = reel.sheet.mutation;
    const before = reel.formulas.before;
    if (m) {
      if (m.kind === 'insertColumn') {
        const i = colIndex(m.at);
        if (i < 0 || i >= dataColumnCount(reel))
          f.push({ level: 'error', message: `mutation inserts column ${m.at}, which the sheet does not render` });
        else if (!reel.sheet.rows.some((r) => r[DATA_KEYS[i]]))
          f.push({ level: 'error', message: `mutation inserts column ${m.at} but every cell in it is empty — nothing would appear` });
      } else {
        const row = reel.sheet.rows.find((r) => r.n === Number(m.at));
        if (!row) f.push({ level: 'error', message: `mutation inserts row ${m.at}, which is not in the sheet` });
        else if (!row.a && !row.b)
          f.push({ level: 'error', message: `mutation inserts row ${m.at} but it is empty — nothing would appear` });
      }
      if (!cues.includes(m.kind))
        f.push({ level: 'error', message: `sheet.mutation is ${m.kind} but no line carries the ${m.kind} cue` });
      if (!cues.includes('showInitial'))
        f.push({ level: 'error', message: 'a mutation reel needs a showInitial cue — the viewer has to see the formula working before it breaks' });
      if (!before.expectedInitial?.trim())
        f.push({ level: 'error', message: 'formulas.before.expectedInitial is required on a mutation reel: what the formula shows before the insert' });
      if (!before.textAfter?.trim())
        f.push({ level: 'error', message: 'formulas.before.textAfter is required on a mutation reel: the formula as Excel rewrites it during the insert' });
      if (before.expectedInitial && before.expectedInitial === before.expected)
        f.push({ level: 'error', message: 'expectedInitial equals expected — the insert changed nothing, so there is no lesson' });
      if (before.textAfter)
        for (const ref of refsIn(before.textAfter))
          if (!cellExists(ref))
            f.push({ level: 'error', message: `formulas.before.textAfter references ${ref}, outside the rendered sheet` });
    } else {
      for (const cue of ['showInitial', 'insertColumn', 'insertRow'] as const)
        if (cues.includes(cue))
          f.push({ level: 'error', message: `cue ${cue} needs sheet.mutation — there is no insert in this reel` });
      if (before.expectedInitial || before.textAfter)
        f.push({ level: 'error', message: 'expectedInitial / textAfter only mean something on a reel with sheet.mutation' });
      if (reel.sheet.rows.some((r) => r.c))
        f.push({ level: 'error', message: 'column C holds data but nothing inserts a column, so it would never render' });
    }
  }

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

  // --- control characters ---------------------------------------------------
  // A writer that fumbles a JSON escape plants garbage where an invisible
  // character was meant (reel 005: a backspace escape where U+00A0 was
  // intended). Nothing below U+0020 is ever legitimate content; a newline is
  // a line break in captions/overlays only. NBSP (U+00A0) is data, allowed.
  {
    const control = (s: string, allowNewline: boolean) =>
      [...s].find((c) => {
        const cp = c.codePointAt(0) ?? 0;
        return (cp < 0x20 && !(allowNewline && c === '\n')) || cp === 0x7f;
      });
    const name = (c: string) => `U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;
    for (const r of reel.sheet.rows)
      for (const col of ['a', 'b'] as const) {
        const bad = control(r[col], false);
        if (bad !== undefined)
          f.push({
            level: 'error',
            message: `sheet row ${r.n} column ${col.toUpperCase()}: control character ${name(bad)} in the cell text. If an invisible space was meant, use a real non-breaking space (JSON \\u00a0).`,
          });
      }
    for (const key of ['before', 'after'] as const) {
      const bad = control(reel.formulas[key].text, false);
      if (bad !== undefined)
        f.push({ level: 'error', message: `formulas.${key}.text: control character ${name(bad)} in the formula` });
    }
    for (const [where, text] of facing) {
      const bad = control(text, true);
      if (bad !== undefined)
        f.push({ level: 'error', message: `${where}: control character ${name(bad)}` });
    }
  }

  // --- column fit (widths auto-size, but A and B compete for one card) ------
  {
    const n = dataColumnCount(reel);
    const value = [
      ...Object.values(reel.sheet.fillDown).map((s) => s.length),
      reel.formulas.before.expected.length,
      reel.formulas.before.expectedInitial?.length ?? 0,
      reel.formulas.after.expected.length,
    ];
    const widest = DATA_KEYS.slice(0, n).map((key, i) =>
      Math.max(...reel.sheet.rows.map((r) => r[key].length), ...(i === n - 1 ? value : [0]), 0),
    );
    // Each data column costs ~36px of padding out of the 898px card, and the
    // audit marks keep 190px of it, so the budget tightens as columns are added.
    const budget = n === 2 ? 42 : 38;
    const total = widest.reduce((a, b) => a + b, 0);
    if (total > budget)
      f.push({
        level: 'warn',
        message: `${widest.map((w, i) => `${colLetter(i)} ${w}`).join(' + ')} = ${total} chars across ${n} columns exceeds the ~${budget} that fit; something will clip — shorten the data`,
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

/**
 * Runs the reel's formulas in Excel and compares what Excel displays to what
 * the reel claims the viewer will see.
 *
 * Two comparisons for a plain reel: the broken formula, then the fix.
 *
 * Data cells are compared too, wherever a row declares `stored`: the reel says
 * A2 reads 01/09/2026 while Excel holds 46031, and Excel settles it.
 *
 * Three formula checks for a mutation reel, because there are three moments on screen — the
 * formula working in the original sheet, the same formula after Excel shifted
 * and rewrote it during the insert, and the fix. The middle one is the whole
 * lesson, and its `formulaReadback` is compared against `textAfter`: Excel
 * decides what an insert does to a formula, and the reel has to show that.
 */
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

  const { before, after } = reel.formulas;
  type Check = { key: string; where: string; typed: string; expected: string; isError: boolean };
  const checks: Check[] = reel.sheet.mutation
    ? [
        {
          key: 'initial',
          where: 'formulas.before, in the sheet before the insert',
          typed: before.text,
          expected: before.expectedInitial ?? '',
          isError: false,
        },
        {
          key: 'before',
          where: 'formulas.before, after Excel performed the insert',
          typed: before.textAfter ?? '',
          expected: before.expected,
          isError: before.isError,
        },
        { key: 'after', where: 'formulas.after', typed: after.text, expected: after.expected, isError: after.isError },
      ]
    : [
        { key: 'before', where: 'formulas.before', typed: before.text, expected: before.expected, isError: before.isError },
        { key: 'after', where: 'formulas.after', typed: after.text, expected: after.expected, isError: after.isError },
      ];

  for (const c of checks) {
    const got = report.results.find((x) => x.key === c.key);
    if (!got) {
      out.push({ level: 'error', message: `${c.where}: Excel returned no result` });
      continue;
    }
    if (got.setError) {
      out.push({ level: 'error', message: `${c.where}: Excel rejected the formula — ${got.setError}` });
      continue;
    }
    if (got.formulaReadback && !sameFormula(got.formulaReadback, c.typed))
      out.push({
        level: 'error',
        message:
          c.key === 'before' && reel.sheet.mutation
            ? `formulas.before.textAfter says the insert leaves ${c.typed}, but Excel made it ${got.formulaReadback}. Show what Excel actually does.`
            : `${c.where}: Excel rewrote the formula to ${got.formulaReadback} (typed: ${c.typed}). Fix the text so the viewer sees exactly what Excel runs.`,
      });
    if (got.text !== c.expected)
      out.push({
        level: 'error',
        message: `${c.where}: expected "${c.expected}", Excel ${report.excel} displays "${got.text}"`,
      });
    if (got.isError !== c.isError)
      out.push({
        level: 'error',
        message:
          c.key === 'initial'
            ? `formulas.before returns an error in the ORIGINAL sheet. The premise of an insert reel is that it worked until the insert.`
            : `${c.where}: isError is ${c.isError} but Excel ${got.isError ? 'returned an error value' : 'returned a normal value'}`,
      });
  }

  // A cell that claims to display one thing while storing another is held to
  // the claim. Get this wrong and the viewer reads a date that Excel never
  // showed, which is the same failure as a wrong `expected`.
  for (const d of report.display)
    if (d.text !== d.expected)
      out.push({
        level: 'error',
        message: `sheet cell ${d.ref}: the reel shows "${d.expected}" but Excel ${report.excel} displays "${d.text}" for the value it stores. Fix the number format or the text.`,
      });

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
  h.update(JSON.stringify({ rows: reel.sheet.rows, mutation: reel.sheet.mutation ?? null, formulas: reel.formulas }));
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
