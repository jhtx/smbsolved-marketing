/**
 * One-time OAuth consent for the posting platforms. Run it once per platform,
 * click through in a browser, and the long-lived credential lands in
 * `.env.local`. Nothing in the daily pipeline ever needs a browser again.
 *
 *   npm run authorize -- youtube
 *   npm run authorize -- linkedin
 *   npm run authorize -- facebook
 *   npm run authorize -- facebook --from-user-token   (trade one you already hold)
 *   npm run authorize -- tiktok --paste
 *
 * `--paste` is for platforms that will not redirect to localhost: it prints
 * the URL, you approve in a browser, then paste the address bar back here.
 * TikTok is the one that needs it — its redirect URIs must be https and
 * verified, so point it at a page on smbsolved.com and copy the result.
 *
 * What each one asks for, and why:
 *   youtube   upload + analytics read, in one consent so the nightly numbers
 *             pull does not need a second trip through this
 *   linkedin  w_member_social, to post to the founder's own profile
 *   facebook  the three Pages permissions, then a trade: the token OAuth hands
 *             back is a user token, and only a Page token can post to a Page
 *   tiktok    video.upload, which is drafts only until the app is audited
 */
import '../env';
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { setEnvLocal } from '../env';

type Provider = {
  authUrl: string;
  tokenUrl: string;
  scope: string;
  /** TikTok calls the client id `client_key` */
  idParam: 'client_id' | 'client_key';
  idEnv: string;
  secretEnv: string;
  /** where the long-lived credential is stored */
  saveEnv?: string;
  /** which field of the token response is the long-lived credential */
  saveField?: 'refresh_token' | 'access_token';
  /**
   * Replaces the default "save one field" step for providers where the token
   * you get is not the token you need. Facebook hands back a user token that
   * has to be traded for a Page token.
   */
  finish?: (data: Record<string, string | number>, ctx: { clientId: string; secret: string }) => Promise<void>;
  extraAuth?: Record<string, string>;
  pkce?: boolean;
  defaultRedirect: string;
  hint?: string;
};

const PROVIDERS: Record<string, Provider> = {
  youtube: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/yt-analytics.readonly',
    ].join(' '),
    idParam: 'client_id',
    idEnv: 'YOUTUBE_CLIENT_ID',
    secretEnv: 'YOUTUBE_CLIENT_SECRET',
    saveEnv: 'YOUTUBE_REFRESH_TOKEN',
    saveField: 'refresh_token',
    // access_type=offline + prompt=consent is the only way Google reliably
    // hands back a refresh token on a repeat authorisation.
    extraAuth: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    defaultRedirect: 'http://localhost:8723/callback',
    hint: 'console.cloud.google.com → APIs & Services → Credentials → OAuth client ID → Web application, with this exact redirect URI. Enable the YouTube Data API v3 and the YouTube Analytics API on the project.',
  },
  linkedin: {
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    scope: 'openid profile w_member_social',
    idParam: 'client_id',
    idEnv: 'LINKEDIN_CLIENT_ID',
    secretEnv: 'LINKEDIN_CLIENT_SECRET',
    saveEnv: 'LINKEDIN_ACCESS_TOKEN',
    // LinkedIn only issues refresh tokens to approved apps; the 60-day access
    // token is the credential, and poll.ts warns before it expires.
    saveField: 'access_token',
    defaultRedirect: 'http://localhost:8723/callback',
    hint: 'developer.linkedin.com → your app. Auth tab: add this exact redirect URL. Products tab: "Share on LinkedIn" grants w_member_social, "Sign In with LinkedIn using OpenID Connect" grants openid and profile. invalid_scope_error means one of those products is missing; isolate it with --scope "openid profile" or --scope "w_member_social".',
  },
  facebook: {
    authUrl: 'https://www.facebook.com/v25.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v25.0/oauth/access_token',
    scope: 'pages_show_list pages_read_engagement pages_manage_posts',
    idParam: 'client_id',
    idEnv: 'FACEBOOK_APP_ID',
    secretEnv: 'FACEBOOK_APP_SECRET',
    defaultRedirect: 'http://localhost:8723/callback',
    finish: facebookFinish,
    hint: 'developers.facebook.com → your app → Facebook Login → Settings → Valid OAuth Redirect URIs must contain this exact URL. On the consent screen you MUST tick the SMB Solved Page: a token with the permissions but no Page granted returns an empty page list and cannot post.',
  },
  tiktok: {
    authUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    scope: 'video.upload',
    idParam: 'client_key',
    idEnv: 'TIKTOK_CLIENT_KEY',
    secretEnv: 'TIKTOK_CLIENT_SECRET',
    saveEnv: 'TIKTOK_REFRESH_TOKEN',
    saveField: 'refresh_token',
    pkce: true,
    defaultRedirect: 'https://smbsolved.com/oauth/tiktok',
    hint: 'developers.tiktok.com → your app → Login Kit. TikTok will not accept a localhost redirect, so register an https URL you control and run this with --paste.',
  },
};

