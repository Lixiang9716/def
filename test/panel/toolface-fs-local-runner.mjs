// dsh:logging-exempt (test scenario runner: stdout IS the product)
/**
 * toolface-fs-local-runner.mjs — the loop-v2 tool-face scenario. Runs the
 * REAL vendored @deepseek-ai/dsh-fs-local over the shims (the device loader
 * map applied by toolface-loader-hooks.mjs) against the faked C seam, and
 * prints one JSON line of structured facts for the vitest suite to assert:
 *
 *   (a) resolve+stat of an EXISTING outside-root directory — the 2026-10-05
 *       battery's /system/app case. loop-v2 refused INSIDE ctx.fs.stat with
 *       the #358 anchor; #259 (2026-10-19) re-drew the boundary by SURFACE —
 *       stat is a metadata face and answers truthfully from everywhere — so
 *       this fact now pins the VISIBILITY half: the stat answers, and the
 *       anchor teaching moves to the data face (r).
 *   (b) resolve+stat of an ABSENT outside-root path — the fix keeps fs-local's
 *       ancestor walk and the stat lands absent (the FS_NOT_FOUND handoff).
 *   (c) a real INSIDE-root directory still answers and lists (unchanged).
 *   (r) the DATA face keeps the loop-r boundary: a read of a real file in
 *       the outside-root tree refuses with the #358 anchor — the #259 law
 *       (visible ≠ accessible) in one fact.
 */
import { mkdirSync, writeFileSync, rmSync, statSync as nodeStatSync, readdirSync as nodeReaddirSync } from 'node:fs';
import { join } from 'node:path';
import { mountWorkspace } from 'upstream/shims/fs-workspace.js';
import { readFileSync } from 'upstream/shims/fs.js';
import { mkdtempPosix } from './posix-fixture.mjs';

// The simulation is the POSIX device seat: this runner already fakes the C
// seam over real node and mounts a '/'-prefixed workspace, and the vendored
// closure branches on process.platform (fs-local's ancestor walk stats the
// ancestor only on win32) — present the device platform so the pinned
// semantics are the device's. A no-op on the POSIX CI runners.
if (process.platform !== 'posix') {
  Object.defineProperty(process, 'platform', { value: 'posix' });
}

const { LocalFileSystem } = await import('@deepseek-ai/dsh-fs-local');

const root = mkdtempPosix('dsh-toolface-');
mountWorkspace(root);

// (a)'s shape: a real directory OUTSIDE the root (the /system/app sibling).
const systemApp = `/tmp/dsh-toolface-system-${process.pid}`;
mkdirSync(systemApp, { recursive: true });
// The marker byte-shape: the pin asserts the read refusal never carries the
// CONTENT — spell it so no substring of the refused path can false-positive.
writeFileSync(join(systemApp, 'BasicDreams.apk'), 'outside-bytes\n');

// (c)'s control: a real INSIDE-root directory the served view never
// registered — the loop-p "real child" shape that must keep answering.
mkdirSync(join(root, 'real-child'), { recursive: true });
writeFileSync(join(root, 'real-child', 'notes.txt'), 'real\n');

// The seam faked over node:fs — the C-host face: plain booleans PLUS the
// mode/mtimeMs fields the stat fallback's bigint face versions with (the
// loop-r suite's statReal shape, completed with the fields the vendored
// probe reads — the C host's __dshProcStatReal carries them too).
const statReal = (p) => {
  try {
    const st = nodeStatSync(p);
    return {
      isDirectory: st.isDirectory(),
      isFile: st.isFile(),
      isSymbolicLink: st.isSymbolicLink(),
      size: Number(st.size),
      mode: Number(st.mode),
      mtimeMs: Math.trunc(Number(st.mtimeMs)),
    };
  } catch {
    return null;
  }
};
globalThis.__dshProcStatReal = statReal;
// The C host's names-only readdir seam (loop-p): direct children, "." and
// ".." skipped, null when absent.
globalThis.__dshProcReaddirReal = (p) => {
  try {
    return nodeReaddirSync(p);
  } catch {
    return null;
  }
};

// The vendored backend the way the tools see it: same class, config the
// plugin loader would validate in (`internals`/`locks` are the instance
// fields the constructor would lay down; resolve/stat/listDir read only
// `config` and `locks`).
const fsService = Object.create(LocalFileSystem.prototype);
fsService.config = { cwd: root, diffBasisMaxBytes: 10 * 1024 * 1024 };
fsService.internals = {};
fsService.locks = new Map();

const statOutcome = async (target) => {
  try {
    const info = await fsService.stat(target);
    return { threw: false, info: info ?? null };
  } catch (error) {
    return {
      threw: true,
      message: error.message,
      code: error.code,
      errno: error.errno,
      syscall: error.syscall,
    };
  }
};

const facts = { root, systemApp };

// (a) existing outside-root directory.
{
  const target = await fsService.resolve(systemApp);
  const outcome = await statOutcome(target);
  facts.a = { ...outcome, displayPath: target.displayPath };
}

// (r) the data face keeps the boundary: read a real file OUTSIDE the root
// through the shim's read face — the #358 anchor refusal, never the bytes.
{
  try {
    const bytes = readFileSync(join(systemApp, 'BasicDreams.apk'), 'utf8');
    facts.r = { threw: false, bytes };
  } catch (error) {
    facts.r = {
      threw: true,
      message: error.message,
      code: error.code,
      errno: error.errno,
      syscall: error.syscall,
    };
  }
}

// (b) absent outside-root path.
{
  const absent = `/tmp/dsh-toolface-absent-${process.pid}/definitely-not-here-xyz`;
  let resolveOk = true;
  let displayPath = null;
  let resolveError = null;
  let target;
  try {
    target = await fsService.resolve(absent);
    displayPath = target.displayPath;
  } catch (error) {
    resolveOk = false;
    resolveError = { message: error.message, code: error.code };
  }
  const outcome = resolveOk ? await statOutcome(target) : null;
  facts.b = { resolveOk, displayPath, resolveError, stat: outcome };
}

// (c) real inside-root directory (unchanged).
{
  const target = await fsService.resolve(join(root, 'real-child'));
  const outcome = await statOutcome(target);
  let listingNames = null;
  let listError = null;
  try {
    listingNames = (await fsService.listDir(target)).map((entry) => entry.name);
  } catch (error) {
    listError = { message: error.message, code: error.code };
  }
  facts.c = { stat: outcome, listingNames, listError };
}

rmSync(root, { recursive: true, force: true });
rmSync(systemApp, { recursive: true, force: true });

console.log(JSON.stringify(facts));
