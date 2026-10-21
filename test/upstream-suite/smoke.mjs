#!/usr/bin/env node
// dsh:logging-exempt (diagnostic: stdout is the verdict)
/** smoke.mjs — run ONE transpiled spec through the quickjs-shaped harness
 * under Node (both hosts share the pipeline; this isolates harness bugs
 * from runtime gaps). usage: node smoke.mjs <spec.mjs> */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve as pathResolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

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

const unhandled = [];
process.on('unhandledRejection', (reason) => {
  unhandled.push(String(reason?.message ?? reason).slice(0, 200));
});
const spec = process.argv[2];
if (typeof spec !== 'string') {
  console.error('usage: smoke.mjs <spec path under runtime/dsh/upstream-tests/>');
  process.exit(2);
}

// The qjs leg's driver runs the suite with runtime/dsh as the working
// directory (upstream-suite-leg.js pins the profile container there); the
// tsx-face discovery in source-bootstrap-tsx.js keys on the same cwd. Match
// it before anything resolves.
process.chdir(pathResolve(ROOT, 'runtime/dsh'));

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
// profile tmp is a scratch dir under the staged tree.
globalThis.__dshChildProcessNs = await import('node:child_process');
globalThis.__dshProfileTmpdir = pathResolve(ROOT, 'runtime/dsh/upstream-tests/.tmp');
mkdirSync(globalThis.__dshProfileTmpdir, { recursive: true });

const { runCollected } = await import(pathToFileURL(pathResolve(ROOT, 'runtime/dsh/scenario/upstream-test-harness.js')));
try {
  await import(pathToFileURL(pathResolve(ROOT, 'runtime/dsh/upstream-tests', spec)));
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
process.exit(report.failed > 0 ? 1 : 0);