/**
 * Facebook's OAuth returns a short-lived USER token, which cannot post to a
 * Page. The Page token is two steps further on: trade it for a long-lived user
 * token, then read the Page tokens off /me/accounts. Page tokens derived this
 * way do not expire, so this runs once and never again.
 */
async function facebookFinish(
  data: Record<string, string | number>,
  ctx: { clientId: string; secret: string },
): Promise<void> {
  const V = process.env.FACEBOOK_API_VERSION?.trim() || 'v25.0';
  const G = `https://graph.facebook.com/${V}`;
  const short = String(data.access_token ?? '');

  const ll = (await (
    await fetch(
      `${G}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(ctx.clientId)}` +
        `&client_secret=${encodeURIComponent(ctx.secret)}&fb_exchange_token=${encodeURIComponent(short)}`,
    )
  ).json()) as { access_token?: string; error?: { message: string } };
  const userToken = ll.access_token ?? short;
  if (ll.error) console.log(`(could not extend the user token: ${ll.error.message}; continuing with the short one)`);

  await pageFromUserToken(userToken);
}

type FbPage = { id: string; name: string; category?: string; access_token?: string };

/**
 * Reads the Page tokens off a user token and writes the chosen one. Separate
 * from the OAuth flow because it is also the whole fix when someone already
 * has a user token and only needs to trade it, with no app secret involved.
 */
