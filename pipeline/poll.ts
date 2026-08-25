/**
 * The ✅ poller: turns the owner's approval into posts.
 *
 * Every ten minutes it looks at the reels that have been delivered and not yet
 * posted, checks the Slack message for a ✅, and posts the approved ones to
 * the platforms. The reaction is the authorization for an outward-facing,
 * effectively irreversible action, so it is the only trigger: nothing here
 * ever decides on its own that a reel is ready.
 *
 * Safe to run as often as you like. Platforms that already succeeded are never
 * retried, failures get three tries and then stay visible, and reels delivered
 * before this existed have no delivery record and are invisible to it.
 *
 *   npx tsx pipeline/poll.ts               # one pass
 *   npx tsx pipeline/poll.ts --dry-run     # say what would happen, change nothing
 *   npx tsx pipeline/poll.ts --reel 006-vlookup-column-insert
 *   npx tsx pipeline/poll.ts --force       # post without the ✅ (asks out loud first)
 *   npx tsx pipeline/poll.ts --retry-skipped   # after adding credentials that
 *                                              # were missing when a reel was approved
 */
import './env';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { WebClient } from '@slack/web-api';
import { reelSchema } from '../src/reel/schema';
import { allRecords, pending, settled, writeRecord, type DeliveryRecord } from './delivery';
import { postAll, summarise } from './post';

/** Any of these means "post it". ✅ is what the delivery message asks for. */
const APPROVE = ['white_check_mark', 'heavy_check_mark', 'ballot_box_with_check'];

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const value = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

function log(line: string) {
  mkdirSync('out/logs', { recursive: true });
  appendFileSync('out/logs/poll.log', `${new Date().toISOString()} ${line}\n`);
  console.log(line);
}

const slack = () => {
  const token = process.env.SLACK_BOT_TOKEN;
  return token ? new WebClient(token) : null;
};

/** Whether the delivery message carries an approval reaction. */
export async function approved(client: WebClient, channel: string, ts: string): Promise<boolean> {
  const res = await client.reactions.get({ channel, timestamp: ts, full: true });
  const reactions = (res.message as { reactions?: { name: string }[] } | undefined)?.reactions ?? [];
  return reactions.some((r) => APPROVE.includes(r.name));
}

async function handle(
  client: WebClient | null,
  rec: DeliveryRecord,
  dryRun: boolean,
  force: boolean,
  retrySkipped: boolean,
) {
  const todo = pending(rec, retrySkipped);
  if (!todo.length) return;

  if (!force) {
    if (!client) {
      log(`${rec.stem}: no SLACK_BOT_TOKEN, cannot read the approval`);
      return;
    }
    if (!rec.slack) {
      log(`${rec.stem}: delivered without a Slack message, so there is nothing to approve. Post by hand.`);
      return;
    }
    if (!(await approved(client, rec.slack.channel, rec.slack.ts))) return;
  }

  log(`${rec.stem}: approved, posting to ${todo.join(', ')}`);
  const reel = reelSchema.parse(JSON.parse(readFileSync(rec.reelPath, 'utf8')));
  if (!dryRun && !rec.approvedAt) rec.approvedAt = new Date().toISOString();

  await postAll(rec, reel, todo, { dryRun, log });
  if (dryRun) return;

  writeRecord(rec);

  if (client && rec.slack) {
    const done = settled(rec);
    await client.chat.postMessage({
      channel: rec.slack.channel,
      thread_ts: rec.slack.ts,
      text: `Posted reel ${rec.stem}\n${summarise(rec)}`,
      unfurl_links: false,
    });
    if (done)
      try {
        await client.reactions.add({ channel: rec.slack.channel, timestamp: rec.slack.ts, name: 'rocket' });
      } catch {
        /* reactions:write may not be granted; the thread reply is the record */
      }
  }
}

/**
 * LinkedIn's credential is a 60-day access token, not a refresh token, so it
 * lapses on a date rather than on disuse. Warn while there is still time to
 * re-authorise, and at most once a day so a ten-minute poll is not a nag.
 */
async function warnExpiringTokens(client: WebClient | null) {
  const iso = process.env.LINKEDIN_TOKEN_EXPIRES?.trim();
  if (!iso || !client) return;
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days > 7) return;

  const today = new Date().toISOString().slice(0, 10);
  const statePath = 'out/logs/poll-state.json';
  const state = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, 'utf8')) as { warned?: string }) : {};
  if (state.warned === today) return;

  const channel = process.env.SLACK_CHANNEL_ID;
  if (channel)
    await client.chat.postMessage({
      channel,
      text:
        days > 0
          ? `LinkedIn's token expires in ${days} day(s), on ${iso.slice(0, 10)}. Run \`npm run authorize -- linkedin\` before then or LinkedIn posts will start failing.`
          : `LinkedIn's token expired on ${iso.slice(0, 10)}. Run \`npm run authorize -- linkedin\`; LinkedIn posts are failing until you do.`,
    });
  mkdirSync('out/logs', { recursive: true });
  writeFileSync(statePath, JSON.stringify({ ...state, warned: today }, null, 2) + '\n');
}

/** --force posts without the ✅, so it asks out loud first. */
async function confirmForce(count: number): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error('--force needs an interactive terminal: it posts publicly without the ✅.');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`--force will post ${count} reel(s) publicly without a ✅. Type "post" to go ahead: `);
  rl.close();
  return answer.trim() === 'post';
}

async function main() {
  const dryRun = flag('--dry-run');
  const only = value('--reel');
  const client = slack();
  await warnExpiringTokens(client).catch(() => {
    /* a missed reminder must never stop a post */
  });

  const retrySkipped = flag('--retry-skipped');
  const records = allRecords().filter((r) => (only ? r.stem === only : true));
  const waiting = records.filter((r) => pending(r, retrySkipped).length);
  if (!waiting.length) {
    console.log('nothing waiting to post');
    return;
  }

  const force = flag('--force');
  if (force && !dryRun && !(await confirmForce(waiting.length))) {
    console.log('cancelled');
    return;
  }

  for (const rec of waiting) {
    try {
      await handle(client, rec, dryRun, force, retrySkipped);
    } catch (e) {
      log(`${rec.stem}: poll failed — ${(e as Error).message}`);
    }
  }
}

if (process.argv[1]?.endsWith('poll.ts')) {
  main().catch((e) => {
    log(`poll FAILED: ${(e as Error).message}`);
    process.exit(1);
  });
}
