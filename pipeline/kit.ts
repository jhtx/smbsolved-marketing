/** Shared Kit v4 API client. Header auth (X-Kit-Api-Key); some endpoints are
 * plan-gated and return 403 with a valid key — callers handle that. */
import './env';
import { requireEnv } from './env';

const API = 'https://api.kit.com/v4';

export async function kit<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'X-Kit-Api-Key': requireEnv('KIT_API_KEY'),
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Kit ${method} ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

/** The published lead-magnet landing page (created 2026-08-24). */
export const LANDING_URL = process.env.KIT_LANDING_URL ?? 'https://smbsolved.kit.com/9df3dd7dc4';
