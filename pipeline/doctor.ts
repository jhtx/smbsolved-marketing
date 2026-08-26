/**
 * Can the ✅ actually do what the Slack message promises?
 *
 * Every credential the posting path needs, probed for real. Presence in
 * .env.local proves nothing: a GitHub token can read a repo and still be
 * unable to create the release Instagram needs, and a YouTube token can be
 * perfectly valid and bound to the wrong channel. Both have happened here.
 *
 * Read-only wherever a read-only probe exists. The one exception is GitHub,
 * where the only way to know a token can write is to write: it creates a
 * throwaway release, fetches the asset back with no credentials (which is
 * exactly what Instagram does), and deletes it. `--quick` skips that.
 *
 *   npm run doctor
 *   npm run doctor -- --quick
 */
import './env';
import { rmSync, writeFileSync } from 'node:fs';
import { WebClient } from '@slack/web-api';
import { autopostAllows, type Platform } from './delivery';
import { hostPublicly } from './post/host';

type State = 'pass' | 'fail' | 'todo';
type Check = { name: string; state: State; detail: string; next?: string; platform?: Platform };

const results: Check[] = [];
const add = (name: string, state: State, detail: string, next?: string) =>
  results.push({ name, state, detail, next, platform: PLATFORM_OF[name] });

/** Which checks correspond to a posting platform, for the AUTOPOST note. */
const PLATFORM_OF: Record<string, Platform | undefined> = {
  Instagram: 'instagram',
  Facebook: 'facebook',
  YouTube: 'youtube',
  LinkedIn: 'linkedin',
  TikTok: 'tiktok',
};

const missing = (...keys: string[]) => keys.filter((k) => !process.env[k]?.trim());

/* ------------------------------------------------------------------ */

async function slack() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return add('Slack', 'todo', 'SLACK_BOT_TOKEN not set', 'without it nothing can read your ✅');
  try {
    const who = await new WebClient(token).auth.test();
    add('Slack', 'pass', `${who.user} in ${who.team}`);
  } catch (e) {
    add('Slack', 'fail', (e as Error).message, 'the poller cannot see approvals until this works');
  }
}

async function instagram() {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) return add('Instagram', 'todo', 'INSTAGRAM_ACCESS_TOKEN not set');
  const G = 'https://graph.instagram.com/v23.0';
  try {
    const me = (await (await fetch(`${G}/me?fields=user_id,username,account_type&access_token=${token}`)).json()) as {
      user_id?: string;
      username?: string;
      account_type?: string;
      error?: { message: string };
    };
    if (me.error) return add('Instagram', 'fail', me.error.message, 'regenerate the long-lived token');

    const uid = process.env.INSTAGRAM_USER_ID?.trim() || me.user_id!;
    // Read-only, but it needs instagram_business_content_publish, so it proves
    // the scope without posting anything.
    const limit = (await (
      await fetch(`${G}/${uid}/content_publishing_limit?fields=config,quota_usage&access_token=${token}`)
    ).json()) as { data?: { quota_usage?: number; config?: { quota_total?: number } }[]; error?: { message: string } };

    if (limit.error)
      return add(
        'Instagram',
        'fail',
        `@${me.username} but publishing is refused: ${limit.error.message}`,
        'regenerate the token with instagram_business_content_publish ticked',
      );
    const d = limit.data?.[0];
    add('Instagram', 'pass', `@${me.username} (${me.account_type}), ${d?.quota_usage ?? 0}/${d?.config?.quota_total ?? '?'} posts used in 24h`);
  } catch (e) {
    add('Instagram', 'fail', (e as Error).message);
  }
}

