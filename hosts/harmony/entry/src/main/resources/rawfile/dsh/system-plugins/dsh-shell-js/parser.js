/**
 * parser.js — the command-line parser route (DECISION §1) and the plugin's
 * CJS vendor seam for shelljs (DECISION §5 rule 4).
 *
 * ## The parser
 *
 * Since 2026-10-11 the command-line parser is HAND-WRITTEN — a recursive-
 * descent bash-subset parser in parser-syntax.js (split out for the
 * code-size gate's file budgets, the same move exec.js made out of
 * index.js). It replaces the vendored `bash-parser@0.5.0` (unmaintained
 * since 2017, exact-pin forever; its 230KB babylon dependency rode the
 * closure unconditionally for a `$((…))` form the executor refuses anyway
 * — the accepted costs on record in DECISION §1 no longer buy anything).
 * This module only re-exports the two parse faces (`parseCommandLine`,
 * `ShellParseError`), so the executor's import (exec.js) is unchanged; the
 * dialect, the by-name refusals and the AST contract are documented at the
 * top of parser-syntax.js.
 *
 * ## The vendor seam
 *
 * All third-party code here is CommonJS, so the plugin owns a small CJS
 * loader — per-file scopes, node's resolution algorithm (relative requests,
 * package.json `main`, index fallback), cycle-visible partial exports — the
 * same design as the runtime's `upstream/shims/cjs-loader.js`, but
 * plugin-local so no shared loader file is touched. The formal
 * `add-package.sh` round moved the closure into the repo's FLAT
 * `vendor/npm/<name>@<ver>` layout: the name→tree map below resolves every
 * bare name directly, and the old nested-`node_modules` walk-up branch is
 * retired — a bare name outside the map is a loud resolution error, never a
 * silent miss.
 *
 * File reads: module text only, never user data — on device through the
 * host's bundle-read seam (`__dshBundleRequire`, the same mechanism the
 * runtime's own CJS loader uses), under Node through `node:fs` relative to
 * this module. Both legs are synchronous (a host binding and readFileSync)
 * because `require()` inside vendored code is sync; the async bootstrap
 * (`ensureVendorReader`) is what installs the Node leg, so the first
 * shelljs load must follow an `await` of it — enforced loud below. User
 * files flow exclusively through the gateway primitives (applets.js's
 * adapter); the two paths never mix.
 */

import { createLogger } from 'logger.js';

const log = createLogger('dsh.shell.js.parser');

export { parseCommandLine, ShellParseError } from './parser-syntax.js';

// ---------------------------------------------------------------------------
// The process presence guard (DECISION §1.3) — MUST run before shelljs
// loads. shelljs reads `process.versions.electron` and `process.execPath`
// at link time (src/common.js:19,37) and `process.env.OLDPWD` in its cd
// body, and QuickJS has no `process` binding at all. Presence is all that
// matters (common.js only probes truthiness), so an idempotent,
// never-overwriting install is the whole mitigation. Environmental,
// deliberately NOT a source patch (D6).
//
// It lives in readTextSync (the vendor-read chokepoint), NOT at module load:
// since dsh-shell-js took the shell seat (2026-10-11) this module evaluates
// during the BOOT's static import graph — before the web-shims prelude
// installs the real process global — and a module-load install (even a
// whole-object `??=`) would preempt that fuller face: the first
// `process.cwd()` afterwards (the fs-local Config class field) died with
// "not a function" (measured live, settings-surfaces leg). The web-shims
// prelude's install is itself never-overwriting, so the guard's install
// must also be FIELD-level, filling absent fields only.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The vendor seam (shelljs + minimatch only now)
// ---------------------------------------------------------------------------

/** This module's directory: specifier-space on device ('system-plugins/
 * dsh-shell-js'), a real path under Node. `import.meta.dirname` is served
 * by the host loader exactly for this shape (dsh_runtime_host.c); the URL
 * fallback covers module transforms that omit it (vite-node under the
 * Node test harness). */
const MODULE_DIR = (import.meta.dirname
  ?? new URL('.', import.meta.url).pathname.replace(/\/+$/, ''));

/** Lexically fold '.'/'..' segments without I/O; null escapes the root. */
const lexicalResolve = (fromDir, request) => {
  log.debug('lexical resolve', { fromDir, request });
  const segs = fromDir === '' ? [] : fromDir.split('/');
  for (const seg of request.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (segs.length === 0) return null;
      segs.pop();
    } else {
      segs.push(seg);
    }
  }
  return segs.join('/');
};

