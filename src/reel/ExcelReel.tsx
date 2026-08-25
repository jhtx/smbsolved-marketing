import React from 'react';
import {
  AbsoluteFill,
  Audio,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import type { Reel, Row } from './schema';
import {
  COL_ORDER,
  DATA_KEYS,
  colIndex,
  colLetter,
  dataColumnCount,
  initialRef,
  marksColumn,
  splitRef,
  type ColKey,
} from './sheet';
import { CAPTION, COLOR, FONT, GEO, SAFE, cellBox, colWidthsFor, type ColW } from './theme';
import { buildTimeline, progress, started, type Timing } from './timeline';

export type ExcelReelProps = {
  reel: Reel;
  timing?: Timing | null;
  audioSrc?: string | null;
  /** dev-only guide showing where Instagram's UI sits */
  showSafeArea?: boolean;
};

const eOut = (x: number) => 1 - Math.pow(1 - x, 3);
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/* ------------------------------------------------------------------ */
/* the insert                                                          */
/* ------------------------------------------------------------------ */

/**
 * A mutation reel spends its first half in a sheet that is one column (or one
 * row) narrower than the JSON describes. Rather than model two sheets, the
 * newcomer is rendered at zero size and opens on its cue, which is also what
 * it looks like in Excel.
 *
 * `p` runs 0 → 1 across the insert. Everything at or past the newcomer is
 * displaced by `size * (1 - p)`, so the whole sheet slides over as it opens.
 */
type Insert = {
  kind: 'insertColumn' | 'insertRow' | null;
  at: string;
  p: number;
  /** pixels the newcomer occupies once open */
  size: number;
};

const NO_INSERT: Insert = { kind: null, at: '', p: 1, size: 0 };

function insertState(reel: Reel, cues: CueMap, frame: number, colW: ColW): Insert {
  const m = reel.sheet.mutation;
  if (!m) return NO_INSERT;
  return {
    kind: m.kind,
    at: m.at,
    p: eOut(clamp(progress(cues[m.kind], frame) * 1.8)),
    size: m.kind === 'insertColumn' ? colW[m.at as ColKey] : GEO.rowH,
  };
}

/** Displacement for anything positioned absolutely: it rides the insert. */
function shift(ins: Insert, ref: string): { dx: number; dy: number } {
  if (!ins.kind) return { dx: 0, dy: 0 };
  const { col, row } = splitRef(ref);
  const back = ins.size * (1 - ins.p);
  return ins.kind === 'insertColumn'
    ? { dx: colIndex(col) >= colIndex(ins.at) ? -back : 0, dy: 0 }
    : { dx: 0, dy: row >= Number(ins.at) ? -back : 0 };
}

/**
 * Column letters and row numbers are what Excel would print, which is a matter
 * of position, not of which key the JSON used. Until the insert lands, every
 * label past the newcomer is one lower — the sheet genuinely has one less
 * column, and its last column is genuinely called C and not D.
 */
const columnLabel = (ins: Insert, i: number) =>
  colLetter(ins.kind === 'insertColumn' && ins.p === 0 && i > colIndex(ins.at) ? i - 1 : i);

const rowLabel = (ins: Insert, n: number) =>
  ins.kind === 'insertRow' && ins.p === 0 && n > Number(ins.at) ? n - 1 : n;

export const ExcelReel: React.FC<ExcelReelProps> = ({
  reel,
  timing,
  audioSrc,
  showSafeArea = false,
}) => {
  const frame = useCurrentFrame();
  const { lines, cues } = buildTimeline(reel.script, timing);

  const colW = colWidthsFor(reel);
  const ins = insertState(reel, cues, frame, colW);
  const targetShift = shift(ins, reel.sheet.target);
  const box = cellBox(reel.sheet.target, colW);
  const target = { ...box, x: box.x + targetShift.dx, y: box.y + targetShift.dy };
  const pFix = progress(cues.typeFix, frame);
  const fixing = started(cues.typeFix, frame);

  return (
    <AbsoluteFill style={{ background: COLOR.ledger, overflow: 'hidden' }}>
      {audioSrc ? <Audio src={staticFile(audioSrc)} /> : null}

      <Rules />
      <Vignette />
      <Eyebrow id={reel.id} />

      <SheetCard reel={reel} frame={frame} cues={cues} colW={colW} ins={ins} />
      <AuditMarks
        target={target}
        frame={frame}
        cues={cues}
        fading={pFix}
        value={reel.formulas.before.expected}
        circleRight={looksNumeric(reel.formulas.before.expected)}
      />
      {reel.sheet.alignment ? (
        <AlignmentPills
          textCell={reel.sheet.alignment.textCell}
          numberCell={reel.sheet.alignment.numberCell}
          frame={frame}
          cues={cues}
          fadeOut={fixing ? clamp(pFix * 4) : 0}
          colW={colW}
          reel={reel}
          ins={ins}
        />
      ) : null}

      <Captions script={reel.script} lines={lines} frame={frame} />

      <Overlay
        show={1 - clamp(progress(cues.hook, frame) * 1.6 - 0.6)}
        lead={reel.hook.lead}
        body={reel.hook.body}
      />
      <Overlay
        show={eOut(clamp(progress(cues.payoff, frame) * 3))}
        headline={reel.payoff.headline}
        sub={reel.payoff.sub}
      />

      {showSafeArea ? <SafeArea /> : null}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ */
/* backdrop                                                            */
/* ------------------------------------------------------------------ */

const Rules: React.FC = () => (
  <AbsoluteFill
    style={{
      opacity: 0.5,
      background: `repeating-linear-gradient(to bottom, transparent 0 59px, ${COLOR.ledgerRule} 59px 60px)`,
    }}
  />
);

const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        'radial-gradient(120% 80% at 50% 38%, transparent 40%, rgba(0,0,0,.42) 100%)',
    }}
  />
);