async function github(quick: boolean) {
  const repo = process.env.REELS_ASSET_REPO ?? 'jhtx/smbsolved-marketing';
  const label = 'GitHub (Instagram video hosting)';
  if (!process.env.GITHUB_TOKEN?.trim())
    return add(label, 'todo', 'GITHUB_TOKEN not set', 'Instagram cannot post without a public URL for the MP4');

  const h = {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'smbsolved-reels',
  };
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}`, { headers: h });
    const body = (await r.json()) as { full_name?: string; visibility?: string; message?: string };
    if (!r.ok) return add(label, 'fail', `${r.status} ${body.message ?? ''}`, `check the token can see ${repo}`);
    if (quick) return add(label, 'pass', `can read ${body.full_name} (write not tested, --quick)`);

    const tmp = 'tmp-doctor-selftest.txt';
    writeFileSync(tmp, 'smbsolved pipeline self-test\n');
    let url: string;
    try {
      url = await hostPublicly(tmp, 'pipeline-selftest');
    } finally {
      rmSync(tmp, { force: true });
    }

    // The property that actually matters: Instagram fetches this anonymously.
    const pub = await fetch(url, { redirect: 'follow' });
    await cleanupRelease(repo, h);
    if (!pub.ok) return add(label, 'fail', `asset uploaded but is not publicly fetchable (${pub.status})`);
    add(label, 'pass', `release asset written, fetched back anonymously, deleted`);
  } catch (e) {
    const msg = (e as Error).message;
    await cleanupRelease(repo, h).catch(() => {});
    add(
      label,
      'fail',
      msg,
      msg.includes('403')
        ? 'the fine-grained token needs Contents: Read and write (releases live under Contents)'
        : undefined,
    );
  }
}

async function cleanupRelease(repo: string, h: Record<string, string>) {
  const rel = (await (await fetch(`https://api.github.com/repos/${repo}/releases/tags/pipeline-selftest`, { headers: h })).json()) as {
    id?: number;
  };
  if (!rel.id) return;
  await fetch(`https://api.github.com/repos/${repo}/releases/${rel.id}`, { method: 'DELETE', headers: h });
  await fetch(`https://api.github.com/repos/${repo}/git/refs/tags/pipeline-selftest`, { method: 'DELETE', headers: h });
}

async function youtube() {
  const gaps = missing('YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN');
  if (gaps.length)
    return add(
      'YouTube',
      'todo',
      `missing ${gaps.join(', ')}`,
      gaps.includes('YOUTUBE_REFRESH_TOKEN') && gaps.length === 1
        ? 'run: npm run authorize -- youtube'
        : 'an API key cannot upload; create an OAuth client ID, then npm run authorize -- youtube',
    );
  try {
    const { accessToken, boundChannel } = await import('./post/youtube');
    // WHICH channel the token controls. Uploads land wherever this says, so a
    // token bound to the wrong channel is worse than no token at all.
    const ch = await boundChannel(await accessToken());
    const want = process.env.YOUTUBE_CHANNEL_ID?.trim();
    const where = `"${ch.title}"${ch.handle ? ` (${ch.handle})` : ''}`;
    if (want && want !== ch.id)
      return add('YouTube', 'fail', `token points at ${where}, but YOUTUBE_CHANNEL_ID expects ${want}`, 're-authorize and pick the right channel');
    add(
      'YouTube',
      'pass',
      `uploads will go to ${where}`,
      want ? undefined : `pin it: add YOUTUBE_CHANNEL_ID=${ch.id} to .env.local so a re-auth can never silently change channel`,
    );
  } catch (e) {
    add('YouTube', 'fail', (e as Error).message, 'run: npm run authorize -- youtube');
  }
}

async function facebook() {
  const gaps = missing('FACEBOOK_PAGE_ID', 'FACEBOOK_PAGE_TOKEN');
  if (gaps.length) return add('Facebook', 'todo', `missing ${gaps.join(', ')}`, 'run: npm run authorize -- facebook');
  try {
    const { assertPage } = await import('./post/facebook');
    const page = await assertPage();
    add('Facebook', 'pass', `posts as the Page "${page.name}" (${page.id})`);
  } catch (e) {
    // The usual failure is a user token wearing a Page token's name, and
    // assertPage already says so in one sentence.
    add('Facebook', 'fail', (e as Error).message, 'run: npm run authorize -- facebook');
  }
}

