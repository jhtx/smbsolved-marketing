/**
 * Topic miner: forum threads in, backlog candidates out. Weekly.
 *
 * Deterministic half: fetch recent Excel-problem threads from Reddit's public
 * JSON API, keyword-prefilter, cap.
 * Judgment half: one model call (prompts/miner.md) distills symptom-shaped
 * candidates, tagged controller / owner / general.
 *
 * Output is appended under "## Mined <date>" in content/backlog.md. Entries
 * have no **NNN** number, so `run.ts --next` can NEVER pick them — a human
 * promotes a candidate by giving it a number and moving it to Ready.
 *
 *   npx tsx pipeline/mine.ts             # append up to 8 candidates
 *   npx tsx pipeline/mine.ts --dry       # print, don't write
 *   npx tsx pipeline/mine.ts --limit 5
 */
import './env';
import { appendFileSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { askForJson } from './llm';
import { notify } from './deliver';

type Thread = { src: string; title: string; text: string; url: string; score: number; comments: number };

const strip = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Stack Exchange is the default source: open API, no key, 300 req/day.
 * Reddit (r/Accounting etc. — the richer accounting signal) blocks
 * unauthenticated JSON from this network; it activates automatically when
 * REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET are set (a free "script" app at
 * reddit.com/prefs/apps).
 */
async function fetchStackExchange(): Promise<Thread[]> {
  const out: Thread[] = [];
  // No fromdate: Excel question volume on SE is thin in 2026, so a date
  // window starves the miner. Newest 40 per source, whatever their age.
  const sources: { site: string; tag: string }[] = [
    { site: 'superuser', tag: 'microsoft-excel' },
    { site: 'stackoverflow', tag: 'excel-formula' },
  ];
  for (const s of sources) {
    const url =
      `https://api.stackexchange.com/2.3/questions?order=desc&sort=creation&tagged=${s.tag}` +
      `&site=${s.site}&pagesize=40&filter=withbody`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.log(`  ${s.site}/${s.tag}: HTTP ${res.status}, skipped`);
        continue;
      }
      const data = (await res.json()) as {
        items?: { title: string; body?: string; link: string; score: number; answer_count: number }[];
        quota_remaining?: number;
      };
      for (const q of data.items ?? []) {
        out.push({
          src: s.site,
          title: strip(q.title),
          text: strip(q.body ?? '').slice(0, 400),
          url: q.link,
          score: q.score,
          comments: q.answer_count,
        });
      }
      console.log(`  ${s.site}/${s.tag}: ${data.items?.length ?? 0} fetched (quota ${data.quota_remaining})`);
    } catch (e) {
      console.log(`  ${s.site}/${s.tag}: ${(e as Error).message}, skipped`);
    }
  }
  return out;
}

async function fetchReddit(): Promise<Thread[]> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return [];
  const ua = 'smbsolved-reels-miner/1.0 (topic research)';
  const tok = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': ua,
    },
    body: 'grant_type=client_credentials',
  });
  if (!tok.ok) {
    console.log(`  reddit auth: HTTP ${tok.status}, skipped`);
    return [];
  }
  const { access_token } = (await tok.json()) as { access_token: string };
  const out: Thread[] = [];
  const subs: { sub: string; query?: string }[] = [
    { sub: 'Accounting', query: 'excel' },
    { sub: 'Bookkeeping', query: 'excel' },
    { sub: 'QuickBooks', query: 'excel' },
    { sub: 'excel' },
  ];
  for (const s of subs) {
    const url = s.query
      ? `https://oauth.reddit.com/r/${s.sub}/search?q=${encodeURIComponent(s.query)}&restrict_sr=1&sort=new&t=month&limit=50`
      : `https://oauth.reddit.com/r/${s.sub}/top?t=week&limit=50`;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${access_token}`, 'User-Agent': ua } });
      if (!res.ok) {
        console.log(`  r/${s.sub}: HTTP ${res.status}, skipped`);
        continue;
      }
      const data = (await res.json()) as { data?: { children?: { data: Record<string, unknown> }[] } };
      for (const p of data.data?.children ?? []) {
        const d = p.data as { subreddit: string; title: string; selftext?: string; permalink: string; score: number; num_comments: number };
        out.push({
          src: `r/${d.subreddit}`,
          title: d.title,
          text: (d.selftext ?? '').replace(/\s+/g, ' ').slice(0, 400),
          url: `https://www.reddit.com${d.permalink}`,
          score: d.score,
          comments: d.num_comments,
        });
      }
      console.log(`  r/${s.sub}: fetched`);
    } catch (e) {
      console.log(`  r/${s.sub}: ${(e as Error).message}, skipped`);
    }
  }
  return out;
}

