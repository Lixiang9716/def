/**
 * parser.js — the command-line parser route (DECISION §1) and the plugin's
 * transitional CJS vendor seam (DECISION §5 rule 4).
 *
 * ## The parser
 *
 * `bash-parser@0.5.0`, vendored pristine in the repo's pinned vendor
 * closure (`runtime/dsh/vendor/npm/…`, materialized by ensure-dsh.sh) and
 * loaded through the seam below, with `{ mode: 'bash' }` (this is a
 * bash-subset shell; the spike found the mode identical to posix on the
 * whole dialect checklist).
 * The accepted costs are on record in DECISION §1: the parser is
 * unmaintained since 2017 (exact-pin forever), the 230KB babylon rides the
 * closure unconditionally even though `$((…))` is refused by the executor,
 * and grammar errors arrive as plain `Error` while only unclosed quotes are
 * `SyntaxError` — so `ShellParseError.syntax` classifies by that contract,
 * and the message text is the only fragile part (a re-pin can change it).
 *
 * Dialect corners beyond the audited checklist are NOT trusted: the executor
 * (index.js) evaluates an explicit node-type whitelist and refuses anything
 * else by name, so an unaudited grammar construct fails loud, never silently
 * wrong (DECISION §1.6).
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
 * (`ensureVendorReader`) is what installs the Node leg, so the first parse
 * or shelljs load must follow an `await` of it — enforced loud below. User
 * files flow exclusively through the gateway primitives (applets.js's
 * adapter); the two paths never mix.
 */

import { createLogger } from 'logger.js';

const log = createLogger('dsh.shell.js.parser');

// ---------------------------------------------------------------------------
// The process presence guard (DECISION §1.3) — MUST run before the first
// parse and before shelljs loads. bash-parser reads `process.env.NODE_NEV`
// on every parse and QuickJS has no `process` binding at all (verified by
// the spike: parse fails immediately without one); shelljs additionally
// reads `process.versions.electron` and `process.execPath` at link time and
// deletes `process.env.OLDPWD`. Presence is all that matters — the NODE_NEV
// typo means even Node never takes the branch the read guards — so an
// idempotent, never-overwriting install is the whole mitigation.
// Environmental, deliberately NOT a source patch (D6).
// ---------------------------------------------------------------------------
globalThis.process ??= { env: {}, versions: {}, execPath: '' };

/** bash-parser rethrows unclosed quotes as `SyntaxError`; every other
 * grammar failure arrives as a plain `Error` (its src/index.js catch-all).
 * The executor keeps "did not parse" strictly separate from "parsed but
 * unimplemented node type". */
export class ShellParseError extends Error {
  constructor(message, syntax) {
    super(message);
    this.name = 'ShellParseError';
    this.syntax = syntax === true;
  }
}

// ---------------------------------------------------------------------------
// The transitional vendor seam
// ---------------------------------------------------------------------------

/** This module's directory: specifier-space on device ('system-plugins/
 * dsh-shell-js'), a real path under Node. `import.meta.dirname` is served
 * by the host loader exactly for this shape (dsh_runtime_host.c); the URL
 * fallback covers module transforms that omit it (vite-node under the
 * Node test harness). */
const MODULE_DIR = (import.meta.dirname
  ?? new URL('.', import.meta.url).pathname.replace(/\/+$/, ''));

/** Lexically fold '.'/'..' segments without I/O; null escapes the root.
 * (Defined early: the vendor root below folds through it.) */
