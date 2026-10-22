#!/usr/bin/env node
// dsh:logging-exempt (diagnostic: stdout is the verdict)
/** smoke.mjs — run ONE transpiled spec through the quickjs-shaped harness
 * under Node (both hosts share the pipeline; this isolates harness bugs
 * from runtime gaps). usage: node smoke.mjs <spec.mjs> */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { symlinkSync } from 'node:fs';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';

const ROOT = pathResolve(new URL('../..', import.meta.url).pathname);
register('./smoke-hooks.mjs', import.meta.url);

// The runtime-module seam, Node side (the hook half lives in smoke-hooks.mjs
// — see its header). Installed HERE, on the main thread: register()'s
// bootstrap runs only in the loader worker, so a global set there is never
// seen by the spec code. Same replay semantics as the host C seam: a second
// define for a name replaces the source.
const REG_DIR = pathResolve(ROOT, 'test/upstream-suite/.runtime-modules');
mkdirSync(REG_DIR, { recursive: true });
globalThis.__dshModuleDefine = (name, source) => {
  writeFileSync(pathResolve(REG_DIR, encodeURIComponent(name) + '.mjs'), source);
};

// Execute the shim tables so their __dshModuleDefine rows land as
// registration files BEFORE the spec loads: the qjs boot imports
// runtime-modules.js and the bridges family for exactly this, and the node
// harness imports nothing that would run them — without it the
// cordis-plugin-loader rows (npm-bridges-c's subclass with a working
// `internal.import`) never register and the specs resolve the RAW vendored
// lib, whose no-internals path leaves loader.internal undefined (measured:
// the preset mount/inventory rows, 2026-10-21).
await import(pathToFileURL(pathResolve(ROOT, 'runtime/dsh/upstream/shims/runtime-modules.js')));
await import(pathToFileURL(pathResolve(ROOT, 'runtime/dsh/upstream/shims/npm-bridges-c.js')));

const unhandled = [];
process.on('unhandledRejection', (reason) => {
  unhandled.push(String(reason?.message ?? reason).slice(0, 200));
});
const spec = process.argv[2];
if (typeof spec !== 'string') {
  console.error('usage: smoke.mjs <spec path under runtime/dsh/upstream-tests/>');
  process.exit(2);
}

// The per-process work root: the fixture seeding and the cwd-relative reads
// need the qjs leg's one-runtime-per-spec isolation, and concurrent smoke
// processes share one disk — so every run gets its own
// `.seam-run/<pid>/runtime/dsh` (cwd-relative reads resolve there, the pwd
// still ends in /runtime/dsh for the tsx discovery, and the whole root is
// removed after the run). gitignored via the upstream-tests row.
const WORK = pathResolve(ROOT, 'runtime/dsh/upstream-tests/.seam-run', String(process.pid));
const WORK_RUNTIME_DSH = join(WORK, 'runtime/dsh');
mkdirSync(WORK_RUNTIME_DSH, { recursive: true });
// The tsx-face discovery reads <repo>/test/upstream-suite/node_modules/tsx
// off its pwd-derived repo root — link the real one into the work root.
mkdirSync(join(WORK, 'test/upstream-suite'), { recursive: true });
const nmTarget = pathResolve(ROOT, 'test/upstream-suite/node_modules');
const nmLink = join(WORK, 'test/upstream-suite/node_modules');
try {
  symlinkSync(nmTarget, nmLink, 'dir');
} catch (error) {
  if (error?.code !== 'EEXIST') throw error;
}
process.chdir(WORK_RUNTIME_DSH);

// Fixture seeding — the NODE leg's half of the qjs driver's
// seedSpecFixtures: VFS-absolute fixture paths ('/upstream-tests/…',
// '/assets/…') map one way onto the work root, runtime/dsh/<path>.
const { seedSpecFixtures } = await import(pathToFileURL(pathResolve(ROOT, 'test/upstream-suite/seed-fixtures.mjs')).href);
await seedSpecFixtures(pathResolve(ROOT, 'runtime/dsh/upstream-tests', spec), WORK_RUNTIME_DSH);

// The staged spec runs from its WORK copy: import.meta.url then sits inside
// the work root, so the spec's import-relative fixture reads land on the
// seeded bytes (the qjs model — one runtime is one spec copy plus its
// fixtures). The hook (registered on this process) still serves every
// vendored specifier from the real closure.
const specSrc = pathResolve(ROOT, 'runtime/dsh/upstream-tests', spec);
const specCopy = join(WORK_RUNTIME_DSH, 'upstream-tests', spec);
mkdirSync(dirname(specCopy), { recursive: true });
copyFileSync(specSrc, specCopy);

// The web faces: the vendored closure expects the DOM faces the qjs host
// presents, and the harness and the product boot must agree on the same
// prototypes (the web-event.js instanceof gate dies on Node's native Event
// otherwise — the #641 source-chooser row). Node ships native Event family
// members, so the only-when-absent installers would keep the natives; the
// harness explicitly presents the SHIM classes, exactly what the qjs leg
// serves. Storage has no Node native counterpart, so its installer is the
// plain face.
const shim = (f) => import(pathToFileURL(pathResolve(ROOT, 'runtime/dsh/upstream/shims', f)).href);
const webEvent = await shim('web-event.js');
for (const k of ['Event', 'EventTarget', 'CustomEvent', 'MessageEvent', 'ErrorEvent', 'CloseEvent']) {
  globalThis[k] = webEvent[k];
}
const webStorage = await shim('web-storage.js');
webStorage.installWebStorage();

// The tsx-face host intrinsics: after the #626/#647 passthrough the REAL
// child_process namespace is the honest node-side face (the parity
// precedent — fs-readdir.js reads it first, shim fallback), and the
// profile tmp is a scratch dir inside THIS run's work root.
globalThis.__dshChildProcessNs = await import('node:child_process');
globalThis.__dshProfileTmpdir = join(WORK_RUNTIME_DSH, 'upstream-tests/.tmp');
mkdirSync(globalThis.__dshProfileTmpdir, { recursive: true });

const { runCollected } = await import(pathToFileURL(pathResolve(ROOT, 'runtime/dsh/scenario/upstream-test-harness.js')));
try {
  await import(pathToFileURL(specCopy));
} catch (error) {
  console.log('harness smoke: MODULE-LEVEL FAILURE |', String(error?.message ?? error).slice(0, 300));
  console.log('  at', String(error?.stack ?? '').split('\n')[1]?.trim()?.slice(0, 160));
  process.exit(1);
}
const report = await runCollected(() => {});
console.log('harness smoke:', JSON.stringify({ passed: report.passed, failed: report.failed, skipped: report.skipped, unhandled: unhandled.length }));
for (const u of unhandled.slice(0, 3)) console.log('  UNHANDLED:', u);
for (const failure of report.failures.slice(0, 5)) {
  console.log(`  FAIL ${failure.name} | ${String(failure.message).slice(0, 160)}`);
  if (failure.stack) console.log(`    ${failure.stack.slice(0, 300)}`);
}
// Remove THIS run's whole work root: concurrent smoke processes each get
// their own `.seam-run/<pid>` namespace, so nothing can race a sibling's
// fixtures, and nothing leaks into the next spec's environment. Best-effort.
const { rmSync } = await import('node:fs');
try {
  rmSync(WORK, { recursive: true, force: true });
} catch { /* the next run recreates and re-seeds it */ }
process.exit(report.failed > 0 ? 1 : 0);