const Eyebrow: React.FC<{ id: string }> = ({ id }) => (
  <div
    style={{
      position: 'absolute',
      left: 64,
      right: 64,
      top: 104,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      fontFamily: FONT.mono,
      fontSize: 24,
      letterSpacing: '.22em',
      textTransform: 'uppercase',
      color: COLOR.dim,
    }}
  >
    <span>Excel for accountants</span>
    <span style={{ color: COLOR.chalk, fontWeight: 600 }}>No. {id}</span>
  </div>
);

/* ------------------------------------------------------------------ */
/* sheet                                                               */
/* ------------------------------------------------------------------ */

type CueMap = ReturnType<typeof buildTimeline>['cues'];

const SheetCard: React.FC<{ reel: Reel; frame: number; cues: CueMap; colW: ColW; ins: Insert }> = ({
  reel,
  frame,
  cues,
  colW,
  ins,
}) => {
  const enter = eOut(clamp(progress(cues.revealTop, frame) * 3.2));
  const raw = cellBox(reel.sheet.target, colW);
  const d = shift(ins, reel.sheet.target);
  const box = { ...raw, x: raw.x + d.dx, y: raw.y + d.dy };

  return (
    <div
      style={{
        position: 'absolute',
        left: GEO.cardX,
        top: GEO.cardY,
        width: GEO.cardW,
        background: COLOR.paper,
        borderRadius: 5,
        overflow: 'hidden',
        boxShadow: '0 30px 70px rgba(0,0,0,.45)',
        fontFamily: FONT.sheet,
        color: COLOR.ink,
        fontVariantNumeric: 'tabular-nums',
        opacity: enter,
        transform: `translateY(${(1 - enter) * 46}px)`,
      }}
    >
      <FormulaBar reel={reel} frame={frame} cues={cues} ins={ins} />
      <ColumnHeader colW={colW} reel={reel} ins={ins} />
      {reel.sheet.rows.map((r) => (
        <SheetRow key={r.n} row={r} reel={reel} frame={frame} cues={cues} colW={colW} ins={ins} />
      ))}

      <Selection box={box} frame={frame} cues={cues} />
    </div>
  );
};

