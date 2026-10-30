/**
 * appgen-round.mjs — the 40-round loop's mechanical driver. One command
 * runs the benchmark battery (or a subset) for one round with the right
 * env and ledger stems, then prints a single machine-readable line:
 *
 *   ROUND_RESULT {"round":N,"legs":{...}}
 *
 * Modes:
 *   battery --round N        port(BENCH_RUNS=2) + chain + census + visual
 *   verify  --round N --legs port,chain   re-run a subset after a fix
 *
 * Env comes from the seat's .env (DSH_LLM_* generator, ZAI_* judge) —
 * the same defaults the individual runners carry. Everything the auto-
 * improve loop needs to measure one round, without shell gymnastics.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const ENV_FILE = join(ROOT, '.env');
if (!existsSync(ENV_FILE)) {
  console.error(`appgen-round: no .env at ${ENV_FILE} — copy it from the primary checkout`);
  process.exit(1);
}
const envFile = Object.fromEntries(
  readFileSync(ENV_FILE, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
// Zhipu-only by owner decision (2026-10-30): the DeepSeek generator
// account went unpaid (HTTP 402 from round 15 on) — every model in the
// battery now comes from the ZAI endpoint (generator glm-5.3-flash,
// judges glm-4.6 / glm-4.6v).
const ENV = {
  ...process.env,
  LLM_BASE_URL: process.env.LLM_BASE_URL || envFile.ZAI_BASE_URL,
  LLM_API_KEY: process.env.LLM_API_KEY || envFile.ZAI_API_KEY,
  LLM_MODEL: process.env.LLM_MODEL || 'glm-5.3-flash',
  JUDGE_BASE_URL: process.env.JUDGE_BASE_URL || envFile.ZAI_BASE_URL,
  JUDGE_API_KEY: process.env.JUDGE_API_KEY || envFile.ZAI_API_KEY,
};
if (!ENV.LLM_API_KEY || !ENV.JUDGE_API_KEY) {
  console.error('appgen-round: missing generator/judge credentials');
  process.exit(1);
}

const args = process.argv.slice(2);
const mode = args[0] ?? '';
const round = Number(args[args.indexOf('--round') + 1] ?? 0);
const LEGS_ALL = ['port', 'chain', 'census', 'visual'];
const legsArg = args[args.indexOf('--legs') + 1];
const legs = mode === 'verify' && legsArg ? legsArg.split(',').filter((l) => LEGS_ALL.includes(l)) : LEGS_ALL;

if (!['battery', 'verify'].includes(mode) || !round) {
  console.error('usage: appgen-round.mjs battery|verify --round N [--legs port,chain,census,visual]');
  process.exit(1);
}

// The visual leg needs puppeteer-core (test/tools devDependencies).
if (legs.includes('visual') && !existsSync(join(ROOT, 'test/tools/node_modules/puppeteer-core'))) {
  spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: join(ROOT, 'test/tools'), stdio: 'inherit' });
}

// The four legs are independent (separate ledgers, separate judge/model
// streams) and run CONCURRENTLY — a round costs the longest leg, not the
// sum. stdio inherits, so interleaved lines are expected.
const runAsync = (leg, stem, extraEnv) => new Promise((resolve, reject) => {
  const spec = {
    port: { script: 'test/panel/appgen-bench-port.mjs', env: { BENCH_RUNS: '2' } },
    chain: { script: 'test/panel/appgen-chain.mjs', env: {} },
    census: { script: 'test/panel/appgen-eval.mjs', env: { APPGEN_RUNS: '2' } },
    visual: { script: 'test/panel/appgen-visual.mjs', env: { VISUAL_N: '12' } },
  }[leg];
  const r = spawn('node', [spec.script], {
    cwd: ROOT,
    env: { ...ENV, LEDGER_STEM: stem, ...spec.env, ...extraEnv },
    stdio: 'inherit',
    timeout: 90 * 60 * 1000,
  });
  r.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${leg} runner exited ${code}`))));
  r.on('error', reject);
});

const readLedger = (dir, prefix) => {
  // Latest by meta.at, never filename order.
  const d = join(ROOT, 'tools/dev-web-carrier/artifacts', dir);
  if (!existsSync(d)) return null;
  const parsed = readdirSync(d).filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .map((f) => { try { return JSON.parse(readFileSync(join(d, f), 'utf8')); } catch { return null; } })
    .filter((l) => l?.meta?.at);
  parsed.sort((a, b) => new Date(b.meta.at) - new Date(a.meta.at));
  return parsed[0] ?? null;
};
const legStems = { port: 'webgen-port-deepseek-v4-flash-r', chain: 'appgen-chain-deepseek-v4-flash-r', census: 'appgen-census-deepseek-v4-flash-r', visual: 'appgen-visual-deepseek-v4-flash-r' };
const result = { round, legs: {} };

await Promise.all(legs.map((leg) => runAsync(leg, `${legStems[leg]}r${round}`)));
const stemOf = { port: 'webgen-port-deepseek-v4-flash-r', chain: 'appgen-chain-deepseek-v4-flash-r', census: 'appgen-census-deepseek-v4-flash-r', visual: 'appgen-visual-deepseek-v4-flash-r' };
if (legs.includes('port')) {
  const l = readLedger('appgen-bench', stemOf.port);
  result.legs.port = {
    meanAccuracy: l?.meanAccuracy ?? null,
    dvPooled: l?.categories?.['Design Validation Testing']?.accuracy ?? null,
    startFailed: l?.diagnostics?.startFailedInstructions ?? null,
  };
}
if (legs.includes('chain')) {
  const l = readLedger('appgen-bench', stemOf.chain);
  result.legs.chain = { accuracy: l?.overall?.accuracy ?? null, refusals: l?.diagnostics?.rejectedUpdates ?? null };
}
if (legs.includes('census')) {
  const l = readLedger('appgen-eval', stemOf.census);
  result.legs.census = l?.percentages ?? null;
}
if (legs.includes('visual')) {
  const l = readLedger('appgen-bench', stemOf.visual);
  result.legs.visual = { bgYes: l?.visual?.backgroundYes ?? null, bgScored: l?.visual?.scored ?? null, appearance: l?.visual?.meanAppearance ?? null };
}

console.log('ROUND_RESULT ' + JSON.stringify(result));
