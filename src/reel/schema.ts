import { z } from 'zod';

export const CUES = [
  'hook',
  'revealTop',
  'revealBottom',
  'typeFormula',
  'showError',
  'markError',
  'showAlignment',
  'typeFix',
  'showResult',
  'fillDown',
  'payoff',
] as const;

export const cueSchema = z.enum(CUES);
export type Cue = z.infer<typeof cueSchema>;

/** One spreadsheet row. `a` and `b` are the visible columns. */
export const rowSchema = z.object({
  n: z.number().int().min(1).max(20),
  a: z.string().default(''),
  b: z.string().default(''),
  /** header styling (bold) */
  hdr: z.boolean().default(false),
  /** right-align column A. this is the whole point of reel 001 — alignment carries meaning */
  right: z.boolean().default(false),
  /** which stagger group this row reveals with */
  group: z.enum(['top', 'bottom', 'none']).default('top'),
});

/** One line of narration. Drives both the caption and the animation timing. */
export const lineSchema = z.object({
  /** spoken by ElevenLabs */
  vo: z.string().min(1),
  /**
   * burned-in caption. `\n` breaks the line, *asterisks* accent a span.
   * omit to reuse `vo` verbatim.
   */
  caption: z.string().optional(),
  /** animation beat occupying this line's time window */
  cue: cueSchema.optional(),
});

/**
 * A formula shown in the reel. `expected` is what Excel actually returns.
 * verify.ts refuses to pass if the computed result disagrees.
 */
export const formulaSchema = z.object({
  cell: z.string().regex(/^[A-Z]{1,2}\d{1,3}$/),
  text: z.string().min(1),
  /**
   * what the cell DISPLAYS after calculation — Excel's `.Text`, not `.Value2`.
   * A date shows as "3/15/2026" only if `numberFormat` says so; in General it
   * is "46096". Write what the viewer should see and set the format to match.
   */
  expected: z.string(),
  /** true when the result is an Excel error value, e.g. #N/A */
  isError: z.boolean().default(false),
  /** Excel number format applied to the cell, e.g. "m/d/yyyy" or "#,##0.00". Default General. */
  numberFormat: z.string().optional(),
});

export const reelSchema = z.object({
  id: z.string().regex(/^\d{3}$/),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),

  hook: z.object({
    /** oversized red line, usually an error value */
    lead: z.string(),
    /** the turn */
    body: z.string(),
  }),

  payoff: z.object({
    headline: z.string(),
    sub: z.string(),
  }),

  sheet: z.object({
    rows: z.array(rowSchema).min(1).max(14),
    /** cell the selection box and audit marks attach to */
    target: z.string().regex(/^[A-Z]{1,2}\d{1,3}$/),
    /** populated during fillDown, keyed by row number */
    fillDown: z.record(z.string(), z.string()).default({}),
    /**
     * cells the TEXT / NUMBER pills point at during showAlignment.
     * omit for reels that don't use the cue.
     */
    alignment: z
      .object({ textCell: z.string(), numberCell: z.string() })
      .optional(),
  }),

  /** the broken formula, then the fix */
  formulas: z.object({
    before: formulaSchema,
    after: formulaSchema,
  }),

  script: z.array(lineSchema).min(2),

  /**
   * Post copy, delivered alongside the MP4. First line of `description` is
   * the search phrase an accountant would type; hashtags are topic labels
   * (≤5, Instagram caps there and says they do not lift reach).
   */
  post: z
    .object({
      /** YouTube title / LinkedIn first line, ≤70 chars */
      title: z.string(),
      /** 1–3 plain sentences; search phrase first */
      description: z.string(),
      hashtags: z.array(z.string()).max(5),
    })
    .optional(),

  /**
   * Written by `verify.ts --stamp` / `build.ts` after BOTH formulas were
   * recalculated in real Excel (COM) and displayed exactly `expected`.
   * Informational: the build re-runs Excel every time regardless, so a stale
   * or hand-edited stamp buys nothing. `formulasHash` lets a reader see
   * whether the sheet/formulas changed since the stamp. See CLAUDE.md.
   */
  verification: z
    .object({
      /** Excel version.build that computed it, e.g. "16.0.20326" */
      excel: z.string(),
      /** ISO date */
      on: z.string(),
      formulasHash: z.string(),
    })
    .optional(),
});

export type Reel = z.infer<typeof reelSchema>;
export type Row = z.infer<typeof rowSchema>;
export type Line = z.infer<typeof lineSchema>;