const Selection: React.FC<{
  box: ReturnType<typeof cellBox>;
  frame: number;
  cues: CueMap;
}> = ({ box, frame, cues }) => {
  const on = clamp(progress(cues.typeFormula, frame) * 12);
  return (
    <div
      style={{
        position: 'absolute',
        left: box.x - GEO.cardX - 3,
        top: box.y - GEO.cardY - 3,
        width: box.w + 6,
        height: box.h + 6,
        border: `3px solid ${COLOR.xl}`,
        opacity: on,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          right: -7,
          bottom: -7,
          width: 12,
          height: 12,
          background: COLOR.xl,
          border: '2px solid #fff',
        }}
      />
    </div>
  );
};

const FormulaBar: React.FC<{ reel: Reel; frame: number; cues: CueMap; ins: Insert }> = ({
  reel,
  frame,
  cues,
  ins,
}) => {
  const { before, after } = reel.formulas;
  const pType = progress(cues.typeFormula, frame);
  const pFix = progress(cues.typeFix, frame);

  // On a mutation reel the insert rewrites the formula without anyone typing:
  // the range stretches over the new column, the column index does not move.
  // From that moment on, THAT is the formula on screen and the one the fix is
  // compared against.
  const inserted = ins.kind !== null && ins.p > 0;
  const broken = inserted && before.textAfter ? before.textAfter : before.text;

  let head = '';
  let lit = '';
  let tail = '';
  let typing = false;
  let litColor: string = COLOR.xl;

  if (started(cues.typeFix, frame)) {
    // Highlight whatever actually changed between the two formulas.
    const d = diff(broken, after.text);
    const n = Math.floor(pFix * after.text.length);
    const s = after.text.slice(0, n);
    head = s.slice(0, Math.min(n, d.start));
    lit = s.slice(Math.min(n, d.start), Math.min(n, d.end));
    tail = s.slice(Math.min(n, d.end));
    typing = pFix < 1;
  } else if (inserted) {
    // Red, because what just changed is what broke it. Excel does this in one
    // step, so there is no typing animation here.
    const d = diff(before.text, broken);
    head = broken.slice(0, d.start);
    lit = broken.slice(d.start, d.end);
    tail = broken.slice(d.end);
    litColor = COLOR.tick;
  } else if (started(cues.typeFormula, frame)) {
    head = before.text.slice(0, Math.floor(pType * before.text.length));
    typing = pType < 1;
  }

  const caret = typing && Math.floor(frame / 6) % 2 === 0;

  // A rewrite (most of the formula changed) is not a "tweak": highlighting
  // it all is noise, so only highlight when the changed span is a minority.
  const d = diff(broken, after.text);
  const isTweak = started(cues.typeFix, frame)
    ? d.end - d.start < after.text.length * 0.6
    : true;

  // Long formulas wrap onto two lines at a smaller size instead of clipping.
  const longest = Math.max(before.text.length, broken.length, after.text.length);
  const fbarFont = longest > 44 ? 22 : 29;

  // The name box shows where the cell IS. An inserted column slides the target
  // along with everything else, so B8 becomes C8 on its own.
  const nameBox = (inserted ? reel.sheet.target : initialRef(reel, reel.sheet.target)) ?? reel.sheet.target;

  const cellStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    borderRight: `1px solid ${COLOR.grid}`,
    flexShrink: 0,
  };

  return (
    <div
      style={{
        height: GEO.fbarH,
        display: 'flex',
        borderBottom: `1px solid ${COLOR.grid}`,
        background: '#fff',
      }}
    >
      <div style={{ ...cellStyle, width: 150, paddingLeft: 18, fontSize: 28, color: '#444' }}>
        {nameBox}
      </div>
      <div style={{ ...cellStyle, width: 64, justifyContent: 'center', fontStyle: 'italic', fontSize: 27, color: '#6C6C6C' }}>
        fx
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px 0 16px',
          fontSize: fbarFont,
          lineHeight: 1.15,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          overflow: 'hidden',
        }}
      >
        <span>
          {head}
          <span style={isTweak ? { color: litColor, fontWeight: 700 } : undefined}>{lit}</span>
          {tail}
        </span>
        {caret ? (
          <span
            style={{
              display: 'inline-block',
              width: 2,
              height: 34,
              background: COLOR.ink,
              marginLeft: 1,
            }}
          />
        ) : null}
      </div>
    </div>
  );
};

