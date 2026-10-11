/**
 * applets-support.js — the shared support layer of the dsh-shell-js
 * applets (split out of the original single applets.js for the code-size
 * gate's file/function budgets; the composition decision of record stays
 * tmp/shell-js-spikes/DECISION.md §2, and applets.js is the facade that
 * stitches the four applet modules back into one public surface).
 *
 * This module: the shell session, the refusal vocabulary, the workspace
 * path model (internal canonical form ↔ gateway scope/path), the `path`
 * builtin face, argv flag parsing, and the pure word helpers. It imports
 * nothing from the other applet modules — every dependency arrow in this
 * plugin's applet layer points DOWN into this file.
 */

import { createLogger } from 'logger.js';
import { GatewayError } from 'gateway.js';

export const log = createLogger('dsh.shell.js.applets');

// ---------------------------------------------------------------------------
// The shell session (DECISION §2.3 piece 5): cwd mutated by `cd`, the
// variable table read by $VAR expansions and set by FOO=bar assignments.
// Module-level because the fs/path/os faces below are reached from deep
// inside pristine bodies that cannot be passed a context — one shell per
// plugin instance, one session per shell, runs serialized on one queue.
// ---------------------------------------------------------------------------
export const session = {
  cwd: '',        // workspace-relative, '' = the workspace root
  vars: {},       // the shell variable table (env prints this)
  oldpwd: null,   // `cd -` support
};

/** The one refusal class applets raise: non-zero exit + a stderr naming
 * what is missing. Never a silent success. */
export class ShellRefusal extends Error {
  constructor(exitCode, message) {
    log.debug('shell refusal', { exitCode });
    super(message);
    this.name = 'ShellRefusal';
    this.exitCode = exitCode;
  }
}

/** The no-subprocess message every stub shares (AGENTS non-negotiable #2). */
export const NO_SUBPROCESS = 'this host runs no child processes (single QuickJS '
  + 'runtime, no subprocess by design) — the command cannot be executed here';

export const refusedPrimitive = (name, why) => {
  log.debug('primitive refused', { name });
  const e = new Error(`dsh-shell-js: ${name} is not available — ${why}`);
  e.code = 'DSH_REFUSED';
  return e;
};

// ---------------------------------------------------------------------------
// Path model: the shell's world is the pinned profile workspace (the
// dsh-shell-wasm convention — both roots are pinned globals the spine sets,
// so the mapping is read, never guessed). Internal canonical form is
// workspace-relative ('a/b', '' = root); the node-face absolute form is
// '/' + that (what the path face's resolve returns).
// ---------------------------------------------------------------------------

const scopeRoots = () => {
  log.debug('scope roots', {});
  const workspace = globalThis.__dshProfileCwd;
  const scopeRoot = globalThis.__dshProfileScopeRoot;
  if (typeof workspace !== 'string' || typeof scopeRoot !== 'string'
      || !workspace.startsWith(scopeRoot)) {
    throw new GatewayError('unavailable', 'shell',
      'the host granted no scoped workspace (no __dshProfileScopeRoot)');
  }
  return { workspace, scopeRoot };
};

/** Lexical normalization to the canonical workspace-relative form; null
 * escapes the root. Accepts '', 'a/b', './a', '/abs', '..'. */
export const normalizeInternal = (p) => {
  log.debug('normalize', { p });
  const segs = [];
  for (const seg of String(p ?? '').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (segs.length === 0) return null;
      segs.pop();
    } else segs.push(seg);
  }
  return segs.join('/');
};

/** cwd-relative resolution used by every face (fs adapter, path, walker). */
export const resolveAgainstCwd = (p) => {
  log.debug('resolve against cwd', { p });
  const s = String(p ?? '');
  const raw = s.startsWith('/') ? s : `${session.cwd}/${s}`;
  return normalizeInternal(raw);
};

/** internal (canonical relative or '/'-absolute) → gateway (scope, path).
 * The workspace prefix inside the 'app' scope is read from the pinned
 * globals — never guessed. */
export const toGateway = (internal) => {
  log.debug('to gateway', { internal });
  const clean = normalizeInternal(internal);
  if (clean === null) {
    throw new ShellRefusal(2, `dsh-shell-js: path '${internal}' escapes the workspace`);
  }
  const { workspace, scopeRoot } = scopeRoots();
  const prefix = workspace.slice(scopeRoot.length).replace(/^\/+/, '');
  const path = prefix.length === 0 ? clean : (clean.length === 0 ? prefix : `${prefix}/${clean}`);
  return { scope: 'app', path: path === '' ? '.' : path };
};

