/**
 * One scheduled run, end to end:
 *
 *   backlog → writer (+ reviewer) → verify (structure + real Excel) → voice
 *   → render (MP4 + LinkedIn stills) → deliver (OneDrive archive + Slack)
 *   → heartbeat ping
 *
 * Task Scheduler calls this every weekday morning (scripts/register-task.ps1).
 * A parked topic or a failure is posted to Slack and the heartbeat reports
 * failure, so a silent machine is noticed within a day.
 *
 *   npx tsx pipeline/run.ts --next            # next unchecked backlog item
 *   npx tsx pipeline/run.ts --id 003
 *   npx tsx pipeline/run.ts --reel content/reels/002-sumif-text-dates.json   # skip the writer
 *   add --no-review to skip the reviewer, --no-voice to reuse audio
 */
import './env';
import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { reelSchema } from '../src/reel/schema';
import { writeReel, readBacklog } from './script';
import { buildReel } from './build';
import { renderStills } from './render';
import { deliver, notify } from './deliver';

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

async function heartbeat(ok: boolean, note: string) {
  const url = process.env.HEALTHCHECK_URL;
  if (!url) return;
  try {
    await fetch(ok ? url : `${url}/fail`, { method: 'POST', body: note.slice(0, 2000) });
  } catch {
    /* the heartbeat is best-effort */
  }
}

function log(line: string) {
  mkdirSync('out/logs', { recursive: true });
  appendFileSync('out/logs/run.log', `${new Date().toISOString()} ${line}\n`);
  console.log(line);
}

async function main() {
  const started = Date.now();
  let reelPath = flag('--reel');
  let cost = 0;

  // 1. write, unless a reel was given
  if (!reelPath) {
    let id = flag('--id');
    const items = readBacklog();
    const item = id ? items.find((x) => x.id === id) : items.find((x) => !x.done);
    if (!item) {
      log('backlog empty — nothing to do');
      await notify('Reels: the backlog has no unchecked items. Add symptoms to content/backlog.md.');
      await heartbeat(true, 'backlog empty');
      return;
    }
    id = item.id;
    log(`writing ${id}: ${item.text}`);
    const r = await writeReel({ id, topic: item.text, review: !args.includes('--no-review') });
    cost += r.costUsd;
    if ('parked' in r) {
      log(r.parked);
      await notify(`Reels: ${r.parked}. Topic: "${item.text}"`);
      await heartbeat(true, r.parked);
      return;
    }
    reelPath = r.path;
  }

  // 2. build — verify (real Excel) → voice → render
  log(`building ${reelPath}`);
  const built = await buildReel(reelPath, { skipVoice: args.includes('--no-voice') });

  // 3. stills for LinkedIn
  const stem = basename(reelPath).replace(/\.json$/, '');
  const stills = await renderStills({
    reel: built.reel,
    timing: built.timing,
    audioSrc: built.audioSrc,
    outDir: 'out',
    stem,
  });

  // 4. deliver
  log('delivering');
  const d = await deliver({
    reel: reelSchema.parse(JSON.parse(readFileSync(reelPath, 'utf8'))),
    mp4: built.mp4,
    stills,
    extras: [
      reelPath,
      reelPath.replace(/\.json$/, '.review.json'),
      `public/audio/${stem}.mp3`,
      `content/reels/${stem}.timing.json`,
    ].filter(existsSync),
  });

  const secs = Math.round((Date.now() - started) / 1000);
  const summary = `reel ${stem} delivered in ${secs}s · model cost $${cost.toFixed(2)}${d.slack?.permalink ? ' · ' + d.slack.permalink : ''}`;
  log(summary);
  await heartbeat(true, summary);
}

main().catch(async (e) => {
  const msg = `Reels run FAILED: ${(e as Error).message}`;
  log(msg);
  await notify(msg);
  await heartbeat(false, msg);
  process.exit(1);
});