async function linkedin() {
  const gaps = missing('LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_ACCESS_TOKEN');
  if (gaps.length) return add('LinkedIn', 'todo', `missing ${gaps.join(', ')}`, 'run: npm run authorize -- linkedin');
  try {
    const r = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}` },
    });
    const b = (await r.json()) as { name?: string; sub?: string };
    if (!r.ok) {
      // A token authorised with w_member_social alone can post but cannot read
      // userinfo, which is fine as long as the URN is pinned by hand. That is
      // a working setup, not a broken one.
      const pinned = process.env.LINKEDIN_MEMBER_URN?.trim();
      return pinned
        ? add('LinkedIn', 'pass', `posts as ${pinned} (pinned; the token cannot read userinfo, which only matters for looking that up)`)
        : add(
            'LinkedIn',
            'fail',
            `${r.status} ${JSON.stringify(b).slice(0, 120)}`,
            'add the Sign In with LinkedIn using OpenID Connect product, or set LINKEDIN_MEMBER_URN by hand',
          );
    }
    const expires = process.env.LINKEDIN_TOKEN_EXPIRES;
    const days = expires ? Math.round((new Date(expires).getTime() - Date.now()) / 86_400_000) : null;
    add('LinkedIn', 'pass', `posts as ${b.name} (urn:li:person:${b.sub})${days !== null ? `, token good for ${days} more days` : ''}`);
  } catch (e) {
    add('LinkedIn', 'fail', (e as Error).message);
  }
}

async function tiktok() {
  const gaps = missing('TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REFRESH_TOKEN');
  if (gaps.length)
    return add('TikTok', 'todo', `missing ${gaps.join(', ')}`, 'optional: it can only push drafts until the app is audited');
  try {
    const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY!,
        client_secret: process.env.TIKTOK_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: process.env.TIKTOK_REFRESH_TOKEN!,
      }),
    });
    const b = (await res.json()) as { access_token?: string; error_description?: string; error?: string };
    if (!b.access_token) return add('TikTok', 'fail', b.error_description ?? b.error ?? 'no token', 'npm run authorize -- tiktok --paste');
    add('TikTok', 'pass', 'token refreshes; pushes drafts to the app inbox');
  } catch (e) {
    add('TikTok', 'fail', (e as Error).message);
  }
}

/* ------------------------------------------------------------------ */

const ICON: Record<State, string> = { pass: 'PASS', fail: 'FAIL', todo: 'TODO' };

async function main() {
  const quick = process.argv.includes('--quick');
  await slack();
  await instagram();
  await github(quick);
  await youtube();
  await facebook();
  await linkedin();
  await tiktok();

  const width = Math.max(...results.map((r) => r.name.length));
  console.log('');
  for (const r of results) {
    // Working credentials and permission to use them are separate questions,
    // and a row that says only PASS would hide the second one.
    const held = r.platform && !autopostAllows(r.platform) ? '  [held: not in AUTOPOST, you post it by hand]' : '';
    console.log(`  ${ICON[r.state]}  ${r.name.padEnd(width)}  ${r.detail}${held}`);
    if (r.next) console.log(`        ${' '.repeat(width)}  → ${r.next}`);
  }

  const broken = results.filter((r) => r.state === 'fail');
  const todo = results.filter((r) => r.state === 'todo');
  console.log(
    `\n  ${results.filter((r) => r.state === 'pass').length} working, ${broken.length} broken, ${todo.length} not set up yet.`,
  );
  if (todo.length) console.log('  Anything not set up posts by hand, and the Slack message says so.');
  if (process.env.AUTOPOST?.trim()) console.log(`  AUTOPOST=${process.env.AUTOPOST.trim()} — only those post on a ✅.`);
  if (broken.length) console.log('  Fix the broken ones, then: npm run poll -- --retry');
  process.exit(broken.length ? 1 : 0);
}

if (process.argv[1]?.endsWith('doctor.ts')) {
  main().catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
}