/**
 * Reddit without Reddit's API: the public Atom feeds. Empirically (2026-08-24)
 * reddit.com serves `/search.rss` and `/new/.rss` with HTTP 200 to a browser
 * user agent from this network, while the `.json` endpoints 403 and both
 * Anthropic's web-search index and its crawler exclude reddit entirely.
 * Feeds are rate limited: one request per feed with a 5s gap, and a 429 just
 * skips that feed (Stack Exchange carries the run). If REDDIT_CLIENT_ID /
 * SECRET ever exist, the real API takes over instead.
 */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchRedditViaRss(): Promise<Thread[]> {
  const feeds: { sub: string; url: string }[] = [
    { sub: 'Accounting', url: 'https://www.reddit.com/r/Accounting/search.rss?q=excel&restrict_sr=on&sort=new&t=month' },
    { sub: 'Bookkeeping', url: 'https://www.reddit.com/r/Bookkeeping/search.rss?q=excel&restrict_sr=on&sort=new&t=month' },
    { sub: 'QuickBooks', url: 'https://www.reddit.com/r/QuickBooks/search.rss?q=excel&restrict_sr=on&sort=new&t=month' },
    { sub: 'excel', url: 'https://www.reddit.com/r/excel/new/.rss' },
  ];
  const out: Thread[] = [];
  for (const f of feeds) {
    try {
      const res = await fetch(f.url, { headers: { 'User-Agent': BROWSER_UA } });
      if (!res.ok) {
        console.log(`  r/${f.sub} rss: HTTP ${res.status}, skipped`);
      } else {
        const xml = await res.text();
        const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
        for (const e of entries) {
          const title = strip(/<title>([\s\S]*?)<\/title>/.exec(e)?.[1] ?? '');
          const url = /<link[^>]*href="([^"]+)"/.exec(e)?.[1] ?? '';
          const content = strip(/<content[^>]*>([\s\S]*?)<\/content>/.exec(e)?.[1] ?? '');
          if (!title || !url) continue;
          out.push({ src: `r/${f.sub}`, title, text: content.slice(0, 400), url, score: 1, comments: 0 });
        }
        console.log(`  r/${f.sub} rss: ${entries.length} fetched`);
      }
    } catch (e) {
      console.log(`  r/${f.sub} rss: ${(e as Error).message}, skipped`);
    }
    await sleep(10_000); // reddit 429s on rapid hits; a weekly job can afford the wait
  }
  // dedupe by URL (search feeds overlap)
  return out.filter((t, i) => out.findIndex((x) => x.url === t.url) === i);
}

const RELEVANT =
  /(vlookup|xlookup|sumif|countif|sumproduct|index|match|formula|#n\/?a|#value|#ref|#div|pivot|date|export|csv|reconcil|deprec|fixed asset|trial balance|close|general ledger|\bgl\b|lookup|duplicate|trim|import|text to|stored as text|if\b|blank|zero)/i;

async function fetchThreads(): Promise<Thread[]> {
  const reddit = process.env.REDDIT_CLIENT_ID ? await fetchReddit() : await fetchRedditViaRss();
  const all = [...(await fetchStackExchange()), ...reddit];
  return all
    .filter((t) => RELEVANT.test(t.title + ' ' + t.text))
    .sort((a, b) => b.score - a.score)
    .slice(0, 80);
}

const minedSchema = z.object({
  candidates: z.array(
    z.object({
      symptom: z.string(),
      fix: z.string(),
      tag: z.enum(['controller', 'owner', 'general']),
      source: z.string(),
      why: z.string(),
      confidence: z.enum(['high', 'medium', 'low']),
    }),
  ),
});

export async function mine(opts: { limit?: number; dry?: boolean } = {}) {
  const limit = opts.limit ?? 8;
  console.log('fetching threads');
  const threads = await fetchThreads();
  console.log(`  ${threads.length} candidate threads after filter`);
  if (threads.length < 5) throw new Error(`only ${threads.length} threads fetched — sources unreachable, not mining`);

  const backlog = readFileSync('content/backlog.md', 'utf8');
  const system = readFileSync('prompts/miner.md', 'utf8');
  const user = [
    `Distill up to ${limit} backlog candidates from these threads.`,
    '',
    '## The current backlog (do not duplicate anything here)',
    '```',
    backlog,
    '```',
    '',
    '## Threads',
    ...threads.map(
      (t, i) => `${i + 1}. [${t.src}, ${t.score}pts/${t.comments} answers] ${t.title}\n   ${t.text}\n   ${t.url}`,
    ),
  ].join('\n');

  const { output, costUsd } = await askForJson({
    label: 'miner',
    system,
    messages: [{ role: 'user', content: user }],
    schema: minedSchema,
    effort: 'high',
  });

  const date = new Date().toISOString().slice(0, 10);
  const lines = output.candidates
    .slice(0, limit)
    .map(
      (c) =>
        `- [ ] [${c.tag}] ${c.symptom} → ${c.fix}\n` +
        `      <${c.source}> · ${c.why} (${c.confidence})`,
    );

  const block = `\n## Mined ${date} (curate before promoting; give an item a **NNN** number to make it runnable)\n\n${lines.join('\n')}\n`;
  if (opts.dry) {
    console.log(block);
  } else {
    appendFileSync('content/backlog.md', block);
    console.log(`appended ${lines.length} candidates to content/backlog.md`);
    await notify(
      `Miner: ${lines.length} new backlog candidates (${output.candidates.map((c) => c.tag).join(', ')}). Curate in content/backlog.md.`,
    );
  }
  console.log(`miner cost $${costUsd.toFixed(2)}`);
  return output.candidates;
}

if (process.argv[1]?.endsWith('mine.ts')) {
  const args = process.argv.slice(2);
  const li = args.indexOf('--limit');
  mine({ limit: li >= 0 ? Number(args[li + 1]) : undefined, dry: args.includes('--dry') }).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
