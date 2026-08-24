/**
 * Publishes files into the smbsolved.com website repo (jhtx/my-website) via
 * the GitHub Contents API. Netlify watches the repo, so a commit here is a
 * deploy: the file at https://smbsolved.com/<path> updates while its URL
 * stays permanent — which is what keeps Kit email links from going stale.
 *
 * Needs GITHUB_TOKEN in .env.local: a fine-grained personal access token
 * scoped to ONLY the my-website repo with "Contents: read and write".
 */
import './env';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { requireEnv } from './env';

const OWNER = process.env.WEBSITE_REPO_OWNER ?? 'jhtx';
const REPO = process.env.WEBSITE_REPO ?? 'my-website';
const BRANCH = process.env.WEBSITE_BRANCH ?? 'main';

async function gh<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${requireEnv('GITHUB_TOKEN')}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'smbsolved-reels-pipeline',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** Creates or updates one file in the site repo. Returns the public URL. */
export async function publishToSite(localPath: string, repoPath: string, message: string): Promise<string> {
  const content = readFileSync(localPath).toString('base64');

  // updating needs the current blob sha; 404 means it's a new file
  let sha: string | undefined;
  try {
    const existing = await gh<{ sha: string }>('GET', `/contents/${repoPath}?ref=${BRANCH}`);
    sha = existing.sha;
  } catch (e) {
    if (!(e as Error).message.includes('404')) throw e;
  }

  await gh('PUT', `/contents/${repoPath}`, {
    message,
    content,
    branch: BRANCH,
    ...(sha ? { sha } : {}),
  });
  return `https://smbsolved.com/${repoPath}`;
}

export const hasSiteToken = () => !!process.env.GITHUB_TOKEN?.trim();

/**
 * Publish via plain git with the machine's cached credentials (Git Credential
 * Manager) — proven working from this box 2026-08-24, so no PAT is required
 * for the pipeline. Keeps a shallow clone in out/site-repo.
 */
export function publishViaGit(files: { local: string; repoPath: string }[], message: string): string[] {
  const ex = existsSync;
  const dn = dirname;
  const rs = resolvePath;

  const dir = rs('out/site-repo');
  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: ex(dir) ? dir : undefined,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });

  if (!ex(dir)) {
    execFileSync('git', ['clone', '--depth', '1', `https://github.com/${OWNER}/${REPO}`, dir], {
      encoding: 'utf8',
      windowsHide: true,
    });
  } else {
    git(['fetch', '--depth', '1', 'origin', BRANCH]);
    git(['reset', '--hard', `origin/${BRANCH}`]);
  }

  for (const f of files) {
    const dest = rs(dir, f.repoPath);
    mkdirSync(dn(dest), { recursive: true });
    copyFileSync(f.local, dest);
    git(['add', f.repoPath]);
  }
  const status = git(['status', '--porcelain']);
  if (!status.trim()) return files.map((f) => `https://smbsolved.com/${f.repoPath}`);

  git(['-c', 'user.name=Jimmy', '-c', 'user.email=jhuynhtx@gmail.com', 'commit', '-m', message + '\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>']);
  git(['push', 'origin', `HEAD:${BRANCH}`]);
  return files.map((f) => `https://smbsolved.com/${f.repoPath}`);
}

// CLI: npx tsx pipeline/github.ts <localPath> <repoPath> [commit message]
if (process.argv[1]?.endsWith('github.ts')) {
  const [local, repoPath, ...msg] = process.argv.slice(2);
  if (!local || !repoPath) throw new Error('usage: github.ts <localPath> <repoPath> [message]');
  publishToSite(local, repoPath, msg.join(' ') || `publish ${repoPath}`)
    .then((url) => console.log(`published → ${url} (Netlify deploys in ~a minute)`))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
