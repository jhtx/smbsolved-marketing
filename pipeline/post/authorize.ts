/**
 * One-time OAuth consent for the posting platforms. Run it once per platform,
 * click through in a browser, and the long-lived credential lands in
 * `.env.local`. Nothing in the daily pipeline ever needs a browser again.
 *
 *   npm run authorize -- youtube
 *   npm run authorize -- linkedin
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
  saveEnv: string;
  /** which field of the token response is the long-lived credential */
  saveField: 'refresh_token' | 'access_token';
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
    hint: 'developer.linkedin.com → your app → Auth tab. Add this redirect URL, and request the "Share on LinkedIn" and "Sign In with LinkedIn using OpenID Connect" products.',
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
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<body style="font:16px system-ui;padding:3rem">${code ? 'Authorised. You can close this tab.' : `Failed: ${error}`}</body>`,
      );
      server.close();
      if (got.searchParams.get('state') !== state) return reject(new Error('state mismatch, aborting'));
      code ? resolve(code) : reject(new Error(error ?? 'no code returned'));
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
    console.error(`usage: authorize.ts <${Object.keys(PROVIDERS).join('|')}> [--paste] [--redirect <url>]`);
    process.exit(1);
  }

  const clientId = need(provider.idEnv, name);
  const secret = need(provider.secretEnv, name);
  const redirect = opt('--redirect') ?? provider.defaultRedirect;
  const paste = flag('--paste') || !redirect.startsWith('http://localhost');
  const state = randomBytes(12).toString('hex');

  const verifier = randomBytes(48).toString('base64url');
  const params = new URLSearchParams({
    [provider.idParam]: clientId,
    response_type: 'code',
    redirect_uri: redirect,
    scope: provider.scope,
    state,
    ...(provider.extraAuth ?? {}),
    ...(provider.pkce
      ? { code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }
      : {}),
  });

  // Printed on its own line because "redirect_uri does not match the
  // registered value" is the most common failure here, and the fix is to
  // paste this string into the app config character for character.
  console.log(`\nredirect_uri being sent (must match the app config EXACTLY):\n  ${redirect}`);
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
  const token = data[provider.saveField];
  if (typeof token !== 'string' || !token) {
    throw new Error(`${name} token exchange failed: ${JSON.stringify(data).slice(0, 400)}`);
  }

  setEnvLocal(provider.saveEnv, token);
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