export async function pageFromUserToken(rawUserToken: string): Promise<void> {
  const V = process.env.FACEBOOK_API_VERSION?.trim() || 'v25.0';
  const G = `https://graph.facebook.com/${V}`;

  // A Page token inherits the life of the user token it came from, so extend
  // the user token FIRST or the Page token quietly expires within the hour.
  // This is the step that is easy to skip in the Graph API Explorer.
  let userToken = rawUserToken;
  const appId = process.env.FACEBOOK_APP_ID?.trim();
  const appSecret = process.env.FACEBOOK_APP_SECRET?.trim();
  if (appId && appSecret) {
    const ll = (await (
      await fetch(
        `${G}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(appId)}` +
          `&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(rawUserToken)}`,
      )
    ).json()) as { access_token?: string; error?: { message: string } };
    if (ll.access_token) {
      userToken = ll.access_token;
      console.log('extended the user token to long-lived, so the Page token will not expire');
    } else {
      console.log(`could not extend the user token: ${ll.error?.message ?? 'unknown'}`);
    }
  } else {
    console.log(
      'FACEBOOK_APP_ID / FACEBOOK_APP_SECRET are not set, so the user token cannot be extended.\n' +
        'The Page token will inherit whatever life the user token has, which for a freshly\n' +
        'generated Explorer token is about an hour. Add them and re-run for a permanent one.',
    );
  }

  const accounts = (await (
    await fetch(`${G}/me/accounts?fields=id,name,category,access_token&access_token=${encodeURIComponent(userToken)}`)
  ).json()) as { data?: FbPage[]; error?: { message: string } };
  if (accounts.error) {
    // Pages have no /me/accounts edge, so this exact error means someone fed a
    // Page token to the step that turns user tokens into Page tokens.
    if (/nonexisting field \(accounts\)/.test(accounts.error.message))
      throw new Error(
        'that is already a Page token, not a user token. This step turns a USER token into a Page token. ' +
          'If you are trying to replace an expiring Page token, paste the user token you generated it from.',
      );
    throw new Error(`Facebook: ${accounts.error.message}`);
  }

  const pages = (accounts.data ?? []).filter((p) => p.access_token);
  if (!pages.length)
    throw new Error(
      'that token carries the permissions but no Page. Facebook asks separately which Pages an app may use, and none ' +
        'were granted. Go through the consent again and tick SMB Solved. If the Page belongs to a Business portfolio, ' +
        'the app also has to be added to that portfolio with access to the Page.',
    );

  let chosen = pages[0];
  if (pages.length > 1) {
    pages.forEach((p, i) => console.log(`  ${i + 1}. ${p.name}${p.category ? ` (${p.category})` : ''} — ${p.id}`));
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const pick = Number((await rl.question(`Which Page should reels post to? [1-${pages.length}] `)).trim());
    rl.close();
    if (!Number.isInteger(pick) || pick < 1 || pick > pages.length) throw new Error('no Page chosen');
    chosen = pages[pick - 1];
  }

  setEnvLocal('FACEBOOK_PAGE_ID', chosen.id);
  setEnvLocal('FACEBOOK_PAGE_TOKEN', chosen.access_token!);
  console.log(`
Facebook Page set to "${chosen.name}" (${chosen.id}).`);

  // Say plainly whether the thing just written is permanent, rather than
  // asserting it and being wrong.
  const at = encodeURIComponent(chosen.access_token!);
  const dbg = (await (await fetch(`${G}/debug_token?input_token=${at}&access_token=${at}`)).json()) as {
    data?: { expires_at?: number };
  };
  const expires = dbg.data?.expires_at ?? 0;
  console.log(
    expires === 0
      ? 'This Page token does not expire.'
      : `WARNING: this Page token expires ${new Date(expires * 1000).toISOString().slice(0, 16).replace('T', ' ')}. ` +
          'Set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET and run this again for a permanent one.',
  );
}

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--')) ?? '';
const flag = (f: string) => args.includes(f);
const opt = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

function need(env: string, provider: string): string {
  const v = process.env[env]?.trim();
  if (!v) {
    console.error(`${env} is not set. Add it to .env.local first.`);
    console.error(`  ${PROVIDERS[provider].hint ?? ''}`);
    process.exit(1);
  }
  return v;
}

