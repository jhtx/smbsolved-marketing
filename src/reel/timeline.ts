import type { Cue, Line } from './schema';
import { speakable } from './speech';
import { VIDEO } from './theme';

export type Window = { from: number; to: number };
export type Timeline = {
  /** frame window per narration line, index-aligned with reel.script */
  lines: Window[];
  /** frame window per cue */
  cues: Partial<Record<Cue, Window>>;
  durationInFrames: number;
};

/**
 * Character-level alignment as returned by ElevenLabs /with-timestamps.
 * voice.ts persists this next to the mp3.
 */
export type Timing = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

/** seconds a line takes when no audio exists yet. ~2.6 words/sec, floor 1.1s */
const estimate = (text: string) =>
  Math.max(1.1, text.trim().split(/\s+/).length / 2.6);

const TAIL_SECONDS = 1.4;

/**
 * Walks the concatenated VO character stream and slices it per line, so a
 * line's animation window is exactly the span in which it is spoken.
 *
 * Falls back to word-count estimates when timing is absent, which is what
 * `npm run dev` uses before any audio is generated.
 */
export function buildTimeline(script: Line[], timing?: Timing | null): Timeline {
  const { fps } = VIDEO;
  const lines: Window[] = [];

  if (!timing) {
    let t = 0;
    for (const line of script) {
      const d = estimate(speakable(line.vo));
      lines.push({ from: Math.round(t * fps), to: Math.round((t + d) * fps) });
      t += d;
    }
    return finish(lines, script, t);
  }

  // Non-whitespace characters are the stable anchor: ElevenLabs may normalise
  // spacing, but it will not drop letters.
  const stream = timing.characters;
  const dense: number[] = [];
  stream.forEach((ch, i) => {
    if (ch.trim().length) dense.push(i);
  });

  let consumed = 0;
  for (const line of script) {
    // Slice by the SPOKEN text — voice.ts sends speakable(vo), and the
    // alignment indexes that stream, not the written vo.
    const len = speakable(line.vo).replace(/\s+/g, '').length;
    const startIdx = dense[Math.min(consumed, dense.length - 1)];
    const endIdx = dense[Math.min(consumed + len - 1, dense.length - 1)];
    const start = timing.character_start_times_seconds[startIdx] ?? 0;
    const end = timing.character_end_times_seconds[endIdx] ?? start + 1;
    lines.push({ from: Math.round(start * fps), to: Math.round(end * fps) });
    consumed += len;
  }

  const last = timing.character_end_times_seconds.at(-1) ?? 0;
  return finish(lines, script, last);
}

function finish(lines: Window[], script: Line[], endSeconds: number): Timeline {
  const cues: Partial<Record<Cue, Window>> = {};
  script.forEach((line, i) => {
    if (line.cue) cues[line.cue] = lines[i];
  });
  return {
    lines,
    cues,
    durationInFrames: Math.round((endSeconds + TAIL_SECONDS) * VIDEO.fps),
  };
}

/** 0..1 progress through a cue at a given frame; 0 before, 1 after. */
export function progress(w: Window | undefined, frame: number): number {
  if (!w) return 0;
  if (frame <= w.from) return 0;
  if (frame >= w.to) return 1;
  return (frame - w.from) / (w.to - w.from);
}

/** true once a cue has started */
export const started = (w: Window | undefined, frame: number) =>
  !!w && frame >= w.from;
