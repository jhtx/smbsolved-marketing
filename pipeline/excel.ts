/**
 * Real-Excel recalculation, via COM, from Node.
 *
 * This is the gate behind "nothing renders that has not been verified". It
 * replaces the LibreOffice proxy: LibreOffice is not Excel, and the channel
 * lives on exactly the coercion edge cases where they differ. Excel is
 * installed on the build machine, so we ask Excel.
 *
 * Fails CLOSED: if Excel is unavailable the caller gets an exception, never a
 * pass. Requires an interactive user session (Office COM does not run from
 * services / Session 0 — see DECISIONS.md).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Reel } from '../src/reel/schema';
import { DATA_KEYS, initialDataKeys, initialRef, initialRows, insertedColumn, insertedRow, type DataKey } from '../src/reel/sheet';

type Row = Reel['sheet']['rows'][number];

export type ExcelCell = {
  ref: string;
  value: string;
  kind: 'text' | 'number';
  /**
   * Number format for a cell whose display differs from what it stores (a date
   * serial under "mm/dd/yyyy"). When set it decides the format outright, so
   * `kind` no longer does.
   */
  numberFormat?: string;
  /** the text the reel puts on screen for this cell; Excel is held to it */
  expectText?: string;
};
export type ExcelFormula = { key: string; cell: string; text: string; numberFormat?: string };
/**
 * The sheet change a mutation reel makes, performed by Excel itself between
 * the two calculation passes. Excel — not us — decides what an inserted column
 * does to a formula that spans it, which is the entire lesson of that family
 * of reels, so we ask it rather than predicting it.
 */
export type ExcelMutation = {
  kind: 'insertColumn' | 'insertRow';
  /** column letter, or row number as a string */
  at: string;
  /** what goes into the newcomer once Excel has made room for it */
  cells: ExcelCell[];
};
export type ExcelJob = {
  cells: ExcelCell[];
  formulas: ExcelFormula[];
  /** applied after `formulas` are calculated; `formulasAfter` then run */
  mutation?: ExcelMutation;
  /** calculated after the mutation. Keys are separate from `formulas`. */
  formulasAfter?: ExcelFormula[];
};

export type ExcelResult = {
  key: string;
  cell: string;
  /** what the cell displays — this is what we compare to `expected` */
  text: string | null;
  value: string | number | boolean | null;
  isError: boolean;
  /** xlCVError code, e.g. 2042 for #N/A */
  errCode: number | null;
  /** the formula as Excel stored it; differs from input when Excel "fixed" it */
  formulaReadback: string | null;
  /** COM exception while setting the formula (hard syntax error) */
  setError: string | null;
};
/** A data cell the reel claims displays one thing while storing another. */
export type ExcelDisplay = { ref: string; text: string | null; expected: string };
export type ExcelReport = { excel: string; results: ExcelResult[]; display: ExcelDisplay[] };

const SCRIPT = resolve(import.meta.dirname ?? __dirname, 'excel', 'recalc.ps1');

const isNumeric = (s: string) => s.trim() !== '' && Number.isFinite(Number(s));

/**
 * How a cell's value is stored. Column A carries the alignment lesson: `right`
 * means Excel holds a real number, otherwise the digits are text, the way a GL
 * export delivers them. Every other column stores numbers as numbers.
 */
const kindFor = (key: string, value: string, right: boolean): 'text' | 'number' =>
  key === 'a' ? (right && isNumeric(value) ? 'number' : 'text') : isNumeric(value) ? 'number' : 'text';

/**
 * One data cell of the job.
 *
 * A row that declares `stored` for this column overrides both halves: Excel
 * holds that value under that number format, and the text the sheet shows
 * rides along as `expectText` so the gate can hold Excel to displaying it.
 * That is the only way a cell can read 01/09/2026 on screen while LEFT()
 * still gets at the serial underneath (DECISIONS.md 2026-08-31).
 */
const cellFor = (row: Row, key: DataKey, ref: string): ExcelCell => {
  const s = row.stored?.[key];
  return s
    ? { ref, value: s.value, kind: isNumeric(s.value) ? 'number' : 'text', numberFormat: s.fmt, expectText: row[key] }
    : { ref, value: row[key], kind: kindFor(key, row[key], row.right) };
};

/**
 * Maps a reel's sheet + formulas onto a recalculation job.
 *
 * A plain reel is one pass: write the cells, run both formulas, report.
 *
 * A mutation reel is two. Pass one builds the sheet as it was BEFORE the
 * insert — the newcomer column or row simply left out, everything after it
 * pulled back a position — and runs the `before` formula there, which is the
 * value the viewer sees working at `showInitial`. Then Excel performs the real
 * insert, the newcomer's values go in, and pass two reads the same cell again
 * (Excel has rewritten the formula by now, and what it rewrote it to is what
 * the reel must show) plus the fix.
 */
