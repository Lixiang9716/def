/**
 * applets-shelljs.js — the shelljs acquisition (memoized) and the glob
 * route. Split out of the original single applets.js for the code-size
 * gate's budgets; the composition decision of record is
 * tmp/shell-js-spikes/DECISION.md §2/§3.
 *
 * The mount loads shelljs 0.10.0 + minimatch 10.0.3 through parser.js's
 * vendor seam and installs every builtin provider the pristine bodies
 * reach for (path/os/util/fs/child_process/execa/fast-glob). The link-time
 * `fs` exports object is swapped in place for the duration of one body
 * call (runShelljs) and the dormant stub restored after — the bodies bind
 * THIS object at load time, which is why the swap is by mutation, never by
 * re-binding.
 *
 * The glob route (§3) is the executor's, never the bodies': expandGlob is
 * the recursive fsList descent (byte-sorted per contract — deterministic
 * expansion order for free) + one vendored minimatch match per candidate,
 * composed into sorted words. No match → null (the executor keeps the
 * literal word — the bash default). The fast-glob provider serves the one
 * path that switch cannot reach — shelljs's ls body calls `glob.sync`
 * DIRECTLY for -R walks — over the live snapshot; outside a snapshot it
 * refuses by name.
 */

import { createLogger } from 'logger.js';
import { fsList } from 'gateway.js';
import {
  P, session, ShellRefusal, refusedPrimitive, resolveAgainstCwd,
  toGateway, SEGMENT_MAGIC,
} from './applets-support.js';

const log = createLogger('dsh.shell.js.shelljs');
import {
  Snapshot, snapshotState, osFace, utilFormat, subprocessStub, execaStub,
} from './applets-snapshot.js';
import { provideBuiltin, vendorRequire, ensureVendorReader } from './parser.js';

// ---------------------------------------------------------------------------
// The shelljs acquisition (memoized)
// ---------------------------------------------------------------------------

// The mount state: the pristine shelljs exports object + the vendored
// minimatch, populated by ensureApplets. The cmd wrappers read the shell
// off this object (applets-shelljs-cmds.js).
export const shellState = { shell: null, minimatch: null };
// The link-time `fs` exports object: pristine bodies bind THIS object at
// their load time, so a snapshot swaps its properties in place for the
// duration of one body call and restores the dormant stub after.
const linkFs = {};
const dormantLinkFs = () => {
  log.debug('dormant fs stub', {});
  const dormant = {};
  for (const name of ['readFileSync', 'writeFileSync', 'existsSync', 'statSync', 'lstatSync',
    'readdirSync', 'mkdirSync', 'rmdirSync', 'rmSync', 'unlinkSync', 'renameSync',
    'appendFileSync', 'openSync', 'readSync', 'writeSync', 'closeSync']) {
    dormant[name] = () => {
      throw new Error('dsh-shell-js: the fs face is only live inside an applet snapshot');
    };
  }
  return dormant;
};

/** Load shelljs + minimatch through the vendor seam. Idempotent. */
export const ensureApplets = async () => {
  log.debug('ensure applets', { loaded: shellState.shell !== null });
  if (shellState.shell !== null) return;
  await ensureVendorReader();
  provideBuiltin('path', P);
  provideBuiltin('os', osFace);
  provideBuiltin('util', { format: utilFormat });
  provideBuiltin('child_process', subprocessStub);
  provideBuiltin('execa', execaStub);
  provideBuiltin('fast-glob', fastGlobProvider);
  Object.assign(linkFs, dormantLinkFs());
  provideBuiltin('fs', linkFs);
  const shell = vendorRequire('shelljs');
  shell.config.silent = true;  // errors are return values; no console output
  shell.config.noglob = true;  // globbing is the executor's (DECISION §4.3)
  shellState.shell = shell;
  shellState.minimatch = vendorRequire('minimatch').minimatch;
  log.info('shelljs loaded through the vendor seam', { version: '0.10.0', noglob: true });
};

/** Run the sync body inside one snapshot: prefetch → body (fs face swapped
 * in place) → replay. Returns the body's return value. */
export const runShelljs = async (prefetch, invoke) => {
  log.debug('run shelljs body', {});
  await ensureApplets();
  const snapshot = new Snapshot();
  await prefetch(snapshot);
  let result;
  let failure = null;
  const face = snapshot.nodeFace();
  const previous = { ...linkFs };
  for (const key of Object.keys(linkFs)) delete linkFs[key];
  Object.assign(linkFs, face);
  const previousSnapshot = snapshotState.current;
  snapshotState.current = snapshot;
  try {
    result = invoke(shellState.shell);
  } catch (error) {
    failure = error;
  } finally {
    snapshotState.current = previousSnapshot;
    for (const key of Object.keys(linkFs)) delete linkFs[key];
    Object.assign(linkFs, previous);
  }
  if (failure !== null) throw failure;
  await snapshot.replay();
  return result;
};

/** ShellString (or plain value) → the executor outcome shape. shelljs
 * errors are return values (config.fatal stays false), so `code`/`stderr`
 * carry them (DECISION §2.3 piece 4). */
