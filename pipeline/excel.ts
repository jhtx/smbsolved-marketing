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

export type ExcelCell = { ref: string; value: string; kind: 'text' | 'number' };
export type ExcelFormula = { key: string; cell: string; text: string; numberFormat?: string };
export type ExcelJob = { cells: ExcelCell[]; formulas: ExcelFormula[] };

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
export type ExcelReport = { excel: string; results: ExcelResult[] };

const SCRIPT = resolve(import.meta.dirname ?? __dirname, 'excel', 'recalc.ps1');

/** Maps a reel's sheet + formulas onto a recalculation job. */
export function jobFromReel(reel: Reel): ExcelJob {
  const cells: ExcelCell[] = [];
  const isNumeric = (s: string) => s.trim() !== '' && Number.isFinite(Number(s));

  for (const r of reel.sheet.rows) {
    // Column A: alignment IS the lesson. `right` means Excel holds a number;
    // otherwise the digits are text, the way a GL export delivers them.
    if (r.a) cells.push({ ref: `A${r.n}`, value: r.a, kind: r.right && isNumeric(r.a) ? 'number' : 'text' });
    // Column B: amounts are numbers, everything else is text.
    if (r.b) cells.push({ ref: `B${r.n}`, value: r.b, kind: isNumeric(r.b) ? 'number' : 'text' });
  }

  const formulas: ExcelFormula[] = (['before', 'after'] as const).map((key) => ({
    key,
    cell: reel.formulas[key].cell,
    text: reel.formulas[key].text,
    numberFormat: reel.formulas[key].numberFormat,
  }));

  return { cells, formulas };
}

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
  return JSON.parse(line) as ExcelReport;
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
