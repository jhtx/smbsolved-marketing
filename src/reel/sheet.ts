/**
 * Sheet coordinates, and the one place that knows what a mutation does to
 * them. The gate, the composition and the writer prompt all have to agree on
 * exactly this arithmetic, so none of them work it out for themselves.
 *
 * The rule, from DECISIONS.md 2026-08-24: a reel's JSON always describes the
 * sheet AFTER the insert. `sheet.mutation.at` names the newcomer. Everything
 * about the *original* sheet is derived here by taking the newcomer back out.
 *
 * Column letters and row numbers on screen are positional. Inserting a column
 * never relabels a header; it slides the data under it. So the same cell is
 * B8 before the insert and C8 after, and the name box changes on its own.
 */
import type { Reel } from './schema';

/** Every column the sheet can render: three data columns plus the marks column. */
export const COL_ORDER = ['A', 'B', 'C', 'D'] as const;
export type ColKey = (typeof COL_ORDER)[number];

/** Schema keys holding data, in column order. */
export const DATA_KEYS = ['a', 'b', 'c'] as const;
export type DataKey = (typeof DATA_KEYS)[number];

type SheetLike = Pick<Reel, 'sheet'>;

/** 3 data columns for an insertColumn reel, 2 for everything else. */
export function dataColumnCount(reel: SheetLike): 2 | 3 {
  return reel.sheet.mutation?.kind === 'insertColumn' ? 3 : 2;
}

/**
 * The column the audit tick and the TEXT / NUMBER pills live in: always the
 * one just past the data. C normally, D when a column was inserted.
 */
export function marksColumn(reel: SheetLike): ColKey {
  return COL_ORDER[dataColumnCount(reel)];
}

/** Column letter → 0-based index. 'A' → 0. */
export const colIndex = (col: string) => col.charCodeAt(0) - 65;
/** 0-based index → column letter. 0 → 'A'. */
export const colLetter = (i: number) => String.fromCharCode(65 + i);

export function splitRef(ref: string): { col: string; row: number } {
  const m = /^([A-Z]{1,2})(\d{1,3})$/.exec(ref);
  if (!m) throw new Error(`bad cell ref: ${ref}`);
  return { col: m[1], row: Number(m[2]) };
}

/** The column a mutation inserts, or null. */
export function insertedColumn(reel: SheetLike): string | null {
  const m = reel.sheet.mutation;
  return m?.kind === 'insertColumn' ? m.at : null;
}

/** The row number a mutation inserts, or null. */
export function insertedRow(reel: SheetLike): number | null {
  const m = reel.sheet.mutation;
  return m?.kind === 'insertRow' ? Number(m.at) : null;
}

/** Rows as they exist in the ORIGINAL sheet: the newcomer row is not there yet. */
export function initialRows(reel: Reel): Reel['sheet']['rows'] {
  const newRow = insertedRow(reel);
  if (newRow === null) return reel.sheet.rows;
  return reel.sheet.rows
    .filter((r) => r.n !== newRow)
    .map((r) => (r.n > newRow ? { ...r, n: r.n - 1 } : r));
}

/**
 * Data keys as they appear in the ORIGINAL sheet, in column order. For an
 * insertColumn reel the newcomer is skipped, so ['a','c'] renders at A and B.
 */
export function initialDataKeys(reel: SheetLike): DataKey[] {
  const at = insertedColumn(reel);
  const keys = DATA_KEYS.slice(0, dataColumnCount(reel));
  if (!at) return [...keys];
  return keys.filter((_, i) => colLetter(i) !== at);
}

/**
 * A final-state cell ref translated back to the original sheet, or null when
 * the cell did not exist yet (it IS the newcomer). C8 → B8 for an insert at B.
 */
export function initialRef(reel: SheetLike, ref: string): string | null {
  const m = reel.sheet.mutation;
  if (!m) return ref;
  const { col, row } = splitRef(ref);
  if (m.kind === 'insertColumn') {
    if (col === m.at) return null;
    const i = colIndex(col);
    return `${i > colIndex(m.at) ? colLetter(i - 1) : col}${row}`;
  }
  const at = Number(m.at);
  if (row === at) return null;
  return `${col}${row > at ? row - 1 : row}`;
}

/**
 * Whether a rendered cell exists in the original sheet. Used by the gate to
 * check that the pre-insert formula only references cells that were there.
 */
export const existedBefore = (reel: SheetLike, ref: string) => initialRef(reel, ref) !== null;