export function jobFromReel(reel: Reel): ExcelJob {
  const mutation = reel.sheet.mutation;
  const before = reel.formulas.before;
  const after = reel.formulas.after;

  if (!mutation) {
    const cells: ExcelCell[] = [];
    for (const r of reel.sheet.rows)
      for (const key of ['a', 'b'] as const)
        if (r[key]) cells.push(cellFor(r, key, `${key.toUpperCase()}${r.n}`));

    const formulas: ExcelFormula[] = (['before', 'after'] as const).map((key) => ({
      key,
      cell: reel.formulas[key].cell,
      text: reel.formulas[key].text,
      numberFormat: reel.formulas[key].numberFormat,
    }));
    return { cells, formulas };
  }

  // --- pass one: the sheet as it was ---------------------------------------
  const keys = initialDataKeys(reel);
  const cells: ExcelCell[] = [];
  // initialRows() drops the newcomer row and renumbers what sat below it;
  // initialDataKeys() drops the newcomer column and closes the gap. Between
  // them, `keys[i]` is the data that renders at column i of the old sheet.
  for (const r of initialRows(reel))
    keys.forEach((key, i) => {
      if (r[key]) cells.push(cellFor(r, key, `${String.fromCharCode(65 + i)}${r.n}`));
    });

  const initialCell = initialRef(reel, before.cell);
  if (!initialCell) throw new Error(`formulas.before.cell ${before.cell} is the inserted ${mutation.kind === 'insertColumn' ? 'column' : 'row'}`);

  // --- the insert, and what fills the newcomer ------------------------------
  const newCells: ExcelCell[] = [];
  if (mutation.kind === 'insertColumn') {
    const key = DATA_KEYS[mutation.at.charCodeAt(0) - 65];
    for (const r of reel.sheet.rows)
      if (r[key]) newCells.push(cellFor(r, key, `${mutation.at}${r.n}`));
  } else {
    const row = reel.sheet.rows.find((r) => r.n === Number(mutation.at));
    if (row)
      DATA_KEYS.slice(0, 2).forEach((key, i) => {
        if (row[key]) newCells.push(cellFor(row, key, `${String.fromCharCode(65 + i)}${row.n}`));
      });
  }

  return {
    cells,
    // Pass one runs the pre-insert formula where it lived pre-insert.
    formulas: [{ key: 'initial', cell: initialCell, text: before.text, numberFormat: before.numberFormat }],
    mutation: { kind: mutation.kind, at: mutation.at, cells: newCells },
    formulasAfter: [
      // `before` is NOT retyped: Excel shifted and rewrote it during the
      // insert, and the readback is what the viewer sees in the formula bar.
      { key: 'before', cell: before.cell, text: '', numberFormat: before.numberFormat },
      { key: 'after', cell: after.cell, text: after.text, numberFormat: after.numberFormat },
    ],
  };
}

/** True when the job needs Excel to mutate the sheet mid-run. */
export const isTwoPass = (job: ExcelJob) => !!job.mutation;

/** Runs the job in Excel. Synchronous; ~2-4s including Excel start-up. */
export function recalcInExcel(job: ExcelJob): ExcelReport {
  if (process.platform !== 'win32') {
    throw new Error('Excel recalculation needs Windows + Excel (COM). See pipeline/excel.ts.');
  }
  const dir = mkdtempSync(join(tmpdir(), 'reel-excel-'));
  const jobPath = join(dir, 'job.json');
  writeFileSync(jobPath, JSON.stringify(job), 'utf8');

  let stdout: string;
  try {
    stdout = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-JobPath', jobPath],
      { encoding: 'utf8', timeout: 120_000, windowsHide: true },
    );
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(`Excel recalculation failed: ${(err.stderr || err.message).trim().split('\n')[0]}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const line = stdout.trim().split('\n').reverse().find((l) => l.trim().startsWith('{'));
  if (!line) throw new Error(`Excel recalculation produced no JSON:\n${stdout}`);
  const report = JSON.parse(line) as ExcelReport;
  // ConvertTo-Json renders a one-element array as a bare object, and a sheet
  // with a single `stored` cell is an ordinary reel, not an edge case.
  const d = report.display as ExcelDisplay[] | ExcelDisplay | undefined;
  report.display = Array.isArray(d) ? d : d ? [d] : [];
  return report;
}

/** Whitespace- and case-insensitive formula equality (Excel normalises both). */
export function sameFormula(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase();
  return norm(a) === norm(b);
}

// CLI: npx tsx pipeline/excel.ts content/reels/001-*.json
if (process.argv[1]?.endsWith('excel.ts')) {
  const { readFileSync } = await import('node:fs');
  const { reelSchema } = await import('../src/reel/schema');
  const reel = reelSchema.parse(JSON.parse(readFileSync(process.argv[2], 'utf8')));
  const report = recalcInExcel(jobFromReel(reel));
  console.log(JSON.stringify(report, null, 2));
}
