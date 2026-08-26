/**
 * Delivery: the finished MP4 + post copy go where the human will see them.
 *
 *   1. Archive — a folder per reel inside the OneDrive-synced Marketing
 *      folder (zero API: the sync client does the upload). Holds the MP4,
 *      LinkedIn stills, reel JSON, review, voice + alignment, and post.txt.
 *   2. Slack — one message in #social-media with the post copy, the MP4 and
 *      stills attached in-thread. A ✅ reaction on that message means "post
 *      this for me": poll.ts watches for it and does the posting.
 *   3. A delivery record beside the reel (`NNN-slug.delivery.json`) holding
 *      the Slack coordinates and what has gone out where. Without it the
 *      poller cannot see the reel at all, which is what keeps reels delivered
 *      before auto-posting existed from being posted twice.
 *
 * Nothing here posts to a platform either. Approval comes first, always.
 *
 *   npx tsx pipeline/deliver.ts content/reels/002-sumif-text-dates.json
 */
import './env';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { WebClient } from '@slack/web-api';
import { reelSchema, type Reel } from '../src/reel/schema';
import { recordPath, writeRecord, type DeliveryRecord } from './delivery';
import { automation } from './post';

export type Delivered = {
  archiveDir?: string;
  slack?: { channel: string; ts: string; permalink?: string };
  record?: DeliveryRecord;
};

const LABEL = {
  youtube: 'YouTube Shorts',
  instagram: 'Instagram Reels',
  linkedin: 'LinkedIn (personal)',
  tiktok: 'TikTok',
} as const;

const DEFAULT_ARCHIVE = 'D:\\OneDrive - SMB Solved\\SMB Solved\\Marketing\\Reels';

/** The text that travels with the MP4: post copy + a per-platform checklist. */
export function postCopy(reel: Reel): string {
  const p = reel.post;
  const title = p?.title ?? reel.title;
  const tags = (p?.hashtags ?? []).map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
  const v = reel.verification;
  return [
    `*Reel ${reel.id} — ${title}*`,
    '',
    p?.description ?? reel.title,
    tags,
    '',
    `_Verified in Excel ${v?.excel ?? '?'} on ${v?.on ?? '?'}_`,
    '',
    '*React ✅ and I will post it:*',
    ...automation().map((a) =>
      a.ready
        ? `• ${LABEL[a.platform]} — ${a.note}`
        : `• ${LABEL[a.platform]} — *by hand* (${a.why})`,
    ),
    '',
    'Posting by hand instead? Instagram: Advanced settings → turn OFF auto-captions, ours are burned in.',
    `YouTube title: "${title}". LinkedIn: first line of the post is the search phrase, and the still goes up as a separate post 24h later.`,
  ].join('\n');
}

export async function deliver(opts: {
  reel: Reel;
  mp4: string;
  stills?: string[];
  /** extra files to archive: reel json, review json, mp3, timing */
  extras?: string[];
}): Promise<Delivered> {
  const out: Delivered = {};
  const { reel } = opts;
  const stem = `${reel.id}-${reel.slug}`;
  const copy = postCopy(reel);

  // --- 1. archive to the synced OneDrive folder ------------------------------
  const root = process.env.ARCHIVE_DIR ?? DEFAULT_ARCHIVE;
  if (existsSync(dirname(root)) || existsSync(root)) {
    const dir = join(root, stem);
    mkdirSync(dir, { recursive: true });
    const files = [opts.mp4, ...(opts.stills ?? []), ...(opts.extras ?? [])].filter((f) => f && existsSync(f));
    for (const f of files) copyFileSync(f, join(dir, basename(f)));
    writeFileSync(join(dir, 'post.txt'), copy.replace(/\*/g, '') + '\n');
    out.archiveDir = dir;
    console.log(`  archived ${files.length + 1} files → ${dir}`);
  } else {
    console.log(`  archive skipped: ${root} not found (set ARCHIVE_DIR or sync OneDrive on this machine)`);
  }

  // --- 2. Slack ----------------------------------------------------------------
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  if (!token || !channel) {
    console.log('  Slack skipped: SLACK_BOT_TOKEN / SLACK_CHANNEL_ID not set');
    return out;
  }
  const slack = new WebClient(token);
  const msg = await slack.chat.postMessage({ channel, text: copy, unfurl_links: false });
  if (!msg.ts) throw new Error('Slack accepted the message but returned no timestamp, so nothing could approve it');
  const ts = msg.ts!;
  const uploads = [opts.mp4, ...(opts.stills ?? [])].filter((f) => existsSync(f));
  for (const f of uploads) {
    await slack.filesUploadV2({
      channel_id: channel,
      thread_ts: ts,
      file: createReadStream(f),
      filename: basename(f),
      title: basename(f),
    });
  }
  let permalink: string | undefined;
  try {
    permalink = (await slack.chat.getPermalink({ channel, message_ts: ts })).permalink;
  } catch {
    /* optional */
  }
  out.slack = { channel, ts, permalink };
  console.log(`  Slack: posted to ${channel} (${uploads.length} files)${permalink ? ' ' + permalink : ''}`);

  // --- 3. the delivery record the poller watches -------------------------------
  // Written last, and only once Slack has a message to react to: a record
  // without somewhere to approve it would sit pending forever.
  out.record = {
    stem,
    reelPath: `content/reels/${stem}.json`,
    mp4: opts.mp4,
    stills: (opts.stills ?? []).filter(existsSync),
    deliveredAt: new Date().toISOString(),
    slack: out.slack,
    posts: {},
  };
  writeRecord(out.record);
  console.log(`  waiting on ✅ — ${recordPath(stem)}`);
  return out;
}

/** Posts a short notice (parked topic, failed run) to the same channel. */
export async function notify(text: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  if (!token || !channel) {
    console.log(`  (no Slack) ${text}`);
    return;
  }
  await new WebClient(token).chat.postMessage({ channel, text });
}

// CLI: delivers whatever exists in out/ for the reel
if (process.argv[1]?.endsWith('deliver.ts')) {
  const reelPath = process.argv[2];
  if (!reelPath) throw new Error('usage: deliver.ts <reel.json>');
  const reel = reelSchema.parse(JSON.parse(readFileSync(reelPath, 'utf8')));
  const stem = basename(reelPath).replace(/\.json$/, '');
  const mp4 = `out/${stem}.mp4`;
  if (!existsSync(mp4)) throw new Error(`${mp4} not found — build first`);
  deliver({
    reel,
    mp4,
    stills: [`out/${stem}-hook.png`, `out/${stem}-result.png`].filter(existsSync),
    extras: [reelPath, reelPath.replace(/\.json$/, '.review.json'), `public/audio/${stem}.mp3`, `content/reels/${stem}.timing.json`],
  })
    .then((d) => console.log(JSON.stringify(d)))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
