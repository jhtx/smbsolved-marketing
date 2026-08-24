/**
 * Visual grammar. Locked — see CLAUDE.md.
 * Geometry lives here too so the audit marks can be positioned from cell
 * refs instead of magic numbers in the composition.
 */

export const COLOR = {
  ledger: '#10382C',
  ledgerRule: '#1B4A3B',
  paper: '#FBFAF6',
  ink: '#17211E',
  grid: '#D8D6CE',
  headFill: '#F0EFEA',
  headInk: '#5A5A5A',
  xl: '#1E7B4D',
  xlBright: '#26A566',
  tick: '#C43F2E',
  tickSoft: '#F0806F',
  chalk: '#F2EFE4',
  dim: '#8FA79C',
} as const;

export const FONT = {
  /** bundle these in public/fonts — headless Chrome has no system fonts */
  sheet: '"ReelSheet","Aptos Narrow","Segoe UI",Arial,sans-serif',
  display: '"ReelDisplay",system-ui,-apple-system,sans-serif',
  mono: '"ReelMono",ui-monospace,Menlo,Consolas,monospace',
} as const;

export const VIDEO = { width: 1080, height: 1920, fps: 30 } as const;

/** Sheet card geometry, in stage pixels. */
export const GEO = {
  cardX: 60,
  cardY: 380,
  cardW: 960,
  fbarH: 70,
  headH: 44,
  rowH: 60,
  rhW: 62,
  colW: { A: 190, B: 470, C: 238 },
} as const;

export type ColW = { A: number; B: number; C: number };

/**
 * Column widths sized to the reel's content, so a 20-character vendor name is
 * never clipped (the clipped part is often the lesson — a trailing space).
 * Column C stays fixed: the audit tick and the TEXT/NUMBER pills live there.
 * ~15.4px per character at the 30px sheet font, plus cell padding.
 */
export function colWidthsFor(reel: {
  sheet: { rows: { a: string; b: string }[]; fillDown: Record<string, string> };
  formulas: { before: { expected: string }; after: { expected: string } };
}): ColW {
  const CH = 15.4;
  const PAD = 36;
  const total = GEO.cardW - GEO.rhW; // 898
  const C = 190;

  const aMax = Math.max(4, ...reel.sheet.rows.map((r) => r.a.length));
  const bMax = Math.max(
    5,
    ...reel.sheet.rows.map((r) => r.b.length),
    ...Object.values(reel.sheet.fillDown).map((s) => s.length),
    reel.formulas.before.expected.length,
    reel.formulas.after.expected.length,
  );

  let A = Math.min(430, Math.max(170, Math.round(aMax * CH + PAD)));
  const bNeed = Math.min(560, Math.max(220, Math.round(bMax * CH + PAD)));
  if (total - C - A < bNeed) A = Math.max(170, total - C - bNeed);
  return { A, B: total - C - A, C };
}

/** Absolute stage position of a cell, e.g. cellBox('B2', colW). */
export function cellBox(ref: string, colW: ColW = GEO.colW) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`bad cell ref: ${ref}`);
  const [, col, rowStr] = m;
  const row = Number(rowStr);

  const order = ['A', 'B', 'C'] as const;
  const i = order.indexOf(col as (typeof order)[number]);
  if (i < 0) throw new Error(`column ${col} is not rendered`);

  const x =
    GEO.cardX +
    GEO.rhW +
    order.slice(0, i).reduce((sum, c) => sum + colW[c], 0);
  const y = GEO.cardY + GEO.fbarH + GEO.headH + (row - 1) * GEO.rowH;

  return { x, y, w: colW[col as (typeof order)[number]], h: GEO.rowH };
}

/**
 * Union of the organic UI overlays on Instagram Reels, TikTok, YouTube Shorts
 * and LinkedIn (2026 measurements; TikTok's bottom 484px and the right-hand
 * action rails are the binding constraints). Keep captions and anything that
 * carries meaning inside the box. The right rail runs roughly y 1100–1750.
 * If reels are ever boosted as Meta ads the bottom margin becomes 672.
 */
export const SAFE = { top: 270, bottom: 500, left: 60, right: 180, railTop: 1100, railBottom: 1750 } as const;

/** Caption block: top edge and horizontal margins, derived from SAFE. */
export const CAPTION = { top: 1110, left: 80, right: 180, fontSize: 56, maxCharsPerLine: 28 } as const;
