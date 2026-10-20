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
  if (specifier === '@deepseek-ai/dsh-subprocess-local/index') {
    return pathResolve(
      ROOT,
      'external/npm/@deepseek-ai/dsh-subprocess-local@0.1.6-alpha.2/lib/index.js',
    );
  }
  return null;
};

export async function resolve(specifier, context, nextResolve) {
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
  return nextResolve(specifier, context);
}