/** The repo's vendor root — the formal vendored closure (runtime/dsh/vendor/
 * pinned by NPM_PACKAGES in runtime/dsh/vendor/ensure-dsh.sh). In bundle
 * space this is 'vendor/' — the TREES staging root mounts
 * system-plugins/<plugin> BESIDE vendor/npm/…, so two '..' hops from this
 * plugin dir land on it; under Node the same hops land on the real
 * runtime/dsh/vendor directory. A resolution that escapes the root is
 * refused loud, not silently redirected. */
const VENDOR_ROOT = lexicalResolve(MODULE_DIR, '../../vendor');
const VENDOR_PREFIX = `${VENDOR_ROOT}/`;

/**
 * The vendor map: shelljs 0.10.0 (the applet bodies, pristine behind
 * outboard seams) and its minimatch 10.0.3 glob chain (the matcher for the
 * executor's glob route, §3). Each a pinned `vendor/npm/<name>@<ver>` tree
 * (tarball sha256 pins live in NPM_PACKAGES, runtime/dsh/vendor/
 * ensure-dsh.sh). The trees are FLAT (no nested node_modules), so a bare
 * name outside this map is a loud resolution error, never a walk-up hit.
 * The 29-tree bash-parser parser closure left with the 2026-10-11
 * hand-written-parser swap. `fast-glob`, `child_process` and `execa` are
 * deliberately absent — they are provided by applets.js (the minimatch
 * -based glob provider and the no-subprocess refusals); `fs`, `path`, `os`
 * and `util` likewise ride providers.
 */
const VENDOR_TREES = {
  shelljs: 'npm/shelljs@0.10.0',
  minimatch: 'npm/minimatch@10.0.3',
  '@isaacs/brace-expansion': 'npm/@isaacs/brace-expansion@5.0.1',
  '@isaacs/balanced-match': 'npm/@isaacs/balanced-match@4.0.1',
};

/** Builtin/module providers (applets.js registers `fs`, `path`, `os`,
 * `util`, `child_process`, `execa`, `fast-glob` before requiring shelljs).
 * Precedence: providers win over the vendor map, exactly like node builtins
 * win over packages. */
const providers = new Map();

/** Register one builtin provider for vendored code's `require(name)`. */
export const provideBuiltin = (name, exportsObject) => {
  log.debug('builtin provided', { name });
  providers.set(name, exportsObject);
};

// The two sync read legs. The device seam exists from the start; the Node
// leg is installed by ensureVendorReader(). Until one is ready, reads fail
// loud (an un-awaited bootstrap must never surface as a silent miss).
const bundleSeam = () => globalThis.__dshBundleRequire;
let nodeReadText = null;

const readTextSync = (spec) => {
  log.debug('read text', { spec });
  // The process presence guard (block comment above): field-level so a
  // fuller host-installed process keeps every face it has.
  const proc = (globalThis.process ??= {});
  proc.env ??= {};
  proc.versions ??= {};
  proc.execPath ??= '';
  const seam = bundleSeam();
  if (typeof seam === 'function') {
    const cut = spec.lastIndexOf('/');
    return seam(`${spec.slice(0, cut)}/__dsh_cjs_anchor__`, `./${spec.slice(cut + 1)}`);
  }
  if (nodeReadText !== null) return nodeReadText(spec);
  throw new Error(`dsh-shell-js vendor seam: no reader installed for '${spec}'`
    + ' (ensureVendorReader() must be awaited first)');
};

const textCache = new Map();
const readTextMemoized = (spec) => {
  const hit = textCache.get(spec);
  if (hit !== undefined) return hit;
  log.debug('text cache miss', { spec });
  const text = readTextSync(spec);
  textCache.set(spec, text);
  return text;
};

/** "Readable as module text" — the one existence probe both legs agree on
 * (a directory read throws on the seam leg AND as EISDIR under Node, so
 * this is a FILE probe, never a path probe). */
const existsCache = new Map();
const existsInTree = (spec) => {
  const hit = existsCache.get(spec);
  if (hit !== undefined) return hit;
  log.debug('exists probe', { spec });
  let exists;
  try { readTextMemoized(spec); exists = true; } catch { exists = false; }
  existsCache.set(spec, exists);
  return exists;
};

/** Install the Node read leg (the panel suite / desktop host shape).
 * Memoized; a no-op on device, where the bundle seam is already present. */
let bootPromise = null;
export const ensureVendorReader = () => {
  if (typeof bundleSeam() === 'function') return Promise.resolve();
  if (bootPromise !== null) return bootPromise;
  bootPromise = (async () => {
    log.debug('vendor seam booting under Node', {});
    const { readFileSync } = await import('node:fs');
    const { pathToFileURL } = await import('node:url');
    nodeReadText = (spec) => readFileSync(pathToFileURL(spec), 'utf8');
  })();
  return bootPromise;
};