const ColumnHeader: React.FC<{ colW: ColW; reel: Reel; ins: Insert }> = ({ colW, reel, ins }) => {
  const cols = renderedColumns(reel, colW, ins);
  return (
    <div
      style={{
        display: 'flex',
        height: GEO.headH,
        background: COLOR.headFill,
        borderBottom: `1px solid ${COLOR.grid}`,
      }}
    >
      <div style={{ width: GEO.rhW, borderRight: `1px solid ${COLOR.grid}`, flexShrink: 0 }} />
      {cols.map((c, i) => (
        <div
          key={c.col}
          style={{
            width: c.width,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 23,
            color: COLOR.headInk,
            borderRight: `1px solid ${COLOR.grid}`,
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {columnLabel(ins, i)}
        </div>
      ))}
      {/* the sheet always continues past the data, the way Excel does */}
      <div style={{ flex: 1 }} />
    </div>
  );
};

/**
 * The columns a row actually draws: every data column, then the one the audit
 * marks live in. The newcomer's width is whatever the insert has opened so far.
 */
function renderedColumns(reel: Reel, colW: ColW, ins: Insert) {
  const cols: { col: ColKey; width: number; key: (typeof DATA_KEYS)[number] | null }[] = [];
  for (let i = 0; i < dataColumnCount(reel); i++) {
    const col = COL_ORDER[i];
    const isNew = ins.kind === 'insertColumn' && ins.at === col;
    cols.push({ col, width: isNew ? colW[col] * ins.p : colW[col], key: DATA_KEYS[i] });
  }
  const marks = marksColumn(reel);
  cols.push({ col: marks, width: colW[marks], key: null });
  return cols;
}

const SheetRow: React.FC<{
  row: Row;
  reel: Reel;
  frame: number;
  cues: CueMap;
  colW: ColW;
  ins: Insert;
}> = ({ row, reel, frame, cues, colW, ins }) => {
  const cue = row.group === 'bottom' ? cues.revealBottom : cues.revealTop;
  const first = reel.sheet.rows.find((r) => r.group === row.group)?.n ?? 1;
  const idx = row.n - first;
  const p =
    row.group === 'none'
      ? eOut(clamp(progress(cues.revealTop, frame) * 3.2))
      : eOut(clamp(progress(cue, frame) * 3.2 - idx * 0.5));

  // The row a mutation inserts is not there at all until its cue; it opens to
  // full height and pushes everything below it down, which is the beat.
  const isNewRow = ins.kind === 'insertRow' && Number(ins.at) === row.n;
  const height = isNewRow ? GEO.rowH * ins.p : GEO.rowH;
  if (isNewRow && ins.p === 0) return <div style={{ height: 0 }} />;

  const cols = renderedColumns(reel, colW, ins);
  const cellBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    padding: '0 16px',
    fontSize: 30,
    borderRight: `1px solid ${COLOR.grid}`,
    borderBottom: `1px solid ${COLOR.grid}`,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  };

  return (
    <div style={{ display: 'flex', height, opacity: isNewRow ? p * ins.p : p }}>
      <div
        style={{
          width: GEO.rhW,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: COLOR.headFill,
          borderRight: `1px solid ${COLOR.grid}`,
          borderBottom: `1px solid ${COLOR.grid}`,
          fontSize: 23,
          color: COLOR.headInk,
          flexShrink: 0,
        }}
      >
        {rowLabel(ins, row.n)}
      </div>

      {cols.map((c, i) => {
        if (!c.key) return <div key={c.col} style={{ ...cellBase, width: c.width }} />;
        const isTarget = `${c.col}${row.n}` === reel.sheet.target;
        const isLast = i === cols.length - 2;
        const text = row[c.key];
        return (
          <div
            key={c.col}
            style={{
              ...cellBase,
              width: c.width,
              padding: c.width < 40 ? 0 : cellBase.padding,
              fontWeight: row.hdr ? 700 : 400,
              // Excel right-aligns numbers. Amounts (and a numeric result in
              // the target cell) must sit right or the sheet reads fake.
              justifyContent: i === 0
                ? row.right
                  ? 'flex-end'
                  : 'flex-start'
                : looksNumeric(
                      isTarget
                        ? reel.formulas.after.expected
                        : (isLast ? reel.sheet.fillDown[String(row.n)] : undefined) ?? text,
                    )
                  ? 'flex-end'
                  : 'flex-start',
              transform: i === 0 ? `translateX(${(1 - p) * -14}px)` : undefined,
            }}
          >
            {isTarget ? (
              <TargetValue reel={reel} frame={frame} cues={cues} />
            ) : isLast ? (
              <FillDownValue reel={reel} row={row} frame={frame} cues={cues} text={text} />
            ) : (
              text
            )}
          </div>
        );
      })}
      <div style={{ flex: 1, borderBottom: `1px solid ${COLOR.grid}` }} />
    </div>
  );
};

const TargetValue: React.FC<{ reel: Reel; frame: number; cues: CueMap }> = ({
  reel,
  frame,
  cues,
}) => {
  const { before, after } = reel.formulas;

  if (started(cues.showResult, frame)) {
    return (
      <span style={{ opacity: clamp(progress(cues.showResult, frame) * 5) }}>
        {after.expected}
      </span>
    );
  }
  if (started(cues.showError, frame)) {
    const p = progress(cues.showError, frame);
    const shake = p < 0.35 ? Math.sin(p * 62) * (1 - p / 0.35) * 7 : 0;
    return (
      <span
        style={{
          // Red = wrong. A wrong NUMBER (0.00 where March should total) is as
          // wrong as #N/A; the state, not the Excel type, picks the colour.
          color: COLOR.tick,
          fontWeight: 700,
          opacity: clamp(p * 6),
          transform: `translateX(${shake}px)`,
        }}
      >
        {before.expected}
      </span>
    );
  }
  // Mutation reels only: the formula lands its CORRECT value first, in plain
  // ink. No tick — it is not a fix, it is a formula quietly doing its job,
  // which is what makes the insert land a moment later.
  if (started(cues.showInitial, frame) && before.expectedInitial) {
    return (
      <span style={{ opacity: clamp(progress(cues.showInitial, frame) * 5) }}>
        {before.expectedInitial}
      </span>
    );
  }
  return null;
};

const FillDownValue: React.FC<{
  reel: Reel;
  row: Row;
  frame: number;
  cues: CueMap;
  /** whatever the cell holds when nothing fills down into it */
  text: string;
}> = ({ reel, row, frame, cues, text }) => {
  const fill = reel.sheet.fillDown[String(row.n)];
  if (!fill) return <>{text}</>;

  const keys = Object.keys(reel.sheet.fillDown).sort();
  const idx = keys.indexOf(String(row.n));
  const p = clamp(progress(cues.fillDown, frame) * 2.4 - idx * 0.8);
  return <span style={{ opacity: p }}>{p > 0 ? fill : ''}</span>;
};

/* ------------------------------------------------------------------ */
/* audit marks — the signature element                                 */
/* ------------------------------------------------------------------ */

const AuditMarks: React.FC<{
  target: ReturnType<typeof cellBox>;
  frame: number;
  cues: CueMap;
  fading: number;
  /** the broken value as displayed, to size the circle */
  value: string;
  /** the broken value is right-aligned (a number), so the circle hugs the right end of the cell */
  circleRight: boolean;
}> = ({ target, frame, cues, fading, value, circleRight }) => {
  const { y, w } = target;

  // The pencil circle is drawn for a 292px-wide span; scale it to the value
  // (~17px per character at 30px) and anchor it over the value, left or right.
  const textW = Math.max(40, value.length * 17);
  const cw = Math.min(292, Math.max(200, textW + 110));
  const s = cw / 292;
  const valueCenter = circleRight ? target.x + w - 16 - textW / 2 : target.x + 16 + textW / 2;
  const x = valueCenter - 120 * s; // the span's visual centre sits ~120*s right of the anchor

  // Deliberately uneven, so it reads as a pencil mark rather than an ellipse.
  const circle = `M ${x + 18 * s} ${y + 8}
    C ${x - 26 * s} ${y + 16}, ${x - 20 * s} ${y + 54}, ${x + 40 * s} ${y + 58}
    C ${x + 120 * s} ${y + 64}, ${x + 232 * s} ${y + 60}, ${x + 250 * s} ${y + 40}
    C ${x + 266 * s} ${y + 18}, ${x + 190 * s} ${y + 2}, ${x + 96 * s} ${y + 4}
    C ${x + 40 * s} ${y + 5}, ${x + 4 * s} ${y + 14}, ${x - 4 * s} ${y + 36}`;

  const pCirc = eOut(progress(cues.markError, frame));
  const pTick = eOut(progress(cues.showResult, frame));

  const CIRC_LEN = Math.round(720 * (0.6 + 0.4 * s));
  const TICK_LEN = 80;

  return (
    <svg
      viewBox="0 0 1080 1920"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <path
        d={circle}
        fill="none"
        stroke={COLOR.tick}
        strokeWidth={6}
        strokeLinecap="round"
        opacity={clamp(pCirc * 8) * (1 - clamp(fading * 4))}
        strokeDasharray={CIRC_LEN}
        strokeDashoffset={CIRC_LEN * (1 - pCirc)}
      />
      {/* tie-out tick sits just right of the cell, in column C — never on the value */}
      <path
        d={`M ${target.x + w + 18} ${y + 34} l 16 18 l 34 -42`}
        fill="none"
        stroke={COLOR.xlBright}
        strokeWidth={8}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={clamp(pTick * 8)}
        strokeDasharray={TICK_LEN}
        strokeDashoffset={TICK_LEN * (1 - pTick)}
      />
    </svg>
  );
};

const AlignmentPills: React.FC<{
  textCell: string;
  numberCell: string;
  frame: number;
  cues: CueMap;
  fadeOut: number;
  colW: ColW;
  reel: Reel;
  ins: Insert;
}> = ({ textCell, numberCell, frame, cues, fadeOut, colW, reel, ins }) => {
  const t = cellBox(textCell, colW);
  const n = cellBox(numberCell, colW);
  const p = eOut(progress(cues.showAlignment, frame)) * (1 - fadeOut);

  const base: React.CSSProperties = {
    position: 'absolute',
    padding: '10px 20px',
    borderRadius: 999,
    fontFamily: FONT.mono,
    fontSize: 23,
    letterSpacing: '.16em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    color: '#fff',
  };

  // Pills sit in the marks column, in line with their rows. That column holds
  // no data by schema; left of the card there is no room (46px) and inside the
  // data columns they covered values. Row alignment does the pointing:
  // row 2 ↔ TEXT, row 8 ↔ NUMBER.
  const mark = marksColumn(reel);
  const colC = (ref: string) => {
    const at = `${mark}${/\d+$/.exec(ref)![0]}`;
    return cellBox(at, colW).x + shift(ins, at).dx + 16;
  };
  return (
    <>
      <div
        style={{
          ...base,
          background: COLOR.tick,
          left: colC(textCell),
          top: t.y + 12,
          opacity: clamp(p * 1.4),
          transform: `translateX(${(1 - p) * -22}px)`,
        }}
      >
        Text
      </div>
      <div
        style={{
          ...base,
          background: COLOR.xl,
          left: colC(numberCell),
          top: n.y + 12,
          opacity: clamp(p * 1.8 - 0.6),
          transform: `translateX(${(1 - p) * -22}px)`,
        }}
      >
        Number
      </div>
    </>
  );
};

/* ------------------------------------------------------------------ */
/* captions + overlays                                                 */
/* ------------------------------------------------------------------ */

const Captions: React.FC<{
  script: Reel['script'];
  lines: { from: number; to: number }[];
  frame: number;
}> = ({ script, lines, frame }) => {
  const i = lines.findIndex((w) => frame >= w.from && frame < w.to);
  if (i < 0) return null;

  const line = script[i];
  if (line.cue === 'hook' || line.cue === 'payoff') return null;

  const w = lines[i];
  const inP = eOut(clamp((frame - w.from) / 7));
  const outP = 1 - clamp((frame - (w.to - 5)) / 5);

  return (
    <div
      style={{
        // Inside the cross-platform safe box: above TikTok's bottom 484px,
        // left of the right-hand action rails. See SAFE/CAPTION in theme.ts.
        position: 'absolute',
        left: CAPTION.left,
        right: CAPTION.right,
        top: CAPTION.top,
        textAlign: 'center',
        fontFamily: FONT.display,
        fontSize: CAPTION.fontSize,
        fontWeight: 800,
        lineHeight: 1.14,
        letterSpacing: '-.015em',
        color: COLOR.chalk,
        textShadow: '0 4px 22px rgba(0,0,0,.5)',
        opacity: inP * outP,
        transform: `translateY(${(1 - inP) * 16}px)`,
      }}
    >
      {renderCaption(line.caption ?? line.vo)}
    </div>
  );
};

/** `\n` breaks the line, *asterisks* accent a span. */
function renderCaption(text: string): React.ReactNode {
  return text.split('\n').map((row, ri) => (
    <div key={ri}>
      {row.split(/(\*[^*]+\*)/g).map((part, pi) =>
        part.startsWith('*') && part.endsWith('*') && part.length > 2 ? (
          <span key={pi} style={{ color: COLOR.xlBright }}>
            {part.slice(1, -1)}
          </span>
        ) : (
          <React.Fragment key={pi}>{part}</React.Fragment>
        ),
      )}
    </div>
  ));
}

const Overlay: React.FC<{
  show: number;
  lead?: string;
  body?: string;
  headline?: string;
  sub?: string;
}> = ({ show, lead, body, headline, sub }) => {
  if (show <= 0.001) return null;
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        gap: 34,
        // Lifted ~140px so the body text clears the top of the right-hand
        // action rail (y≈1100+) on every platform.
        padding: '0 90px 280px',
        textAlign: 'center',
        fontFamily: FONT.display,
        background: 'rgba(16,56,44,.93)',
        opacity: show,
        transform: `scale(${lead ? 1 + 0.06 * (1 - show) : 0.965 + 0.035 * show})`,
      }}
    >
      {lead ? (
        <div style={{ fontSize: 190, fontWeight: 800, letterSpacing: '-.04em', color: COLOR.tick }}>
          {lead}
        </div>
      ) : (
        <div style={{ width: 120, height: 5, background: COLOR.xlBright }} />
      )}
      <div
        style={{
          fontSize: 118,
          fontWeight: 800,
          lineHeight: 0.94,
          letterSpacing: '-.035em',
          textTransform: 'uppercase',
          color: COLOR.chalk,
        }}
      >
        {(body ?? headline ?? '').split('\n').map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
      {sub ? (
        <div style={{ fontSize: 40, fontWeight: 500, color: '#BFD3CA', lineHeight: 1.3, maxWidth: 820 }}>
          {sub}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/** Dev guide: the union of platform UI overlays. Nothing that matters goes here. */
const SafeArea: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: 'none' }}>
    {[
      { top: 0, left: 0, right: 0, height: SAFE.top },
      { bottom: 0, left: 0, right: 0, height: SAFE.bottom },
      { top: SAFE.railTop, right: 0, width: SAFE.right, height: SAFE.railBottom - SAFE.railTop },
      { top: 0, left: 0, bottom: 0, width: SAFE.left },
    ].map((s, i) => (
      <div
        key={i}
        style={{
          position: 'absolute',
          ...s,
          background: 'rgba(196,63,46,.14)',
          border: '2px dashed rgba(255,255,255,.35)',
        }}
      />
    ))}
  </AbsoluteFill>
);

/* ------------------------------------------------------------------ */

/** "1240.50", "2,103.25", "(412.00)", "-3", "$1,200" read as numbers; "#N/A" and text do not. */
function looksNumeric(s: string | undefined): boolean {
  if (!s) return false;
  return /^\(?-?\$?\d[\d,]*(\.\d+)?\)?%?$/.test(s.trim());
}

/** Character span that differs between two strings, ignoring shared ends. */
function diff(a: string, b: string) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { start, end: endB };
}

export const interpolateUnused = interpolate; // keep import surface stable
