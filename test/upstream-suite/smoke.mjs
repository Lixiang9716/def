#!/usr/bin/env node
// dsh:logging-exempt (diagnostic: stdout is the verdict)
/** smoke.mjs — run ONE transpiled spec through the quickjs-shaped harness
 * under Node (both hosts share the pipeline; this isolates harness bugs
 * from runtime gaps). usage: node smoke.mjs <spec.mjs> */
import { register, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { basename, dirname, join, resolve as pathResolve } from 'node:path';
import { symlinkSync } from 'node:fs';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';

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

// The CJS require seam (SYNC hooks intercept require; the async register()
// below never sees it): vendored packages' `createLazyRequire('sharp',
// import.meta.url)` must reach the D-c pure-JS sharp face (the closure
// ships the @img binaries for LINUX only — on darwin-arm64 real sharp
// throws at load and the durable-image pipeline dies, the computer-use
// composition row), and the sharp shim's own internals require
// '/vendor/npm/...' bundle-root shapes the ESM hook already maps.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'sharp') {
      return { url: pathToFileURL(pathResolve(ROOT, 'runtime/dsh/upstream/shims/sharp/index.js')).href, shortCircuit: true };
    }
    if (specifier.startsWith('/vendor/')) {
      return {
        url: pathToFileURL(pathResolve(ROOT, 'runtime/dsh', specifier.slice(1))).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

// Execute the shim tables so their __dshModuleDefine rows land as
// registration files BEFORE the spec loads: the qjs boot imports
// runtime-modules.js and the bridges family for exactly this, and the node
// harness imports nothing that would run them — without it the
// cordis-plugin-loader rows (npm-bridges-c's subclass with a working
// `internal.import`) never register and the specs resolve the RAW vendored
// lib, whose no-internals path leaves loader.internal undefined (measured:
// the preset mount/inventory rows, 2026-10-21).
//
// The bridges parent (npm-bridges.js) cannot simply be imported here — its
// pi-ai fragment reads the host-C `__dshBundleRequire` seam at module load,
// which plain Node does not carry — and the C fragment's OTHER rows must not
// register on this leg at all: they are qjs-side substitutes for real
// packages (the undici/http/child_process faces), and the Tier-2 discipline
// makes the REAL packages the reference here. So the fragment is imported
// for its side effects and enumerated, and exactly ONE row is taken: the
// loader subclass — the vendored dsh packages import the loader bare, and
// without it every Loader is raw (internal.import undefined), which loses
// the loader tree-base semantics the preset mount/inventory rows exercise.
await import(pathToFileURL(pathResolve(ROOT, 'runtime/dsh/upstream/shims/runtime-modules.js')));
const { BRIDGES_C } = await import(pathToFileURL(pathResolve(ROOT, 'runtime/dsh/upstream/shims/npm-bridges-c.js')));
const { BRIDGES_B } = await import(pathToFileURL(pathResolve(ROOT, 'runtime/dsh/upstream/shims/npm-bridges-b.js')));
// openai / @anthropic-ai/sdk / partial-json: NO real package exists anywhere
// in the closure (the heavy SDKs were deliberately never fetched), so pi-ai's
// lazy API graph cannot load without their bridge faces — the adapters
// convert the load failure into an error finish chunk and the rows see empty
// streams. These are the cordis-plugin-loader class: registered because the
// real thing does not exist, not instead of it.
// cross-spawn deliberately NOT here: a REAL cross-spawn is vendored and
// farm-linked, and the mcp-stdio spawn family (lsp lifecycle, tool-goal,
// webhook...) needs its arg-escaping semantics — the registration would
// hijack it with the raw node spawn (measured: lsp lifecycle node 11/20).
// The qjs runtime takes the same-name bridge row from its own boot.
const HARNESS_BRIDGE_ROWS = new Set([
  '@deepseek-ai/cordis-plugin-loader',
  'openai',
  '@anthropic-ai/sdk',
  'partial-json',
]);
for (const [name, source] of [...BRIDGES_C, ...BRIDGES_B]) {
  if (HARNESS_BRIDGE_ROWS.has(name)) globalThis.__dshModuleDefine(name, source);
}

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
// The pty rows (terminal-activity) require node-pty from the SPEC COPY's
// ancestor chain, which never reaches external/node_modules — the vendored
// package is linked at the work root's runtime/dsh node_modules so the same
// pinned bytes the farm serves resolve there too.
const ptyDir = readdirSync(pathResolve(ROOT, 'external/npm')).find((e) => e.startsWith('node-pty@'));
if (ptyDir) {
  try {
    mkdirSync(join(WORK_RUNTIME_DSH, 'node_modules'), { recursive: true });
    symlinkSync(pathResolve(ROOT, 'external/npm', ptyDir), join(WORK_RUNTIME_DSH, 'node_modules/node-pty'), 'dir');
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
}
process.chdir(WORK_RUNTIME_DSH);

// Fixture seeding — the NODE leg's half of the qjs driver's
// seedSpecFixtures: VFS-absolute fixture paths ('/upstream-tests/…',
// '/assets/…') map one way onto the work root, runtime/dsh/<path>.
const { seedSpecFixtures } = await import(pathToFileURL(pathResolve(ROOT, 'test/upstream-suite/seed-fixtures.mjs')).href);
await seedSpecFixtures(pathResolve(ROOT, 'runtime/dsh/upstream-tests', spec), WORK_RUNTIME_DSH);

// Bundle-root support files the fixture path-math reaches OUTSIDE
// upstream-tests/: the qjs leg's staged fs falls through to the real bundle
// tree for these — the control spec's helper math resolves
// `../../subprocess/src/control.ts` against import.meta.url, and its fixture
// child then imports that file in a REAL spawned node — so the work root
// mirrors exactly those leaves. Same source-face equivalence the resolve
// hook's serveSpecialRows applies to the import face; enumerated (not a
// wholesale tree copy) so per-spec isolation stays strict.
// EACH leaf lands at BOTH work-root spellings: the qjs staged URL clamps at
// the bundle root (`<work>/runtime/dsh/<rel>`), while Node's URL math from
// the real spec copy resolves one level higher (`<work>/runtime/<rel>`) —
// the child must find the leaf wherever each leg's math lands (measured:
// the control child exits 1 on the missing helper, EPIPE on the parent's
// first write).
const SUPPORT_FALLTHROUGH = ['subprocess/src/control.ts'];
for (const rel of SUPPORT_FALLTHROUGH) {
  for (const base of [WORK_RUNTIME_DSH, join(WORK, 'runtime')]) {
    const dst = join(base, rel);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(pathResolve(ROOT, 'runtime/dsh', rel), dst);
  }
}

// The staged spec runs from its WORK copy: import.meta.url then sits inside
// the work root, so the spec's import-relative fixture reads land on the
// seeded bytes (the qjs model — one runtime is one spec copy plus its
// fixtures). The hook (registered on this process) still serves every
// vendored specifier from the real closure.
const specSrc = pathResolve(ROOT, 'runtime/dsh/upstream-tests', spec);
const specCopy = join(WORK_RUNTIME_DSH, 'upstream-tests', spec);
mkdirSync(dirname(specCopy), { recursive: true });
copyFileSync(specSrc, specCopy);
// Shared transpile-output siblings the specs reach by URL math beside the
// spec copy (worker.js — the persistence worker the worker_threads rows
// spawn via `new URL('./worker.js', import.meta.url)`): the qjs staged fs
// serves them from the staged tree, so the work root mirrors them too.
for (const sibling of ['worker.js']) {
  const src = pathResolve(ROOT, 'runtime/dsh/upstream-tests', sibling);
  if (existsSync(src)) copyFileSync(src, join(WORK_RUNTIME_DSH, 'upstream-tests', sibling));
}
// The transpiler inlines each SPEC but not the non-spec files its URL math
// names; the qjs staged fs serves them, so the work root stages the named
// leaves. Sources stay verbatim vendored bytes (D6) — this is placement,
// not a rewrite. Sourced from ROOT (this worktree), never from the primary
// checkout's absolute links.
const STAGED_SIBLINGS = [
  // sdk-client's fakeLaunch spawns node <specDir>/fake-runtime.ts.
  ['external/dsh-tests@dsh-v0.1.6-alpha.2/packages/sdk/client/tests/fake-runtime.ts', join(WORK_RUNTIME_DSH, 'upstream-tests')],
  // lsp-stdio's scriptable fake LSP server (connection/lifecycle/instance
  // spawn `node <specDir>/fixture-server.ts`).
  ['external/dsh-tests@dsh-v0.1.6-alpha.2/packages/lsp/lsp-stdio/tests/fixture-server.ts', join(WORK_RUNTIME_DSH, 'upstream-tests')],
  // acp bridge's fixture-server.ts lives at <work>/mcp/mcp-client/tests/ in
  // the flat layout; it imports @modelcontextprotocol/server + zod, which
  // resolve only through the farm — a node_modules link in that dir.
  ['external/dsh-tests@dsh-v0.1.6-alpha.2/packages/mcp/mcp-client/tests/fixture-server.ts', join(WORK, 'mcp/mcp-client/tests')],
  // the browser-use composition's MCP fixture (spawned by the mcp client
  // as `node mcp-fixture.mjs` beside the spec copy)
  ['external/dsh-tests@dsh-v0.1.6-alpha.2/packages/experimental/browser-use-runtime/tests/mcp-fixture.mjs', join(WORK_RUNTIME_DSH, 'upstream-tests')],
  // the webhook spec's source-introspection: `new URL('../src/brand.ts',
  // import.meta.url)` resolves at <work>/runtime/dsh/src/ — mirror the
  // package's whole src tree there (the qjs package-source staging
  // precedent; the webhook runtime spec reads its own production sources)
  ['external/dsh-tests@dsh-v0.1.6-alpha.2/packages/webhook/webhook/src', join(WORK_RUNTIME_DSH, 'src')],
];
for (const [src, dir] of STAGED_SIBLINGS) {
  const from = pathResolve(ROOT, src);
  if (!existsSync(from)) continue;
  mkdirSync(dir, { recursive: true });
  if (statSync(from).isDirectory()) {
    // A source tree (the webhook spec's source-introspection joins
    // ../src/*.ts beside the spec copy — the qjs leg's package-source
    // staging precedent): mirror the whole directory, verbatim.
    cpSync(from, dir, { recursive: true });
    continue;
  }
  copyFileSync(from, join(dir, basename(from)));
  if (dir.endsWith('mcp/mcp-client/tests')) {
    try {
      symlinkSync(pathResolve(ROOT, 'external/node_modules'), join(dir, 'node_modules'), 'dir');
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
}
// sdk-client's installedDshNodeLaunch reads ../package.json relative to the
// spec copy — upstream the sdk-client package manifest (version parity vs
// @deepseek-ai/dsh); the staged answer is the vendored package's own.
const sdkClientPkg = pathResolve(ROOT, 'external/npm/@deepseek-ai/dsh-sdk-client@0.1.6-alpha.2/package.json');
if (existsSync(sdkClientPkg)) copyFileSync(sdkClientPkg, join(WORK_RUNTIME_DSH, 'package.json'));
// skill-office adjacency: the vendored service's default asset root is its
// OWN ../assets/, while the spec asserts the seeded fixture tree beside the
// spec copy — the hook serves the lib from this verbatim work-root copy, so
// its '../assets/' lands on the seeded tree (smoke-hooks serveSpecialRows).
const skillOfficeLib = pathResolve(ROOT, 'external/npm/@deepseek-ai/dsh-skill-office@0.1.6-alpha.2/lib/index.js');
if (existsSync(skillOfficeLib)) {
  mkdirSync(join(WORK_RUNTIME_DSH, 'lib'), { recursive: true });
  copyFileSync(skillOfficeLib, join(WORK_RUNTIME_DSH, 'lib/dsh-skill-office.js'));
}

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

// The runtime presents the qjs value classes as globals (above) while fetch
// stays NATIVE (only-when-absent installers keep Node's) — and native fetch
// brand-checks its own FormData, so a shim-realm FormData body dies with a
// bare "fetch failed" and the Files-API upload falls back to the inline
// shape (the deepseek adapter rows, 2026-10-22). The adapter serializes the
// shim faces over the multipart encoder and delegates everything else.
const webFetchForms = await shim('web-fetch-forms.js');
const webMultipart = await shim('web-multipart.js');
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init = {}) => {
  const body = init?.body;
  if (body instanceof webFetchForms.FormData) {
    return webMultipart.encodeFormData(body).then(({ bytes, contentType }) => {
      const headers = new globalThis.Headers(init?.headers);
      headers.set('content-type', contentType);
      return nativeFetch(input, { ...init, body: Buffer.from(bytes), headers });
    });
  }
  if (body instanceof webFetchForms.Blob) {
    return nativeFetch(input, { ...init, body: Buffer.from(webFetchForms.blobState.get(body).bytes) });
  }
  return nativeFetch(input, init);
};

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