export const shellStringOutcome = (result) => {
  log.debug('shell outcome', { code: result?.code });
  const stdout = result === undefined || result === null ? ''
    : typeof result === 'string' ? result
      : Array.isArray(result) ? result.join('\n') + (result.length > 0 ? '\n' : '')
        : String(result.stdout ?? '');
  const stderr = typeof result?.stderr === 'string' ? result.stderr : '';
  const code = typeof result?.code === 'number' ? result.code : 0;
  return { stdout, stderr, code };
};

/** The shelljs way to feed pipeline stdin into a canReceivePipe command:
 * call it as a method on a ShellString of the stdin text (wrap() lifts
 * `this.stdout` into the body's readFromPipe). */
export const piped = (stdinText) => {
  log.debug('pipe stdin', { bytes: stdinText?.length ?? 0 });
  return shellState.shell.ShellString(stdinText ?? '');
};

// ---------------------------------------------------------------------------
// The fast-glob provider (the -R walk's glob.sync seam) and the glob route
// ---------------------------------------------------------------------------

const EXTGLOB_PREFIX = /^[?*+@!]\(/;

const fastGlobProvider = {
  sync(pattern, opts = {}) {
    log.debug('fast-glob sync', { patterns: Array.isArray(pattern) ? pattern.length : 1 });
    if (snapshotState.current === null || shellState.minimatch === null) {
      throw refusedPrimitive('fast-glob.sync',
        'no applet snapshot is live (globbing runs over gateway listings inside applets)');
    }
    const patterns = Array.isArray(pattern) ? pattern : [pattern];
    const matches = new Set();
    for (const one of patterns) {
      const posix = String(one).replace(/\\/g, '/');
      if (EXTGLOB_PREFIX.test(posix)) continue; // noext: literal, matches nothing
      for (const dir of snapshotState.current.listings.keys()) {
        const entries = snapshotState.current.listings.get(dir);
        if (entries === null || entries === undefined) continue;
        for (const entry of entries) {
          const child = dir === '' ? entry.name : `${dir}/${entry.name}`;
          if (shellState.minimatch(child, posix, { dot: opts.dot === true })) matches.add(child);
        }
      }
    }
    return [...matches].sort();
  },
};

/** Recursive fsList descent from the pattern's literal root (byte-sorted
 * per contract). `**` cannot walk past 64 levels. */
const walkCandidates = async (root, candidates) => {
  log.debug('glob walk', { root });
  const walk = async (dir, depth) => {
    log.debug('glob walk dir', { dir, depth });
    if (depth > 64) return; // globstar bound: ** cannot walk past 64 levels
    const g = toGateway(dir === '' ? '.' : dir);
    let entries;
    try {
      entries = (await fsList(g.scope, g.path)).entries ?? [];
    } catch (error) {
      if (error?.code === 'io') return; // absent dir: nothing to match
      throw error;
    }
    for (const entry of entries) {
      const child = dir === '' ? entry.name : `${dir}/${entry.name}`;
      candidates.push(child);
      if (entry.kind === 'dir') await walk(child, depth + 1);
    }
  };
  await walk(root, 0);
};

export const expandGlob = async (pattern) => {
  log.debug('glob expand', { pattern });
  await ensureApplets();
  const absolute = String(pattern).startsWith('/');
  // Anchored at the session cwd (resolveAgainstCwd): a relative pattern
  // after `cd` must match INSIDE the new directory — matching the root
  // instead would make `rm *.tmp` act on the wrong directory's files.
  const rel = resolveAgainstCwd(pattern);
  if (rel === null) return null; // escapes the workspace: not ours to walk
  const segments = rel === '' ? [] : rel.split('/');
  // bash without extglob treats the five extglob prefixes as literals;
  // minimatch v10 has no noext switch anymore, so such patterns refuse as
  // patterns (match nothing) rather than matching magically.
  if (EXTGLOB_PREFIX.test(rel)) return [];
  // The walk root: the leading literal segments (no magic).
  let rootSegs = 0;
  while (rootSegs < segments.length && !SEGMENT_MAGIC.test(segments[rootSegs])) rootSegs += 1;
  const root = rootSegs === 0 ? '' : segments.slice(0, rootSegs).join('/');

  const candidates = [];
  await walkCandidates(root, candidates);

  // Results take bash's spelling: an absolute pattern yields absolute
  // words; a relative pattern yields words relative to the CWD the shell
  // expanded it in — as a REAL relative path (`..` segments included), so
  // the argv a program receives resolves back to the matched candidate
  // under that same cwd. A match outside the cwd (a `..`-prefixed pattern
  // whose lexical fold anchored the walk at an ancestor) must come back as
  // `../name`, never as the bare name: the bare name would re-resolve
  // INSIDE the cwd and silently target the wrong file.
  const matches = candidates
    .filter((candidate) => shellState.minimatch(candidate, rel, { dot: false }))
    .map((candidate) => {
      if (absolute) return `/${candidate}`;
      if (session.cwd === '') return candidate;
      // Absolute spellings feed P.relative directly (its own resolve()
      // would re-anchor bare names at the cwd a second time).
      return P.relative(`/${session.cwd}`, `/${candidate}`);
    });
  matches.sort();
  return matches;
};
