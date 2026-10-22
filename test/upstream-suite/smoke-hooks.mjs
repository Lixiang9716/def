// dsh:logging-exempt (loader plumbing)
/** smoke-hooks.mjs — redirect the bundle-root-relative harness specifier
 * (the shape the quickjs host loader serves) to the real file under Node. */
import { pathToFileURL } from 'node:url';
import { resolve as pathResolve } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = pathResolve(new URL('../..', import.meta.url).pathname);
const BUNDLE_SCENARIO = {
  'scenario/upstream-test-harness.js': 'runtime/dsh/scenario/upstream-test-harness.js',
  'scenario/upstream-fake-timers.js': 'runtime/dsh/scenario/upstream-fake-timers.js',
};

// The runtime-module seam, Node side. shims/runtime-modules.js (and the
// npm-bridges family) register sources through globalThis.__dshModuleDefine
// — a HOST C seam under quickjs, absent under plain Node, so any spec whose
// graph imports it died with "this host does not expose the runtime module
// seam" (the loop spec: office tools, 2026-09-29). The INSTALL lives in
// smoke.mjs (this file's top level runs only in the loader worker, where
// globals the spec code sees cannot be set); this side only SERVES the
// registrations: sources land as files under .runtime-modules/ (gitignore
// the dir) and the resolve hook looks them up by encoded name — the
// filesystem is the one channel that crosses Node's hook-worker boundary.
// Registrations are deterministic per tree state and re-written at harness
// import each run, so cross-run staleness is bounded to removed rows.
const REG_DIR = pathResolve(ROOT, 'test/upstream-suite/.runtime-modules');
const regFile = (name) => pathResolve(REG_DIR, encodeURIComponent(name) + '.mjs');

/** The dedicated single-URL rows: util-crypto's loader row
 * (dsh_runtime_host.c DSH_PKG_CRYPTO) and the transpiler's chunk-carrier
 * subpath (bare dsh-subprocess-local rewritten to '/index' so the quickjs
 * loader's module NAME carries the package directory — Node's own resolver
 * refuses that shape, the npm exports map defines no './index', which is
 * what killed the differential leg at module load for every family driving
 * the subprocess-local face). Each returns a file URL or undefined. Kept
 * out of resolve() to hold it under the code-size cap. */
const serveSpecialRows = (specifier) => {
  if (specifier === 'dsh:util-crypto') {
    return pathResolve(
      ROOT, 'external/dsh/util-crypto@0.1.6-alpha.2/lib/index.js');
  }
  // The farm's @deepseek-ai/dsh-session-persistence row still serves the
  // errors-only parity shim (.parity-shim-session-persistence) whose own
  // header says to retire the mapping once the real package is vendored —
  // it has been (external/dsh/session-persistence). The stale row served a
  // DIFFERENT SessionPersistenceNotFoundError class than the vendored
  // graph's, so agent-loop's `instanceof` gate missed and the config-driven
  // exact-id restore died contained instead of falling through to create().
  if (specifier === '@deepseek-ai/dsh-session-persistence') {
    return pathResolve(
      ROOT, 'external/dsh/session-persistence@0.1.6-alpha.2/lib/index.js');
  }
  if (specifier === '@deepseek-ai/dsh-subprocess-local/index') {
    return pathResolve(
      ROOT,
      'external/npm/@deepseek-ai/dsh-subprocess-local@0.1.6-alpha.2/lib/index.js',
    );
  }
  // The skill-office spec's spec/lib split: the vendored service's default
  // asset root is `new URL('../assets/', import.meta.url)` — ITS OWN vendored
  // dir — while the spec asserts the seeded fixture tree beside the spec
  // copy. The qjs leg bridges the split by re-rooting fileURLToPath for
  // exactly this vendor subtree; the node leg restores the upstream
  // ADJACENCY instead: serve the lib from a verbatim copy inside the work
  // root (staged by smoke.mjs next to the seeded assets), so '../assets/'
  // lands on the fixture tree.
  if (specifier === '@deepseek-ai/dsh-skill-office') {
    return pathResolve(
      ROOT,
      `runtime/dsh/upstream-tests/.seam-run/${process.pid}/runtime/dsh/lib/dsh-skill-office.js`,
    );
  }
  // The subprocess control fixture's spawned child imports the package's
  // monorepo SOURCE ('…/subprocess/src/control.ts'); the npm tarball ships
  // lib/ only, so serve the vendored lib for that shape (the same
  // source-face equivalence the qjs loader's bare map applies).
  if (/(^|\/)subprocess\/src\/control\.ts$/.test(specifier)) {
    return pathResolve(
      ROOT,
      'external/npm/@deepseek-ai/dsh-subprocess-local@0.1.6-alpha.2/lib/index.js',
    );
  }
  return null;
};

