/**
 * Builds and VERIFIES the "Fixed Asset Register & Roll-forward" template.
 *
 * The PowerShell builder makes real Excel construct the workbook and reports
 * what Excel computed. This driver re-derives every key number independently
 * in TypeScript (same conventions: straight-line full-month book, MACRS GDS
 * half-year tax) and refuses to publish on any mismatch. Two implementations
 * agreeing is the "verified" credential the landing page claims.
 *
 *   npx tsx pipeline/template-far.ts
 */
import './env';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { notify } from './deliver';

const YEAR = 2026;
const OUT = resolve('out/templates/smbsolved-fixed-asset-register.xlsx');
const SCRIPT = resolve('pipeline/templates/build-fixed-asset-register.ps1');

/* ---------------- independent computation ---------------------------------- */

type Asset = {
  row: number;
  isv: [number, number]; // year, month
  cost: number;
  salvage: number;
  lifeYrs: number;
  taxClass: 3 | 5 | 7 | 10 | 15;
  bonus: number;
  disposal?: [number, number];
  proceeds?: number;
};

const ASSETS: Asset[] = [
  { row: 5, isv: [2023, 3], cost: 28500, salvage: 2500, lifeYrs: 7, taxClass: 5, bonus: 0 },
  { row: 6, isv: [2024, 7], cost: 64200, salvage: 0, lifeYrs: 10, taxClass: 15, bonus: 0 },
  { row: 7, isv: [2026, 1], cost: 8940, salvage: 0, lifeYrs: 3, taxClass: 5, bonus: 0.8 },
  { row: 8, isv: [2026, 4], cost: 52800, salvage: 4800, lifeYrs: 5, taxClass: 5, bonus: 0 },
  { row: 9, isv: [2021, 9], cost: 145000, salvage: 5000, lifeYrs: 10, taxClass: 7, bonus: 0 },
  { row: 10, isv: [2022, 5], cost: 18600, salvage: 0, lifeYrs: 5, taxClass: 5, bonus: 0, disposal: [2026, 6], proceeds: 4200 },
];

const MACRS: Record<number, number[]> = {
  3: [0.3333, 0.4445, 0.1481, 0.0741],
  5: [0.2, 0.32, 0.192, 0.1152, 0.1152, 0.0576],
  7: [0.1429, 0.2449, 0.1749, 0.1249, 0.0893, 0.0892, 0.0893, 0.0446],
  10: [0.1, 0.18, 0.144, 0.1152, 0.0922, 0.0737, 0.0655, 0.0655, 0.0656, 0.0655, 0.0328],
  15: [0.05, 0.095, 0.0855, 0.077, 0.0693, 0.0623, 0.059, 0.059, 0.0591, 0.059, 0.0591, 0.059, 0.0591, 0.059, 0.0591, 0.0295],
};

function expectAsset(a: Asset) {
  const lifeMo = a.lifeYrs * 12;
  const [iy, im] = a.isv;
  const moPrior = Math.max(0, Math.min(lifeMo, (YEAR - 1 - iy) * 12 + 13 - im));
  const disposedThisYear = a.disposal?.[0] === YEAR;
  const startM = iy === YEAR ? im : 1;
  const endM = disposedThisYear ? a.disposal![1] - 1 : 12;
  const moCur = iy > YEAR ? 0 : Math.max(0, Math.min(endM - startM + 1, lifeMo - moPrior));
  const monthly = (a.cost - a.salvage) / lifeMo;
  const begAD = moPrior * monthly;
  const dep = moCur * monthly;
  const relief = disposedThisYear ? begAD + dep : 0;
  const endAD = disposedThisYear ? 0 : begAD + dep;
  const endCost = disposedThisYear ? 0 : a.cost;
  const nbv = endCost - endAD;
  const gain = disposedThisYear ? (a.proceeds ?? 0) - (a.cost - relief) : null;
  const taxYr = YEAR - iy + 1;
  const pct = MACRS[a.taxClass][taxYr - 1] ?? 0;
  const taxDep = a.cost * (1 - a.bonus) * pct * (disposedThisYear ? 0.5 : 1) + (taxYr === 1 ? a.cost * a.bonus : 0);
  return { begAD, dep, relief, endAD, endCost, nbv, gain, taxDep, addedThisYear: iy === YEAR ? 1 : 0 };
}

/* ---------------- run the builder (or check an edited file) and compare ---- */

/** The full expected-cells map, shared by build and --check modes. */
export function expectedCells(): Record<string, number | string> {
  const ex = ASSETS.map(expectAsset);
  const want: Record<string, number | string> = {};
  for (let i = 0; i < ASSETS.length; i++) {
    const r = ASSETS[i].row;
    want[`O${r}`] = ex[i].dep;
    want[`Q${r}`] = ex[i].endAD;
    want[`S${r}`] = ex[i].nbv;
    want[`W${r}`] = ex[i].taxDep;
  }
  want['T10'] = ex[5].gain!;
  const sum = (f: (e: ReturnType<typeof expectAsset>) => number) => ex.reduce((n, e) => n + f(e), 0);
  want['N11'] = sum((e) => e.begAD);
  want['O11'] = sum((e) => e.dep);
  want['P11'] = sum((e) => e.relief);
  want['Q11'] = sum((e) => e.endAD);
  want['R11'] = sum((e) => e.endCost);
  want['S11'] = sum((e) => e.nbv);
  want['W11'] = sum((e) => e.taxDep);
  want['B15'] = ASSETS.filter((a) => a.isv[0] < YEAR).reduce((n, a) => n + a.cost, 0);
  want['B16'] = ASSETS.filter((a) => a.isv[0] === YEAR).reduce((n, a) => n + a.cost, 0);
  want['B17'] = -ASSETS.filter((a) => a.disposal?.[0] === YEAR).reduce((n, a) => n + a.cost, 0);
  want['B18'] = (want['B15'] as number) + (want['B16'] as number) + (want['B17'] as number);
  want['C18'] = (want['N11'] as number) + (want['O11'] as number) - (want['P11'] as number);
  want['B20'] = (want['B18'] as number) - (want['C18'] as number);
  want['B19'] = 'OK';
  want['C19'] = 'OK';
  want['B21'] = 'OK';
  return want;
}

