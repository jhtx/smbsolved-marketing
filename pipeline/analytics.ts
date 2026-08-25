/**
 * What the reels actually did, pulled nightly and kept.
 *
 * The point is not a dashboard. It is to close the loop: the miner picks next
 * week's topics, and it should know which of this month's topics people
 * finished watching. `performanceReport()` is that summary, and mine.ts feeds
 * it to the model alongside the fresh threads.
 *
 * Sources, and their honest limits:
 *   Instagram  per-media insights. Views, reach, likes, comments, shares,
 *              saves, average watch time. The good data.
 *   YouTube    view/like/comment counts from the Data API, plus watch time and
 *              average view percentage from the Analytics API when that scope
 *              is authorised. YouTube's analytics lag by up to 48 hours.
 *   LinkedIn   nothing. Member posts have no analytics API; only organization
 *              pages do, and these go out from a personal profile.
 *   TikTok     nothing. The drafts are published by hand in the app, so the
 *              pipeline never learns the video id to ask about.
 *
 * Storage is SQLite (`node:sqlite`, built into Node 24, no dependency) at
 * out/analytics.db, copied into the OneDrive archive on every run because out/
 * is disposable and the history is not. One row per reel per platform per day,
 * so a re-run overwrites rather than double-counts.
 *
 *   npx tsx pipeline/analytics.ts            # pull and store
 *   npx tsx pipeline/analytics.ts --report   # what the miner will be told
 */
import './env';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { allRecords, type DeliveryRecord } from './delivery';
import { accessToken } from './post/youtube';
import { requireEnv } from './env';

const DB_PATH = process.env.ANALYTICS_DB ?? 'out/analytics.db';

export type Metric = {
  reel: string;
  platform: 'instagram' | 'youtube';
  captured: string;
  postedAt: string | null;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  /** seconds, total across viewers where the platform reports it */
  watchSeconds: number | null;
  /** 0-100, where the platform reports it */
  avgViewPct: number | null;
};

export function open(path = DB_PATH): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS metrics (
      reel TEXT NOT NULL,
      platform TEXT NOT NULL,
      captured TEXT NOT NULL,
      posted_at TEXT,
      views INTEGER, reach INTEGER, likes INTEGER, comments INTEGER,
      shares INTEGER, saves INTEGER, watch_seconds REAL, avg_view_pct REAL,
      PRIMARY KEY (reel, platform, captured)
    );
  `);
  return db;
}

export function store(db: DatabaseSync, m: Metric): void {
  db.prepare(
    `INSERT INTO metrics (reel, platform, captured, posted_at, views, reach, likes, comments, shares, saves, watch_seconds, avg_view_pct)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(reel, platform, captured) DO UPDATE SET
       posted_at=excluded.posted_at, views=excluded.views, reach=excluded.reach,
       likes=excluded.likes, comments=excluded.comments, shares=excluded.shares,
       saves=excluded.saves, watch_seconds=excluded.watch_seconds, avg_view_pct=excluded.avg_view_pct`,
  ).run(
    m.reel,
    m.platform,
    m.captured,
    m.postedAt,
    m.views,
    m.reach,
    m.likes,
    m.comments,
    m.shares,
    m.saves,
    m.watchSeconds,
    m.avgViewPct,
  );
}

/* ------------------------------------------------------------------ */
/* Instagram                                                           */
/* ------------------------------------------------------------------ */

const IG = 'https://graph.instagram.com/v23.0';

/**
 * Metric names Instagram retires and renames more often than anything else in
 * this pipeline, so ask for the full set and fall back to the core four rather
 * than losing the whole night's pull to one bad name.
 */
const IG_METRICS = ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'ig_reels_avg_watch_time'];
const IG_CORE = ['reach', 'likes', 'comments'];

async function igInsights(mediaId: string): Promise<Record<string, number>> {
  const token = requireEnv('INSTAGRAM_ACCESS_TOKEN');
  const ask = async (metrics: string[]) => {
    const res = await fetch(`${IG}/${mediaId}/insights?metric=${metrics.join(',')}&access_token=${token}`);
    return (await res.json()) as {
      data?: { name: string; values: { value: number }[] }[];
      error?: { message: string };
    };
  };
  let body = await ask(IG_METRICS);
  if (body.error) body = await ask(IG_CORE);
  if (body.error) throw new Error(`Instagram insights: ${body.error.message}`);

  const out: Record<string, number> = {};
  for (const d of body.data ?? []) out[d.name] = d.values?.[0]?.value ?? 0;
  return out;
}

/* ------------------------------------------------------------------ */
/* YouTube                                                             */
/* ------------------------------------------------------------------ */

async function ytStatistics(ids: string[], token: string): Promise<Record<string, Record<string, number>>> {
  if (!ids.length) return {};
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.join(',')}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const body = (await res.json()) as {
    items?: { id: string; statistics: Record<string, string> }[];
    error?: { message: string };
  };
  if (body.error) throw new Error(`YouTube statistics: ${body.error.message}`);
  const out: Record<string, Record<string, number>> = {};
  for (const it of body.items ?? [])
    out[it.id] = Object.fromEntries(Object.entries(it.statistics).map(([k, v]) => [k, Number(v)]));
  return out;
}

/**
 * Watch time, which is the number that actually predicts reach on Shorts.
 * Best effort: the Analytics API needs its own scope and reports nothing for
 * the first day or two after upload.
 */
async function ytWatchTime(
  videoId: string,
  postedAt: string,
  token: string,
): Promise<{ watchSeconds: number | null; avgViewPct: number | null }> {
  const start = postedAt.slice(0, 10);
  const end = new Date().toISOString().slice(0, 10);
  const url =
    `https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE` +
    `&startDate=${start}&endDate=${end}&metrics=estimatedMinutesWatched,averageViewPercentage` +
    `&filters=video==${videoId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json()) as { rows?: number[][]; error?: { message: string } };
  if (body.error || !body.rows?.length) return { watchSeconds: null, avgViewPct: null };
  const [minutes, pct] = body.rows[0];
  return { watchSeconds: minutes * 60, avgViewPct: pct };
}