const lexicalResolve = (fromDir, request) => {
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
 * The vendor map (the formal add-package.sh round): every bare name the
 * vendored closure resolves — bash-parser 0.5.0's full 28-package
 * transitive closure (the spike's lockfile-pinned node_modules overlay,
 * flattened) plus shelljs and its minimatch glob chain — each a pinned
 * `vendor/npm/<name>@<ver>` tree (tarball sha256 pins live in
 * NPM_PACKAGES, runtime/dsh/vendor/ensure-dsh.sh: the tracked provenance
 * record this map superseded VENDOR.md for). The trees are FLAT (no nested
 * node_modules), so a bare name outside this map is a loud resolution
 * error, never a walk-up hit. `fast-glob`, `child_process` and `execa` are
 * deliberately absent — they are provided by applets.js (the minimatch
 * -based glob provider and the no-subprocess refusals); `fs`, `path`, `os`
 * and `util` likewise ride providers.
 */
const VENDOR_TREES = {
  'bash-parser': 'npm/bash-parser@0.5.0',
  shelljs: 'npm/shelljs@0.10.0',
  minimatch: 'npm/minimatch@10.0.3',
  '@isaacs/brace-expansion': 'npm/@isaacs/brace-expansion@5.0.1',
  '@isaacs/balanced-match': 'npm/@isaacs/balanced-match@4.0.1',
  'array-last': 'npm/array-last@1.3.0',
  babylon: 'npm/babylon@6.18.0',
  'compose-function': 'npm/compose-function@3.0.3',
  curry: 'npm/curry@1.2.0',
  'deep-freeze': 'npm/deep-freeze@0.0.1',
  'filter-iterator': 'npm/filter-iterator@0.0.1',
  'filter-obj': 'npm/filter-obj@1.1.0',
  'has-own-property': 'npm/has-own-property@0.1.0',
  'identity-function': 'npm/identity-function@1.0.0',
  'iterable-lookahead': 'npm/iterable-lookahead@1.0.0',
  'iterable-transform-replace': 'npm/iterable-transform-replace@1.2.0',
  'magic-string': 'npm/magic-string@0.16.0',
  'map-iterable': 'npm/map-iterable@1.0.1',
  'map-obj': 'npm/map-obj@2.0.0',
  'object-pairs': 'npm/object-pairs@0.1.0',
  'object-values': 'npm/object-values@1.0.0',
  'reverse-arguments': 'npm/reverse-arguments@1.0.0',
  'shell-quote-word': 'npm/shell-quote-word@1.0.1',
  'to-pascal-case': 'npm/to-pascal-case@1.0.0',
  'transform-spread-iterable': 'npm/transform-spread-iterable@1.4.1',
  'unescape-js': 'npm/unescape-js@1.1.4',
  'arity-n': 'npm/arity-n@1.0.4',
  'is-number': 'npm/is-number@4.0.0',
  vlq: 'npm/vlq@0.2.3',
  'is-iterable': 'npm/is-iterable@1.1.2',
  'to-space-case': 'npm/to-space-case@1.0.0',
  'to-no-case': 'npm/to-no-case@1.0.2',
  'string.fromcodepoint': 'npm/string.fromcodepoint@0.2.1',
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
  const cut = p.lastIndexOf('/');
  return cut > 0 ? p.slice(0, cut) : '';
};

/** Node's candidate spellings for one extensionless path. */
const candidatePaths = (candidate) => [
  candidate,
  `${candidate}.js`,
  `${candidate}.cjs`,
  `${candidate}.json`,
  `${candidate}/index.js`,
  `${candidate}/index.cjs`,
  `${candidate}/index.json`,
];

/** Does the spec name a directory? A vendored package dir always carries
 * package.json or index.js — probing both is exact for these trees and
 * needs no second host seam. */
const dirExists = (spec) => existsInTree(`${spec}/package.json`)
  || existsInTree(`${spec}/index.js`);

/** Resolve a package directory to its entry file (package.json "main", then
 * the index faces); null when nothing serves it. The trees are pristine, so
 * the entry point is upstream's own manifest, never a guess. */
const resolvePackageEntry = (dir) => {
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
  if (!Object.prototype.hasOwnProperty.call(VENDOR_TREES, name)) {
    throw new Error(`dsh-shell-js vendor seam: '${name}' is not a vendored name `
      + `(vendored: ${Object.keys(VENDOR_TREES).join(', ')})`);
  }
  return makeRequire('')(name);
};

// ---------------------------------------------------------------------------
// The parse face
// ---------------------------------------------------------------------------

/** bash-parser 0.5.0 cannot parse a comment-ONLY line (it throws
 * 'Unexpected EOF' — verified during the decision round), so full-line
 * comments are stripped before parsing, the same way bash treats them: a
 * no-op. Trailing comments are already dropped by the grammar. Returns null
 * when nothing remains. */
const stripCommentLines = (source) => String(source).split('\n')
  .filter((line) => !/^\s*#/.test(line)).join('\n');

/** Parse one command line into the bash-parser AST (`{ mode: 'bash' }`).
 * Throws ShellParseError on syntax/grammar failure; returns null for an
 * empty or comment-only line (the no-op shell convention). */
export const parseCommandLine = (source) => {
  const text = stripCommentLines(source);
  if (text.trim().length === 0) return null;
  log.debug('parse', { chars: text.length });
  let parser;
  try {
    parser = vendorRequire('bash-parser');
  } catch (error) {
    throw new ShellParseError(`the vendored parser failed to load: ${error?.message ?? error}`, false);
  }
  try {
    return parser(text, { mode: 'bash' });
  } catch (error) {
    throw new ShellParseError(error?.message ?? String(error), error instanceof SyntaxError);
  }
};