const dirOf = (p) => {
  log.debug('dir of', { p });
  const cut = p.lastIndexOf('/');
  return cut > 0 ? p.slice(0, cut) : '';
};

/** Does the spec name a directory? A vendored package dir always carries
 * package.json or index.js — probing both is exact for these trees and
 * needs no second host seam. */
const dirExists = (spec) => existsInTree(`${spec}/package.json`)
  || existsInTree(`${spec}/index.js`);

/** Resolve a package directory to its entry file (package.json "main", then
 * the index faces); null when nothing serves it. The trees are pristine, so
 * the entry point is upstream's own manifest, never a guess. */
const resolvePackageEntry = (dir) => {
  log.debug('resolve package entry', { dir });
  if (existsInTree(dir)) return dir; // exact file hit
  for (const ext of ['.js', '.cjs', '.json']) {
    if (existsInTree(dir + ext)) return dir + ext;
  }
  if (!dirExists(dir)) return null;
  let main = 'index.js';
  if (existsInTree(`${dir}/package.json`)) {
    try { main = JSON.parse(readTextMemoized(`${dir}/package.json`)).main || main; } catch { /* keep default */ }
  }
  const entry = main.startsWith('./') ? main.slice(2) : main;
  const resolved = lexicalResolve(dir, entry) ?? entry;
  if (existsInTree(resolved)) return resolved;
  for (const ext of ['.js', '.cjs', '.json']) {
    if (existsInTree(resolved + ext)) return resolved + ext;
  }
  if (dirExists(resolved)) return resolvePackageEntry(resolved);
  return null;
};

/** module cache — path → { exports } (set BEFORE evaluation so require
 * cycles observe node's partial-exports semantics). */
const cache = new Map();

/** The `require` handed to vendored files: providers first, then the vendor
 * map. The closure layout is flat (no nested node_modules anywhere under
 * the vendor root), so there is no walk-up: a bare name outside the map
 * fails loud right here — that failure is the seam telling us a pin row is
 * missing, exactly the signal it should be. */
const makeRequire = (fromFile) => (request) => {
  log.debug('vendor require', { request, from: fromFile });
  if (providers.has(request)) return providers.get(request);

  let resolved = null;
  if (request.startsWith('./') || request.startsWith('../')) {
    const folded = lexicalResolve(dirOf(fromFile), request);
    resolved = folded === null ? null : resolvePackageEntry(folded);
  } else if (Object.prototype.hasOwnProperty.call(VENDOR_TREES, request)) {
    resolved = resolvePackageEntry(VENDOR_PREFIX + VENDOR_TREES[request]);
  }

  if (resolved === null) {
    throw new Error(`dsh-shell-js vendor seam: cannot resolve '${request}' from ${fromFile}`
      + ` (providers: ${[...providers.keys()].join(', ') || 'none'};`
      + ` vendored: ${Object.keys(VENDOR_TREES).join(', ')})`);
  }
  if (!resolved.startsWith(VENDOR_PREFIX)) {
    throw new Error(`dsh-shell-js vendor seam: '${request}' resolved outside vendor/ (${resolved})`);
  }
  return loadModule(resolved);
};

/** Evaluate one CJS module at `spec` (a file inside vendor/). */
const loadModule = (spec) => {
  const hit = cache.get(spec);
  if (hit !== undefined) return hit.exports;
  log.debug('vendor module load', { spec });
  const source = readTextMemoized(spec);
  const module = { exports: {} };
  cache.set(spec, module); // partial exports visible during eval (node cycles)
  if (spec.endsWith('.json')) {
    module.exports = JSON.parse(source);
    return module.exports;
  }
  // node's CJS wrapper, sloppy mode (CJS sources are non-strict by default;
  // `this` at their top level is module.exports).
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', source);
  fn.call(module.exports, module.exports, makeRequire(spec), module, spec, dirOf(spec));
  return module.exports;
};

/** Require one vendored package by its mapped name (the plugin's entry
 * points into third-party code). */
export const vendorRequire = (name) => {
  log.debug('vendor require', { name });
  if (!Object.prototype.hasOwnProperty.call(VENDOR_TREES, name)) {
    throw new Error(`dsh-shell-js vendor seam: '${name}' is not a vendored name `
      + `(vendored: ${Object.keys(VENDOR_TREES).join(', ')})`);
  }
  return makeRequire('')(name);
};
