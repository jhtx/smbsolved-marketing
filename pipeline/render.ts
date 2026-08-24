/**
 * Renders a reel to MP4 with @remotion/renderer, in-process.
 *
 * Why not shell out to `npx remotion render`? `execFileSync('npx', ...)` is
 * ENOENT on Windows (npx is npx.cmd) and the shell:true workaround needs
 * argument escaping. The programmatic API is also what Remotion recommends for
 * pipelines, and it removes the props-file round trip.
 *
 *   npx tsx pipeline/render.ts content/reels/001-vlookup-text-numbers.json
 */
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { reelSchema, type Reel } from '../src/reel/schema';
import { buildTimeline, type Timing } from '../src/reel/timeline';

export type RenderInput = {
  reel: Reel;
  timing: Timing | null;
  /** path under public/, e.g. `audio/001-vlookup-text-numbers.mp3` */
  audioSrc: string | null;
  outPath: string;
};

let cachedServeUrl: string | null = null;

/** Bundles once per process; re-rendering several reels reuses the bundle. */
async function serveUrl(): Promise<string> {
  if (cachedServeUrl) return cachedServeUrl;
  cachedServeUrl = await bundle({
    entryPoint: resolve('src/index.ts'),
    publicDir: resolve('public'),
  });
  return cachedServeUrl;
}

export async function renderReel(input: RenderInput): Promise<string> {
  const url = await serveUrl();
  const inputProps = {
    reel: input.reel,
    timing: input.timing,
    audioSrc: input.audioSrc,
    showSafeArea: false,
  };

  // calculateMetadata in Root.tsx derives durationInFrames from the timing.
  const composition = await selectComposition({
    serveUrl: url,
    id: 'ExcelReel',
    inputProps,
  });

  mkdirSync(resolve(input.outPath, '..'), { recursive: true });

  let lastPct = -1;
  await renderMedia({
    composition,
    serveUrl: url,
    codec: 'h264',
    crf: 18,
    outputLocation: input.outPath,
    inputProps,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 10) * 10;
      if (pct !== lastPct) {
        lastPct = pct;
        console.log(`  rendering ${pct}%`);
      }
    },
  });
  return input.outPath;
}

/**
 * Two PNG frames for the LinkedIn static post (evidence says static 9:16
 * images can outperform video there): the hook card and the fixed result.
 * Frames come from the same timeline the video uses, so they always match.
 */
export async function renderStills(input: {
  reel: Reel;
  timing: Timing | null;
  audioSrc: string | null;
  outDir: string;
  stem: string;
}): Promise<string[]> {
  const url = await serveUrl();
  const inputProps = { reel: input.reel, timing: input.timing, audioSrc: input.audioSrc, showSafeArea: false };
  const composition = await selectComposition({ serveUrl: url, id: 'ExcelReel', inputProps });
  const { cues } = buildTimeline(input.reel.script, input.timing);

  const mid = (w?: { from: number; to: number }) => (w ? Math.round((w.from + w.to) / 2) : 0);
  // hook: middle of the hook window. result: just before the payoff starts
  // (tick drawn, result visible, fill-down done).
  const frames: [string, number][] = [
    ['hook', mid(cues.hook)],
    ['result', Math.max(0, (cues.payoff?.from ?? composition.durationInFrames) - 2)],
  ];

  const paths: string[] = [];
  for (const [name, frame] of frames) {
    const output = resolve(input.outDir, `${input.stem}-${name}.png`);
    await renderStill({ composition, serveUrl: url, output, frame, inputProps });
    paths.push(output);
  }
  return paths;
}

// CLI: renders with whatever timing/audio already exists on disk.
if (process.argv[1]?.endsWith('render.ts')) {
  const reelPath = process.argv[2];
  if (!reelPath) throw new Error('usage: render.ts <reel.json>');
  const stem = basename(reelPath).replace(/\.json$/, '');
  const timingPath = `content/reels/${stem}.timing.json`;
  const audio = `audio/${stem}.mp3`;

  renderReel({
    reel: reelSchema.parse(JSON.parse(readFileSync(reelPath, 'utf8'))),
    timing: existsSync(timingPath) ? JSON.parse(readFileSync(timingPath, 'utf8')) : null,
    audioSrc: existsSync(`public/${audio}`) ? audio : null,
    outPath: `out/${stem}.mp4`,
  })
    .then((p) => console.log(`wrote ${p}`))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
