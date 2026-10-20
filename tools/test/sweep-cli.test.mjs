// Process-level net for tools/test/sweep.mjs: the entry-module guard through
// a SYMLINKED checkout (macOS /tmp -> /private/tmp made the bare argv[1]
// comparison a silent exit 0 — review finding), the exit-code contract
// (2 usage / 0 dry-run plan on stdout), and the leg wait being on EXIT, not
// `close` (a detached grandchild holding the log fd must not hold the lane).
// Everything spawns the real files from a mkdtemp seat; nothing writes into
// the repo and nothing needs the vendored closure or the dsh-cli binary.
import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLeg } from './sweep.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const SWEEP = join(HERE, 'sweep.mjs');

const seat = () => mkdtempSync(join(tmpdir(), 'sweep-cli-'));
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });
const runNode = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

it('sweep.mjs --wat exits 2 with the usage line (bash exited 2 on an unknown flag too)', () => {
  const result = runNode(SWEEP, ['--wat']);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("unknown flag '--wat'");
  expect(result.stderr).toContain('usage: node tools/test/sweep.mjs');
});

it('sweep.mjs --dry-run prints the plan as JSON, exits 0, writes nothing — no binary, no specs needed', () => {
  const root = seat();
  const result = runNode(SWEEP, ['--dry-run', '--out', root, '--paral', '2']);
  expect(result.status).toBe(0);
  const plan = JSON.parse(result.stdout);
  expect(plan.dryRun).toBe(true);
  expect(plan.parallel).toBe(2);
  expect(plan.legs).toEqual(['qjs', 'node-differential']);
  expect(plan.outDir).toBe(root);
  expect(Array.isArray(plan.missingRequires)).toBe(true);
  expect(existsSync(join(root, 'upstream-suite-logs'))).toBe(false);
  cleanup(root);
});

it('the entry guards survive a symlinked checkout: sweep, verifications, generation and the shim all dispatch', () => {
  const root = seat();
  const link = join(root, 'link');
  symlinkSync(REPO, link);
  const sweep = runNode(join(link, 'tools/test/sweep.mjs'), ['--wat']);
  expect(sweep.status).toBe(2);
  expect(sweep.stderr).toContain("unknown flag '--wat'");
  const verifications = runNode(join(link, 'test/verifications.mjs'), ['--wat']);
  expect(verifications.status).toBe(1);
  expect(verifications.stderr).toContain("unknown flag '--wat'");
  const generation = runNode(join(link, 'test/upstream-suite/generation.mjs'), []);
  expect(generation.status).toBe(0);
  expect(generation.stdout.trim()).toMatch(/^[0-9a-f]{64}$/);
  const shim = spawnSync('sh', [join(link, 'runtime/dsh/ci/run-upstream-suite-sweep.sh'), '--wat'], { encoding: 'utf8' });
  expect(shim.status).toBe(2);
  expect(shim.stderr).toContain("unknown flag '--wat'");
  cleanup(root);
});

/** The leg spawns a DETACHED grandchild that inherits the log fd and lives
 * ~3 s, then hangs itself; the driver's 400 ms timeout kills the leg. */
const GRANDCHILD_HOLDER_CODE =
  'const cp = require("node:child_process"); ' +
  'cp.spawn(process.execPath, ["-e", "setTimeout(() => {}, 3000)"], { stdio: "inherit", detached: true }).unref(); ' +
  'setInterval(() => {}, 1000);';

it('runLeg returns on the leg EXIT even while a detached grandchild still holds the log fd', async () => {
  const root = seat();
  const leg = {
    id: 'qjs',
    column: 'qjs',
    drive: { cwd: '.', retries: 0, summary: { pattern: 'never', pick: 'last' }, argv: () => [process.execPath, '-e', GRANDCHILD_HOLDER_CODE] },
  };
  const started = Date.now();
  const result = await runLeg(leg, 'x.spec.mjs', { root, logPath: join(root, 'x.qjs.log'), timeoutMs: 400 });
  const elapsed = Date.now() - started;
  expect(result.timedOut).toBe(true);
  // The grandchild lives ~3 s: a `close`-based wait would have paid all of it.
  expect(elapsed).toBeLessThan(2500);
  cleanup(root);
});