/* ------------------------------------------------------------------ */
/* the pull                                                            */
/* ------------------------------------------------------------------ */

/** Reels stop being interesting after a month; the tail is noise, not signal. */
const WINDOW_DAYS = 35;

const recent = (rec: DeliveryRecord) =>
  Date.now() - new Date(rec.deliveredAt).getTime() < WINDOW_DAYS * 86_400_000;

export async function pull(opts: { quiet?: boolean } = {}): Promise<Metric[]> {
  const say = opts.quiet ? () => {} : console.log;
  const captured = new Date().toISOString().slice(0, 10);
  const records = allRecords().filter(recent);
  const db = open();
  const out: Metric[] = [];

  const blank = (reel: string, platform: Metric['platform'], postedAt: string | null): Metric => ({
    reel,
    platform,
    captured,
    postedAt,
    views: null,
    reach: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    watchSeconds: null,
    avgViewPct: null,
  });

  // --- Instagram ------------------------------------------------------------
  for (const rec of records) {
    const post = rec.posts.instagram;
    if (post?.state !== 'posted' || !post.id) continue;
    try {
      const i = await igInsights(post.id);
      const m = blank(rec.stem, 'instagram', post.at);
      m.views = i.views ?? null;
      m.reach = i.reach ?? null;
      m.likes = i.likes ?? null;
      m.comments = i.comments ?? null;
      m.shares = i.shares ?? null;
      m.saves = i.saved ?? null;
      m.watchSeconds = i.ig_reels_avg_watch_time != null ? i.ig_reels_avg_watch_time / 1000 : null;
      store(db, m);
      out.push(m);
      say(`  instagram ${rec.stem}: ${m.views ?? m.reach ?? '?'} views`);
    } catch (e) {
      say(`  instagram ${rec.stem}: ${(e as Error).message}`);
    }
  }

  // --- YouTube --------------------------------------------------------------
  const yt = records.filter((r) => r.posts.youtube?.state === 'posted' && r.posts.youtube.id);
  if (yt.length && process.env.YOUTUBE_REFRESH_TOKEN?.trim()) {
    try {
      const token = await accessToken();
      const stats = await ytStatistics(
        yt.map((r) => r.posts.youtube!.id!),
        token,
      );
      for (const rec of yt) {
        const post = rec.posts.youtube!;
        const s = stats[post.id!] ?? {};
        const m = blank(rec.stem, 'youtube', post.at);
        m.views = s.viewCount ?? null;
        m.likes = s.likeCount ?? null;
        m.comments = s.commentCount ?? null;
        const w = await ytWatchTime(post.id!, post.at, token);
        m.watchSeconds = w.watchSeconds;
        m.avgViewPct = w.avgViewPct;
        store(db, m);
        out.push(m);
        say(`  youtube ${rec.stem}: ${m.views ?? '?'} views`);
      }
    } catch (e) {
      say(`  youtube: ${(e as Error).message}`);
    }
  }

  db.close();
  archive();
  return out;
}