/** Waits for the browser to come back to the loopback redirect. */
function waitForCode(redirect: string, state: string): Promise<string> {
  const url = new URL(redirect);
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const got = new URL(req.url ?? '/', redirect);
      if (got.pathname !== url.pathname) {
        res.writeHead(404).end();
        return;
      }
      const code = got.searchParams.get('code');
      const error = got.searchParams.get('error');
      // Providers put the useful half in error_description, and losing it
      // turns a five-second fix into a guessing game.
      const detail = got.searchParams.get('error_description') ?? '';
      const failure = [error, detail].filter(Boolean).join(': ');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<body style="font:16px system-ui;padding:3rem">${code ? 'Authorised. You can close this tab.' : `Failed: ${failure}<br><br>The terminal has the details.`}</body>`,
      );
      server.close();
      if (got.searchParams.get('state') !== state) return reject(new Error('state mismatch, aborting'));
      code ? resolve(code) : reject(new Error(failure || 'no code returned'));
    });
    server.listen(Number(url.port || 80), '127.0.0.1');
    setTimeout(() => {
      server.close();
      reject(new Error('timed out waiting for the browser'));
    }, 5 * 60_000);
  });
}

async function main() {
  const provider = PROVIDERS[name];
  if (!provider) {
    console.error(
      `usage: authorize.ts <${Object.keys(PROVIDERS).join('|')}> [--paste] [--redirect <url>] [--scope "<space separated>"]`,
    );
    process.exit(1);
  }

  // Facebook only: trade a user token you already hold for the Page token,
  // no app secret and no browser round trip.
  if (name === 'facebook' && flag('--from-user-token')) {
    const given = opt('--from-user-token');
    let userToken = given && !given.startsWith('--') ? given : process.env.FACEBOOK_PAGE_TOKEN?.trim();
    if (!userToken) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      userToken = (await rl.question('Paste the user access token: ')).trim();
      rl.close();
    }
    await pageFromUserToken(userToken);
    return;
  }

  const clientId = need(provider.idEnv, name);
  const secret = need(provider.secretEnv, name);
  const redirect = opt('--redirect') ?? provider.defaultRedirect;
  // LinkedIn answers "invalid_scope_error" without saying WHICH scope, and the
  // cause is always a Product that has not been added to the app. Asking for a
  // subset isolates it: --scope "openid profile" tests Sign In with OpenID
  // Connect, --scope "w_member_social" tests Share on LinkedIn.
  const scope = opt('--scope') ?? provider.scope;
  // Facebook will not re-show a consent it thinks you already answered, which
  // is how a grant with no Page attached becomes sticky. auth_type=rerequest
  // is the documented way to make it ask again.
  const rerequest = flag('--rerequest');
  const paste = flag('--paste') || !redirect.startsWith('http://localhost');
  const state = randomBytes(12).toString('hex');

  const verifier = randomBytes(48).toString('base64url');
  const params = new URLSearchParams({
    [provider.idParam]: clientId,
    response_type: 'code',
    redirect_uri: redirect,
    scope,
    state,
    ...(provider.extraAuth ?? {}),
    ...(rerequest ? { auth_type: 'rerequest' } : {}),
    ...(provider.pkce
      ? { code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }
      : {}),
  });

  // Printed on its own line because "redirect_uri does not match the
  // registered value" is the most common failure here, and the fix is to
  // paste this string into the app config character for character.
  console.log(`\nredirect_uri being sent (must match the app config EXACTLY):\n  ${redirect}`);
  console.log(`scopes being requested:\n  ${scope}`);
  console.log(`\nOpen this and approve as the smbsolved account:\n\n${provider.authUrl}?${params}\n`);
  if (provider.hint) console.log(`(app setup: ${provider.hint})\n`);

  let code: string;
  if (paste) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const back = (await rl.question('Paste the full URL you landed on: ')).trim();
    rl.close();
    const got = new URL(back);
    const err = got.searchParams.get('error');
    if (err) throw new Error(`${name} returned ${err}: ${got.searchParams.get('error_description') ?? ''}`);
    code = got.searchParams.get('code') ?? '';
    if (!code) throw new Error('that URL has no ?code= in it');
    if (got.searchParams.get('state') && got.searchParams.get('state') !== state)
      throw new Error('state mismatch, aborting');
  } else {
    console.log(`waiting for the redirect to ${redirect} ...`);
    code = await waitForCode(redirect, state);
  }

  const body = new URLSearchParams({
    [provider.idParam]: clientId,
    client_secret: secret,
    code: decodeURIComponent(code),
    grant_type: 'authorization_code',
    redirect_uri: redirect,
    ...(provider.pkce ? { code_verifier: verifier } : {}),
  });
  const res = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = (await res.json()) as Record<string, string | number>;
  if (provider.finish) {
    if (data.error) throw new Error(`${name} token exchange failed: ${JSON.stringify(data).slice(0, 400)}`);
    await provider.finish(data, { clientId, secret });
    return;
  }
  const token = data[provider.saveField!];
  if (typeof token !== 'string' || !token) {
    throw new Error(`${name} token exchange failed: ${JSON.stringify(data).slice(0, 400)}`);
  }

  setEnvLocal(provider.saveEnv!, token);
  console.log(`\n${provider.saveEnv} written to .env.local.`);
  if (provider.saveField === 'access_token' && typeof data.expires_in === 'number')
    console.log(`This one expires in ${Math.round(Number(data.expires_in) / 86400)} days. Run this again before then.`);
  if (name === 'linkedin' && !process.env.LINKEDIN_MEMBER_URN)
    console.log('Tip: LINKEDIN_MEMBER_URN is optional; it is looked up from the token when missing.');
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