// ---------------------------------------------------------------------------
// The `path` builtin face: POSIX string algebra anchored at the session cwd
// (shelljs's path.resolve must track `cd`, so node's process-cwd anchoring
// cannot be reused — and the process guard stays presence-only).
// ---------------------------------------------------------------------------
export const P = {
  sep: '/',
  delimiter: ':',
  isAbsolute: (p) => String(p ?? '').startsWith('/'),
  normalize: (p) => {
    const abs = P.isAbsolute(p);
    const n = normalizeInternal(p);
    if (n === null) throw new Error(`path escapes the workspace: ${p}`);
    return n === '' ? '/' : (abs ? `/${n}` : n);
  },
  join: (...parts) => P.normalize(parts.filter((x) => x !== '').join('/')),
  resolve: (...parts) => {
    let abs = null;
    for (const part of parts) {
      if (P.isAbsolute(part)) abs = part;
      else abs = abs === null ? part : `${abs}/${part}`;
    }
    if (abs === null) abs = `/${session.cwd}`;
    else if (!P.isAbsolute(abs)) abs = `/${session.cwd}/${abs}`;
    const n = normalizeInternal(abs);
    if (n === null) throw new Error(`path escapes the workspace: ${abs}`);
    return `/${n}`;
  },
  relative: (from, to) => {
    const a = normalizeInternal(P.resolve(from));
    const b = normalizeInternal(P.resolve(to));
    if (a === null || b === null) throw new Error('path escapes the workspace');
    if (a === b) return '';
    const as = a === '' ? [] : a.split('/');
    const bs = b === '' ? [] : b.split('/');
    let i = 0;
    while (i < as.length && i < bs.length && as[i] === bs[i]) i += 1;
    const ups = as.length - i;
    const rest = bs.slice(i);
    return [...Array(ups).fill('..'), ...rest].join('/');
  },
  dirname: (p) => {
    const abs = P.isAbsolute(p);
    const n = normalizeInternal(p);
    if (n === null) throw new Error(`path escapes the workspace: ${p}`);
    if (n === '') return abs ? '/' : '.';
    const cut = n.lastIndexOf('/');
    if (cut < 0) return abs ? '/' : '.';
    const d = n.slice(0, cut);
    return abs ? `/${d}` : (d === '' ? '.' : d);
  },
  basename: (p, suffix) => {
    const n = normalizeInternal(p);
    if (n === null) throw new Error(`path escapes the workspace: ${p}`);
    let base = n === '' ? '/' : n.slice(n.lastIndexOf('/') + 1);
    if (suffix !== undefined && suffix !== '' && base.endsWith(suffix) && base !== suffix) {
      base = base.slice(0, base.length - suffix.length);
    }
    return base;
  },
  extname: (p) => {
    const base = P.basename(p);
    const cut = base.lastIndexOf('.');
    return cut > 0 ? base.slice(cut) : '';
  },
};

// ---------------------------------------------------------------------------
// argv helpers (flag parsing with the by-name refusal table)
// ---------------------------------------------------------------------------

/** Consume one flag occurrence: `true` into the flag bucket, or the next
 * argv entry when the flag takes a value. Returns the caller's next index. */
const pushFlag = (flags, name, argv, at, valueFlags) => {
  log.debug('flag push', { name });
  flags[name] = flags[name] ?? [];
  if (!valueFlags.has(name)) {
    flags[name].push(true);
    return at;
  }
  const value = argv[at + 1];
  if (value === undefined) throw new ShellRefusal(2, `dsh-shell-js: -${name} needs a value`);
  flags[name].push(value);
  return at + 1;
};

/** The short-flag cluster body: a known multi-character flag (find's -name)
 * matches whole before the per-character walk; anything outside the known
 * set is refused BY NAME (DECISION §4.2). Returns the caller's next index. */
const readShortFlags = (whole, known, valueFlags, flags, argv, at) => {
  log.debug('short flags', { whole });
  if (whole.length > 1 && known.has(whole)) {
    return pushFlag(flags, whole, argv, at, valueFlags);
  }
  let i = at;
  for (const ch of whole) {
    if (!known.has(ch)) {
      throw new ShellRefusal(2, `dsh-shell-js: -${ch} is not implemented by this applet `
        + `(implemented flags: -${[...known].join(' -') || 'none'})`);
    }
    i = pushFlag(flags, ch, argv, i, valueFlags);
  }
  return i;
};

/** Parse argv into {flags, args}. `known` is the applet's implemented flag
 * set; any flag outside it is refused BY NAME (DECISION §4.2), long options
 * wholesale (none are implemented), and value flags (-n 5) consume a value. */
export const splitFlags = (argv, known, opts = {}) => {
  log.debug('split flags', { args: argv.length });
  const valueFlags = opts.valueFlags ?? new Set();
  const flags = {};
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      args.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      throw new ShellRefusal(2, `dsh-shell-js: long option '${arg}' is not implemented `
        + `(implemented flags: -${[...known].join(' -') || 'none'})`);
    }
    if (arg.startsWith('-') && arg.length > 1) {
      i = readShortFlags(arg.slice(1), known, valueFlags, flags, argv, i);
    } else {
      args.push(arg);
    }
  }
  return { flags, args };
};

// ---------------------------------------------------------------------------
// Pure word helpers (the glob route's magic probe)
// ---------------------------------------------------------------------------

const SEGMENT_MAGIC = /[*?[\]]|\{[^}]*\}/;

/** Does one word carry glob magic (the executor's gate for expansion)? */
export const wordHasGlobMagic = (word) =>
  SEGMENT_MAGIC.test(String(word ?? ''));

/** The per-segment magic probe, shared with the glob route's root walk
 * (applets-shelljs.js). */
export { SEGMENT_MAGIC };

/** Drain a pipeline stdin to text (null when there is none). */
export const textOfStdin = async (stdin) => {
  log.debug('text of stdin', {});
  if (stdin === null || stdin === undefined) return null;
  const chunks = [];
  for (;;) {
    const chunk = await stdin.read();
    if (chunk.done) break;
    chunks.push(new TextDecoder().decode(chunk.bytes));
  }
  return chunks.join('');
};