function runPs(script: string, argName: string, argValue: string): Record<string, number | string> {
  const stdout = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, argName, argValue],
    { encoding: 'utf8', timeout: 180_000, windowsHide: true },
  );
  const line = stdout.trim().split('\n').reverse().find((l) => l.trim().startsWith('{'));
  if (!line) throw new Error(`no JSON from ${script}:\n${stdout}`);
  return JSON.parse(line) as Record<string, number | string>;
}

function main() {
  mkdirSync(dirname(OUT), { recursive: true });

  const args = process.argv.slice(2);
  const checkIdx = args.indexOf('--check');
  let got: Record<string, number | string>;
  if (checkIdx >= 0) {
    // Re-verify an EXISTING (possibly hand-edited) workbook before republishing.
    const path = resolve(args[checkIdx + 1] ?? OUT);
    console.log(`checking existing workbook: ${path}`);
    got = runPs(resolve('pipeline/templates/verify-far-file.ps1'), '-Path', path);
    if (path !== OUT) copyFileSync(path, OUT); // the checked file becomes canonical
  } else {
    console.log('building workbook in Excel');
    got = runPs(SCRIPT, '-OutPath', OUT);
  }

  const want = expectedCells();
  const failures: string[] = [];
  for (const [cell, exp] of Object.entries(want)) {
    const g = got[cell];
    if (typeof exp === 'string') {
      if (String(g).trim() !== exp) failures.push(`${cell}: Excel "${g}", expected "${exp}"`);
    } else {
      const gn = typeof g === 'number' ? g : Number(g);
      if (!Number.isFinite(gn) || Math.abs(gn - exp) > 0.005)
        failures.push(`${cell}: Excel ${g}, TypeScript ${exp.toFixed(4)}`);
    }
  }

  if (failures.length) {
    console.error(`\n${failures.length} MISMATCH(ES) — not publishing:`);
    for (const f of failures) console.error('  ' + f);
    process.exit(1);
  }

  const sha = createHash('sha256').update(readFileSync(OUT)).digest('hex').slice(0, 16);
  const verification = {
    template: 'fixed-asset-register',
    excel: String(got['excel']),
    on: new Date().toISOString().slice(0, 10),
    checksCompared: Object.keys(want).length,
    fileSha256: sha,
    conventions: 'book: straight-line, full-month; tax: MACRS GDS half-year, bonus in year 1; report year 2026 sample data',
  };
  writeFileSync(OUT.replace(/\.xlsx$/, '.verification.json'), JSON.stringify(verification, null, 2) + '\n');
  console.log(`all ${verification.checksCompared} checks agree · Excel ${verification.excel} vs TypeScript`);

  // publish to the OneDrive-synced Templates folder, next to Reels
  const reels = process.env.ARCHIVE_DIR ?? 'D:\\OneDrive - SMB Solved\\SMB Solved\\Marketing\\Reels';
  const tplDir = join(dirname(reels), 'Templates');
  if (existsSync(dirname(tplDir))) {
    mkdirSync(tplDir, { recursive: true });
    copyFileSync(OUT, join(tplDir, 'smbsolved-fixed-asset-register.xlsx'));
    copyFileSync(OUT.replace(/\.xlsx$/, '.verification.json'), join(tplDir, 'smbsolved-fixed-asset-register.verification.json'));
    console.log(`published → ${tplDir}`);
  }

  // and to smbsolved.com via the website repo (Netlify deploys the commit).
  // The URL is permanent; only the file behind it changes — Kit email links
  // never go stale.
  return (async () => {
    const { hasSiteToken, publishToSite, publishViaGit } = await import('./github');
    const msg = `templates: fixed-asset register ${verification.on} (verified, ${verification.checksCompared} checks, ${verification.fileSha256})`;
    const files = [
      { local: OUT, repoPath: 'templates/smbsolved-fixed-asset-register.xlsx' },
      { local: OUT.replace(/\.xlsx$/, '.verification.json'), repoPath: 'templates/smbsolved-fixed-asset-register.verification.json' },
    ];
    try {
      // primary: plain git with the machine's cached credentials
      const urls = publishViaGit(files, msg);
      console.log(`published → ${urls[0]}`);
    } catch (e) {
      if (hasSiteToken()) {
        const url = await publishToSite(files[0].local, files[0].repoPath, msg);
        console.log(`published → ${url} (via Contents API)`);
      } else {
        console.log(`site publish skipped: git push failed (${(e as Error).message.split('\n')[0]}) and no GITHUB_TOKEN fallback`);
      }
    }
    return verification;
  })();
}

// CLI only — guarded so importing expectedCells() can NEVER trigger a build.
// (Unguarded, an import once rebuilt the workbook and overwrote the owner's
// hand-cleaned copy. See DECISIONS 2026-08-24.)
if (process.argv[1]?.endsWith('template-far.ts')) {
  Promise.resolve()
    .then(main)
    .then((v) =>
      notify(
        `Template verified and published: fixed-asset register (${v.checksCompared} cells agree between Excel ${v.excel} and TypeScript). In OneDrive → Marketing → Templates.`,
      ),
    )
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
