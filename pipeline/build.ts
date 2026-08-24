/**
 * verify (structure + real Excel) -> voice -> render. Plain sequence.
 * Every step is deterministic, so failures are reproducible.
 *
 *   npx tsx pipeline/build.ts content/reels/001-vlookup-text-numbers.json
 *   npx tsx pipeline/build.ts <reel> --no-voice  reuse existing audio
 */
import './env';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { verify, stamp } from './verify';
import { generateVoice } from './voice';
import { renderReel } from './render';
import { reelSchema, type Reel } from '../src/reel/schema';
import type { Timing } from '../src/reel/timeline';

export type Built = { mp4: string; reel: Reel; timing: Timing; audioSrc: string };

export async function buildReel(reelPath: string, opts: { skipVoice?: boolean } = {}): Promise<Built> {
  const stem = basename(reelPath).replace(/\.json$/, '');
  const raw = JSON.parse(readFileSync(reelPath, 'utf8'));

  // 1. gate — structure + recalculation in real Excel. No bypass.
  console.log('verifying');
  const { findings, verification } = verify(raw);
  for (const x of findings) console.log(`  ${x.level === 'error' ? 'ERR ' : 'warn'} ${x.message}`);
  if (findings.some((x) => x.level === 'error') || !verification) {
    throw new Error('not renderable — see findings above and CLAUDE.md');
  }
  stamp(reelPath, verification);
  console.log(`  verified in Excel ${verification.excel}`);

  // 2. voice
  const timingPath = `content/reels/${stem}.timing.json`;
  const audioSrc = `audio/${stem}.mp3`;
  let timing: Timing;
  if (opts.skipVoice && existsSync(timingPath) && existsSync(`public/${audioSrc}`)) {
    console.log('reusing existing voiceover');
    timing = JSON.parse(readFileSync(timingPath, 'utf8'));
  } else {
    console.log('generating voiceover');
    ({ timing } = await generateVoice(reelPath));
  }

  // 3. render — in-process via @remotion/renderer (see render.ts for why)
  console.log('rendering');
  const reel = reelSchema.parse(JSON.parse(readFileSync(reelPath, 'utf8')));
  const mp4 = await renderReel({ reel, timing, audioSrc, outPath: `out/${stem}.mp4` });
  return { mp4, reel, timing, audioSrc };
}

if (process.argv[1]?.endsWith('build.ts')) {
  const reelPath = process.argv[2];
  if (!reelPath) throw new Error('usage: build.ts <reel.json> [--no-voice]');
  buildReel(reelPath, { skipVoice: process.argv.includes('--no-voice') })
    .then(({ mp4 }) => console.log(`\n${mp4} — review it, then post from your phone.`))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