/** Node builtins the harness must NOT shadow: the qjs host's runtime-modules
 * table registers the node:* faces unconditionally (shims that answer the
 * qjs hosts' honest limited/unavailable postures — ERR_DSH_NO_SEAM for
 * child_process, stub faces for vm/tls/net…), and the registration lookup
 * below would serve those shims on the Node leg too, where Node ships every
 * one of them for real. Tier 1 (#626) passthrough'd node:child_process;
 * Tier 2 (plan §3.3) extends the set to ALL eleven node:* rows
 * runtime-modules.js registers — on the Node reference leg, the real
 * builtins are strictly more capable than the shims, so the differential
 * measures the qjs shims' actual gaps (expected shape: qjs-red /
 * node-green). This hook only runs on the Node leg, so the qjs leg and
 * every host shim stay untouched. */
const NODE_BUILTIN_PASSTHROUGH = new Set([
  'node:child_process',
  'node:dns/promises',
  'node:http',
  'node:inspector',
  'node:net',
  'node:readline',
  'node:string_decoder',
  'node:stream/promises',
  'node:tls',
  'node:url',
  'node:vm',
]);

export async function resolve(specifier, context, nextResolve) {
  // The passthrough set MUST be checked before the registry lookup — the
  // registration file for node:child_process exists on every run and would
  // otherwise win (#626).
  if (NODE_BUILTIN_PASSTHROUGH.has(specifier)) {
    return { url: specifier, shortCircuit: true };
  }
  // Runtime-module registrations (see __dshModuleDefine above) win first —
  // the C seam is checked before the bare map on the quickjs side too.
  const registered = regFile(specifier);
  if (existsSync(registered)) {
    return { url: pathToFileURL(registered).href, shortCircuit: true };
  }
  if (BUNDLE_SCENARIO[specifier] !== undefined) {
    return { url: pathToFileURL(pathResolve(ROOT, BUNDLE_SCENARIO[specifier])).href, shortCircuit: true };
  }
  // Bundle-root ABSOLUTE specifiers (the shape the npm-bridges rows and
  // the quickjs host's static bare map both speak): '/x' is the runtime/
  // dsh bundle's own root, not the machine's. Without this the Node
  // reference leg dies on the first spec whose boot graph pulls a bridge
  // target (the loop spec: office tools → fflate — 2026-09-29).
  if (specifier.startsWith('/')) {
    return {
      url: pathToFileURL(pathResolve(ROOT, 'runtime/dsh', specifier.slice(1))).href,
      shortCircuit: true,
    };
  }
  // Bundle-root RELATIVE specifiers — the legacy shapes the quickjs loader
  // serves from the bundle root ('upstream/boot.js', 'scenario/x.js',
  // 'system-plugins/**', 'vendor/**', and bare root files like 'logger.js'
  // / 'gateway.js'). Node reads them as package names; map the namespaces
  // the bundle actually owns. Bare npm names ('fflate', 'zustand/shallow',
  // 'node:*') match nothing here and fall through.
  const bundleNs = /^(upstream|scenario|system-plugins|vendor)\//.test(specifier)
    || /^(logger|gateway|registry|sha256|manifest)\.js$/.test(specifier);
  if (bundleNs) {
    return {
      url: pathToFileURL(pathResolve(ROOT, 'runtime/dsh', specifier)).href,
      shortCircuit: true,
    };
  }
  const special = serveSpecialRows(specifier);
  if (special !== null) {
    return { url: pathToFileURL(special).href, shortCircuit: true };
  }
  // Spec-side bare dsh imports must share ONE physical copy with the
  // vendored graph: the spec copy lives under .seam-run/<pid>/, whose
  // ancestor walk lands on runtime/dsh/node_modules — the RUNTIME VENDOR
  // face — while the vendored packages resolve their siblings through
  // external/node_modules (the farm) — two module instances of one logical
  // package, and every cross-module instanceof gate between the spec and
  // the vendored code fails (compaction's ManualCompactionError, goal's
  // GoalError — 2026-10-22). Re-anchor ONLY the enumerated names: the
  // blanket form hijacked tool-web, whose spec-side import MUST keep the
  // runtime-vendor face (the host-integrated dsh-web the suite exercises —
  // the raw npm face fails 3 turndown rows). Each name here carries a
  // proven two-face split; new names join with their row's evidence.
  const FARM_ANCHORED_DSH = new Set([
    '@deepseek-ai/dsh-compaction',
    '@deepseek-ai/dsh-compaction-basic',
    '@deepseek-ai/dsh-command-compact',
    '@deepseek-ai/dsh-goal',
    '@deepseek-ai/dsh-command-goal',
  ]);
  if (FARM_ANCHORED_DSH.has(specifier) && context.parentURL?.includes('/.seam-run/')) {
    try {
      return await nextResolve(specifier, {
        ...context,
        parentURL: pathToFileURL(pathResolve(ROOT, 'external/node_modules/_pin.js')).href,
      });
    } catch { /* not farm-served; fall through */ }
  }
  return nextResolve(specifier, context);
}
