/**
 * Loads `.env.local` (secrets, gitignored) then `.env` (defaults) into
 * process.env without overriding variables already set in the shell.
 *
 * Import this first in any pipeline entry point:
 *   import './env';
 *
 * Node 20.12+ has process.loadEnvFile built in; no dotenv dependency.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const file of ['.env.local', '.env']) {
  const p = resolve(file);
  if (!existsSync(p)) continue;
  // loadEnvFile does not override existing keys, so the order above means
  // shell > .env.local > .env.
  process.loadEnvFile(p);
}

/**
 * Rewrites one key in `.env.local` and in this process. For credentials that
 * rotate on use: TikTok hands back a new refresh token every time it is
 * redeemed, and losing it means re-authorising by hand.
 */
export function setEnvLocal(name: string, value: string): void {
  const p = resolve('.env.local');
  const line = `${name}=${value}`;
  const current = existsSync(p) ? readFileSync(p, 'utf8') : '';
  const re = new RegExp(`^${name}=.*$`, 'm');
  const next = re.test(current) ? current.replace(re, line) : `${current.replace(/\s*$/, '')}\n${line}\n`;
  writeFileSync(p, next);
  process.env[name] = value;
}

/** Reads a required variable or throws with a message that names the file to edit. */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`${name} is not set. Add it to .env.local (see .env.example).`);
  }
  return v.trim();
}