/** out/ is disposable; the history is not. Same archive every artifact uses. */
function archive() {
  const root = process.env.ARCHIVE_DIR ?? 'D:\\OneDrive - SMB Solved\\SMB Solved\\Marketing\\Reels';
  if (!existsSync(DB_PATH) || !existsSync(dirname(root))) return;
  try {
    mkdirSync(root, { recursive: true });
    copyFileSync(DB_PATH, join(root, 'analytics.db'));
  } catch {
    /* the archive copy is a convenience, never the reason a pull fails */
  }
}

/* ------------------------------------------------------------------ */
/* what the miner is told                                              */
/* ------------------------------------------------------------------ */

type Ranked = { reel: string; title: string; views: number; watch: number | null; platform: string };

/**
 * The latest numbers per reel, best and worst, with each reel's title so the
 * model can see the topic rather than a filename. Returns '' when there is
 * nothing yet, and the caller leaves the section out entirely — an empty
 * "what worked" block would just invite the model to invent a pattern.
 */
export function performanceReport(limit = 5): string {
  if (!existsSync(DB_PATH)) return '';
  const db = open();
  const rows = db
    .prepare(
      `SELECT m.reel, m.platform, m.views, m.watch_seconds AS watch
         FROM metrics m
         JOIN (SELECT reel, platform, MAX(captured) AS captured FROM metrics GROUP BY reel, platform) latest
           ON m.reel = latest.reel AND m.platform = latest.platform AND m.captured = latest.captured
        WHERE m.views IS NOT NULL
        ORDER BY m.views DESC`,
    )
    .all() as unknown as { reel: string; platform: string; views: number; watch: number | null }[];
  db.close();
  if (rows.length < 4) return '';

  const titleOf = (stem: string) => {
    const p = `content/reels/${stem}.json`;
    if (!existsSync(p)) return stem;
    try {
      return (JSON.parse(readFileSync(p, 'utf8')) as { title?: string }).title ?? stem;
    } catch {
      return stem;
    }
  };

  const line = (r: Ranked) =>
    `- ${r.views.toLocaleString()} views on ${r.platform}${r.watch ? `, ${Math.round(r.watch)}s watched` : ''} — ${r.title}`;
  const ranked: Ranked[] = rows.map((r) => ({ ...r, title: titleOf(r.reel) }));

  return [
    '## What the published reels actually did',
    '',
    'Best so far:',
    ...ranked.slice(0, limit).map(line),
    '',
    'Weakest so far:',
    ...ranked.slice(-limit).reverse().map(line),
    '',
    'Lean towards the shape of the topics near the top. This is a small sample,',
    'so treat it as a nudge, not a rule, and never repeat a topic already covered.',
  ].join('\n');
}

// CLI
if (process.argv[1]?.endsWith('analytics.ts')) {
  if (process.argv.includes('--report')) {
    console.log(performanceReport() || '(not enough data yet)');
  } else {
    pull()
      .then((m) => console.log(`stored ${m.length} rows in ${DB_PATH}`))
      .catch((e) => {
        console.error((e as Error).message);
        process.exit(1);
      });
  }
}
