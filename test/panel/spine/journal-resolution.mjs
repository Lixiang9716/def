// dsh:logging-exempt (test provisioning: the loud failures ARE the surface)
/**
 * journal-resolution.mjs — resolution layer for the journal-migration leg.
 *
 * The leg drives the VENDORED @deepseek-ai/dsh-session-persistence-jsonl
 * backend under plain Node (real disk, no loader hooks — the journal format
 * contract must hold where upstream wrote it: node's own fs, not the
 * workspace VFS). Node realpaths ESM entries, so the resolution layout the
 * vendored graph needs is the REAL ancestor chain of the vendored trees:
 *
 *   - runtime/dsh/node_modules  (provision-modules.mjs farm — the suite's
 *     own prerequisite; this file's import paths enter through it)
 *   - external/node_modules     (parity-node-modules.sh — reachable from
 *     external/npm/<pkg>/lib where every vendored realpath lands)
 *
 * Two names the parity layout does not serve the way this leg needs are
 * re-linked HERE, inside a dedicated external/npm/node_modules layer (a
 * CLOSER ancestor than external/node_modules, so it shadows exactly these
 * two rows and nothing else; idempotent, and inside the untracked vendor
 * tree a re-fetch wipes — rebuilt every run):
 *
 *   - @deepseek-ai/dsh-session-persistence → the REAL vendored package
 *     (runtime/dsh/vendor/dsh/session-persistence@0.1.6-alpha.2). parity's
 *     errors-only linkage shim predates the resume leg and cannot serve the
 *     backend's named imports (materializeCreateHeader &co); the product
 *     bare map serves the real package (upstream/README.md), and so does
 *     this leg.
 *   - @deepseek-ai/node-addon-system → '.' re-exports the vendored npm face
 *     and './flock' is the runtime shim (upstream's own single-process
 *     answer: the in-process write claim already excludes every writer).
 *     The real flock addon needs a native darwin binding the vendored
 *     closure does not carry.
 *
 * usage: import { journalImport } from './journal-resolution.mjs' — the
 * first import materializes the layer or throws loud naming the command.
 */
import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = pathResolve(fileURLToPath(import.meta.url), '..');
export const REPO = pathResolve(HERE, '..', '..', '..');
const RUNTIME_DSH = join(REPO, 'runtime', 'dsh');
const EXTERNAL = join(REPO, 'external');
const VERSION = '0.1.6-alpha.2';

/** file:// URL of one farm-linked package's lib entry (the suite's own
 * provisioned resolution surface — run.sh builds the farm before the
 * suites). */
export const journalImport = (pkg, entry = 'lib/index.js') => {
  const farmEntry = join(RUNTIME_DSH, 'node_modules', pkg, entry);
  if (!existsSync(farmEntry)) {
    throw new Error(
      `journal-migration: the node_modules farm is missing (${farmEntry}) — `
      + 'run node test/panel/spine/provision-modules.mjs (run.sh does) after '
      + 'external/ensure-dsh.sh materialized the vendored closure');
  }
  return pathToFileURL(farmEntry).href;
};

/** One junction row: link `at` → `target`, refreshed on mismatch (the
 * provision-modules.mjs shape: lstat, never existsSync — a dangling link
 * still occupies the name). */
const link = (at, target) => {
  mkdirSync(dirname(at), { recursive: true });
  try {
    if (readlinkSync(at) === target) return;
  } catch { /* absent or not a link — replace below */ }
  rmSync(at, { recursive: true, force: true });
  symlinkSync(target, at, 'junction');
};

const writeIfChanged = (at, text) => {
  if (existsSync(at) && readFileSync(at, 'utf8') === text) return;
  writeFileSync(at, text);
};

/** The closer-ancestor layer at external/npm/node_modules shadowing exactly
 * the two rows above (see the module header). */
const stageOverrideLayer = () => {
  const scope = join(EXTERNAL, 'npm', 'node_modules', '@deepseek-ai');
  const realPersistence = join(RUNTIME_DSH, 'vendor', 'dsh', `session-persistence@${VERSION}`);
  if (!existsSync(realPersistence)) {
    throw new Error(
      `journal-migration: the vendored session-persistence package is absent `
      + `(${realPersistence}) — run external/ensure-dsh.sh first`);
  }
  link(join(scope, 'dsh-session-persistence'), realPersistence);
  const nas = join(scope, 'node-addon-system');
  const flockShim = join(RUNTIME_DSH, 'upstream', 'shims', 'node-addon-system-flock.js');
  const realFace = join(EXTERNAL, 'npm', `node-addon-system@0.1.2`, 'lib', 'index.js');
  link(join(nas, 'real', 'index.js'), realFace);
  link(join(nas, 'flock.js'), flockShim);
  writeIfChanged(join(nas, 'package.json'), JSON.stringify({
    name: '@deepseek-ai/node-addon-system',
    private: true,
    type: 'module',
    exports: { '.': './real/index.js', './flock': './flock.js' },
  }, null, 2) + '\n');
};

/** Materialize everything the leg's imports need, or fail loud naming the
 * command (rule 5). Cheap after the first run: link targets compared, no
 * copies. */
export const ensureResolution = () => {
  const farm = join(RUNTIME_DSH, 'node_modules');
  if (!existsSync(join(farm, '@deepseek-ai', `dsh-session-persistence-jsonl`))) {
    throw new Error(
      'journal-migration: the node_modules farm is missing — run '
      + 'external/ensure-dsh.sh && node test/panel/spine/provision-modules.mjs first');
  }
  if (!existsSync(join(EXTERNAL, 'node_modules', '@deepseek-ai', 'cordis'))) {
    throw new Error(
      'journal-migration: external/node_modules is missing — run '
      + 'sh runtime/dsh/ci/parity-node-modules.sh first (the vendored graph '
      + 'resolves its bare imports through the real ancestor chain)');
  }
  stageOverrideLayer();
};

// Module top: the layer must exist before any of this file's import-path
// helpers are consumed (the test file imports through them immediately).
ensureResolution();
