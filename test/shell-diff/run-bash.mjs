// dsh:logging-exempt (node-side runner: it drives real bash and its JSONL is the product)
/**
 * run-bash.mjs — the bash side of the shell-diff harness (test-hardening
 * row 6). Feeds every cases.json script to REAL bash and records
 * {exitCode, stdout, stderr} per case as JSONL — the exact shape the dsh
 * driver writes, so compare.mjs consumes two symmetric files.
 *
 * Layout mirrors the dsh workspace: one sandbox root, per-case fixture
 * directories `cases/<id>/` underneath. Each script runs with cwd = its
 * case directory, so path-bearing output (pwd) normalizes to the same
 * workspace-relative spelling on both sides. The script FILE itself lives
 * OUTSIDE the case directory (`<sandbox>/scripts/<id>.sh`) — a script must
 * never appear in its own glob.
 *
 * usage: node run-bash.mjs --sandbox <dir> --out <results.jsonl>
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The case matrix — DATA only, shared verbatim with the dsh side (the same
 * JSON object is the --bus-inject payload driver.mjs consumes). */
const CASES = JSON.parse(readFileSync(join(here, 'cases.json'), 'utf8')).cases;

const args = process.argv.slice(2);
const opt = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const sandbox = resolve(opt('--sandbox') ?? die('usage: run-bash.mjs --sandbox <dir> --out <results.jsonl>'));
const out = resolve(opt('--out') ?? die('usage: run-bash.mjs --sandbox <dir> --out <results.jsonl>'));

function die(message) {
  console.error(`run-bash: ${message}`);
  process.exit(2);
}

const bashVersion = spawnSync('bash', ['--version'], { encoding: 'utf8' });
if (bashVersion.error !== undefined || bashVersion.status !== 0) {
  die(`real bash is required (the differential's reference seat): ${bashVersion.error?.message ?? 'bash --version failed'}`);
}

rmSync(sandbox, { recursive: true, force: true });
mkdirSync(join(sandbox, 'scripts'), { recursive: true });

const rows = [];
for (const one of CASES) {
  const caseDir = join(sandbox, 'cases', one.id);
  mkdirSync(caseDir, { recursive: true });
  // The same dot-marker the dsh driver stages (dir creation for
  // fixture-less cases; dotfiles are invisible to bash's globs).
  writeFileSync(join(caseDir, '.case'), `${one.id}\n`, 'utf8');
  for (const [name, content] of Object.entries(one.files ?? {})) {
    writeFileSync(join(caseDir, name), content, 'utf8');
  }
  // The script lives outside its own case dir (it must never glob-match
  // itself); bash runs it with cwd = the case dir.
  const scriptPath = join(sandbox, 'scripts', `${one.id}.sh`);
  writeFileSync(scriptPath, one.script, 'utf8');
  const run = spawnSync('bash', [scriptPath], {
    cwd: caseDir,
    env: { ...process.env, LC_ALL: 'C' },
    encoding: 'utf8',
  });
  if (run.error !== undefined) die(`case ${one.id}: bash could not run: ${run.error.message}`);
  rows.push({
    id: one.id,
    family: one.family,
    kind: one.kind,
    exitCode: run.status === null ? -1 : run.status,
    stdout: run.stdout,
    stderr: run.stderr,
  });
  console.error(`run-bash: ${one.id} → exit ${rows[rows.length - 1].exitCode}`);
}

mkdirSync(dirname(out), { recursive: true });
rmSync(out, { force: true });
for (const row of rows) appendFileSync(out, `${JSON.stringify(row)}\n`, 'utf8');
console.error(`run-bash: ${rows.length} cases → ${out}`);
