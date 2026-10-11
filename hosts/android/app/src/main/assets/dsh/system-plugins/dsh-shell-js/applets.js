/**
 * applets.js — the dispatch table and the source composition (DECISION §2).
 *
 * ## Where the 22 applets come from
 *
 * - shelljs 0.10.0 (vendored pristine, loaded through parser.js's seam):
 *   cat, echo, pwd, cd (wrapper-owned cwd — see appletCd), ls, grep, sed,
 *   head, tail, sort, uniq, mkdir, rm, mv, cp, find. The bodies are
 *   byte-pristine; ALL adaptation is here, in the seams.
 * - Hand-written: wc, env, basename, dirname (absent from shelljs).
 * - Repo modules: sha256sum (runtime/dsh/sha256.js), tar
 *   (runtime/dsh/tar-mini.js — uncompressed ustar, regular files only,
 *   because the frozen gateway has no inflate primitive).
 *
 * ## The load-bearing seam: sync bodies over an async gateway
 *
 * Every gateway primitive is asynchronous (contract §1: Promise in, Promise
 * out), while shelljs bodies call `fs.readFileSync` and use the return value
 * synchronously — no sync bridge exists and none may exist (a nested event
 * loop inside one call would re-enter pending jobs mid-applet: shared
 * mutable state across module boundaries, exactly what D8 forbids). The
 * seam is therefore a per-applet SNAPSHOT MICROCOSMOS:
 *
 *   1. PREFETCH (async, real gateway calls): the wrapper stats/lists/reads
 *      everything the applet's arguments imply into an in-memory snapshot.
 *   2. BODY (sync, pristine): the node-face `fs` adapter below serves the
 *      body entirely from the snapshot; every mutation is applied to the
 *      snapshot AND recorded as a replay op.
 *   3. REPLAY (async, real gateway calls): recorded ops apply in order; a
 *      replay failure becomes the applet's failure, naming primitive+path.
 *
 * The microcosm is not an approximation. This runtime has ONE serial queue:
 * between the prefetch awaits and the replay awaits the body runs to
 * completion with nothing else interleaved, so the snapshot is coherent
 * with the workspace for the whole body. Whole-file reads stay bounded by
 * the host's max read size (an oversize read is the gateway's named
 * `invalid` rejection — disclosed in the tool description).
 *
 * ## Globbing is the executor's, not the bodies'
 *
 * bash expands globs before a program sees argv, and so does this shell
 * (DECISION §4.3): index.js expands word-position globs through
 * `expandGlob` below (hand-written fsList walker + vendored minimatch —
 * §3), and shelljs runs with `config.noglob = true`. The `fast-glob`
 * provider exists for the one path that switch cannot reach — shelljs's
 * ls body calls `glob.sync` DIRECTLY for -R walks — and serves it over
 * the live snapshot (still gateway-sourced listings, still minimatch);
 * outside a snapshot it refuses by name.
 *
 * ## Applet contract
 *
 * Every applet is `async (argv, { stdin, vars }) => { stdout, stderr,
 * code }`. `stdin` is a stream.js PipeReader or null; the executor drains
 * pipeline stdin into it (or closes it when the applet never reads — the
 * upstream writer then refuses by name, the EPIPE posture, never a hang).
 * `vars` carries this command's prefix assignments (the env applet prints
 * the session table overlaid with them). The executor owns writing stdout
 * to the next pipe or capture sink.
 *
 * ## Honesty rules (the house rule)
 *
 * Anything a command asks for that the seven gateway primitives cannot
 * honor fails BY NAME (exit 2, stderr naming what is missing): `cp -p`,
 * `ls -l`, `tar -z`, every flag outside an applet's implemented set, the
 * chmod/utimes/symlink family (no such primitive — a contract proposal is
 * the D5 path), and subprocesses (structurally impossible — AGENTS #2).
 */

import { createLogger } from 'logger.js';
import {
  fsRead, fsWrite, fsStat, fsList, fsMkdir, fsRemove, fsRename, GatewayError,
} from 'gateway.js';
import { sha256Hex } from 'sha256.js';
import { tarWrite, tarRead } from 'tar-mini.js';
import { provideBuiltin, vendorRequire, ensureVendorReader } from './parser.js';

const log = createLogger('dsh.shell.js.applets');

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
    super(message);
    this.name = 'ShellRefusal';
    this.exitCode = exitCode;
  }
}

/** The no-subprocess message every stub shares (AGENTS non-negotiable #2). */
const NO_SUBPROCESS = 'this host runs no child processes (single QuickJS '
  + 'runtime, no subprocess by design) — the command cannot be executed here';

const refusedPrimitive = (name, why) => {
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
  const s = String(p ?? '');
  const raw = s.startsWith('/') ? s : `${session.cwd}/${s}`;
  return normalizeInternal(raw);
};

/** internal (canonical relative or '/'-absolute) → gateway (scope, path).
 * The workspace prefix inside the 'app' scope is read from the pinned
 * globals — never guessed. */
export const toGateway = (internal) => {
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
const P = {
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
// The snapshot microcosm — prefetch (gateway) → body (sync) → replay
// (gateway)
// ---------------------------------------------------------------------------

const ENOENT = (what, p) => {
  const e = new Error(`ENOENT: no such file or directory, ${what} '${p}'`);
  e.code = 'ENOENT';
  return e;
};

/** One per-applet snapshot: everything the body may touch, plus the replay
 * queue for its mutations. The workspace root ('') is seeded as a
 * directory — it exists by construction (it IS the pinned workspace), and
 * mkdirSyncRecursive's upward walk stops on exactly that answer. */
class Snapshot {
  constructor() {
    this.files = new Map();     // canonical path → {kind, size, mtime, bytes}
    this.listings = new Map();  // canonical dir path ('' = root) → entries[]|null
    this.ops = [];              // replay ops, in body order
    this.files.set('', { kind: 'dir', size: 0, mtime: '', bytes: undefined });
  }

  /** Prefetch one path's stat (a miss records kind:null — existsSync then
   * answers false the way the body expects). */
  async stat(internal) {
    const key = resolveAgainstCwd(internal);
    if (key === null || this.files.has(key)) return key;
    try {
      const g = toGateway(key === '' ? '.' : key);
      const stat = await fsStat(g.scope, g.path);
      this.files.set(key, { kind: stat.kind, size: stat.size, mtime: stat.mtime, bytes: undefined });
    } catch (error) {
      if (error?.code === 'io') this.files.set(key, { kind: null, size: 0, mtime: '' });
      else throw error;
    }
    return key;
  }

  /** Prefetch one file's content (stat + whole-file read). */
  async readFile(internal) {
    const key = await this.stat(internal);
    if (key === null) return key;
    const entry = this.files.get(key);
    if (entry?.kind !== 'file' || entry.bytes !== undefined) return key;
    const g = toGateway(key);
    const read = await fsRead(g.scope, g.path);
    entry.bytes = read.bytes;
    entry.size = read.bytes.length;
    entry.mtime = read.mtime;
    return key;
  }

  /** Prefetch one directory's listing (one level) into the snapshot. */
  async listDir(internal) {
    const key = resolveAgainstCwd(internal);
    if (key === null || this.listings.has(key)) return key;
    const g = toGateway(key === '' ? '.' : key);
    let entries;
    try {
      entries = (await fsList(g.scope, g.path)).entries ?? [];
    } catch (error) {
      if (error?.code === 'io') {
        this.listings.set(key, null);
        return key;
      }
      throw error;
    }
    this.listings.set(key, entries);
    if (!this.files.has(key)) this.files.set(key, { kind: 'dir', size: 0, mtime: '' });
    for (const entry of entries) {
      const child = key === '' ? entry.name : `${key}/${entry.name}`;
      if (!this.files.has(child)) {
        this.files.set(child, { kind: entry.kind, size: 0, mtime: '', bytes: undefined });
      }
    }
    return key;
  }

  /** Prefetch a whole subtree's listing (for -R/-r walks). Bounded: a walk
   * past SNAPSHOT_DIR_BOUND directories is refused by name, never allowed
   * to run away. */
  async listTree(internal) {
    const root = await this.listDir(internal);
    if (root === null) return;
    const pending = [root];
    let walked = 0;
    const bound = 4096;
    while (pending.length > 0) {
      const dir = pending.shift();
      const entries = this.listings.get(dir);
      if (entries === null || entries === undefined) continue;
      for (const entry of entries) {
        if (entry.kind !== 'dir') continue;
        const child = dir === '' ? entry.name : `${dir}/${entry.name}`;
        if (this.listings.has(child)) continue;
        walked += 1;
        if (walked > bound) {
          throw new ShellRefusal(2,
            `dsh-shell-js: directory walk under '${internal}' exceeds ${bound} directories (snapshot bound)`);
        }
        await this.listDir(child);
        pending.push(child);
      }
    }
  }

  /** Replay recorded mutations through the real gateway, in body order. */
  async replay() {
    for (const op of this.ops) {
      log.debug('replay op', { op: op.op, path: op.key ?? op.from });
      if (op.op === 'write') {
        const g = toGateway(op.key);
        await fsWrite(g.scope, g.path, op.bytes, { append: op.append === true });
      } else if (op.op === 'mkdir') {
        const g = toGateway(op.key);
        await fsMkdir(g.scope, g.path);
      } else if (op.op === 'remove') {
        const g = toGateway(op.key);
        await fsRemove(g.scope, g.path, { recursive: op.recursive === true, missing: 'ok' });
      } else if (op.op === 'rename') {
        const from = toGateway(op.from);
        const to = toGateway(op.to);
        await fsRename(from.scope, from.path, to.path);
      } else {
        throw new Error(`snapshot replay: unknown op '${op.op}'`);
      }
    }
    this.ops.length = 0;
  }

  /** The node-face `fs` the pristine bodies import: sync by contract, and
   * the snapshot is the only thing it touches. Writes mutate the snapshot
   * AND queue a gateway op, so a body that writes then reads inside one
   * call (cp -r, sed -i) observes its own writes. */
  nodeFace() {
    const snapshot = this;
    const entryOf = (internal) => snapshot.files.get(resolveAgainstCwd(internal));
    const statObject = (entry, spelling) => {
      if (entry === undefined || entry.kind === null) throw ENOENT('stat', spelling);
      const isFile = entry.kind === 'file';
      const isDir = entry.kind === 'dir';
      const mtime = entry.mtime ? new Date(entry.mtime) : new Date(0);
      return {
        isFile: () => isFile,
        isDirectory: () => isDir,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false, // honest: the gateway has no symlink distinction
        isFIFO: () => false,
        isSocket: () => false,
        size: entry.size ?? 0,
        mtime,
        mtimeMs: mtime.getTime(),
        atime: mtime,
        ctime: mtime,
      };
    };
    const encode = (data) => (typeof data === 'string' ? new TextEncoder().encode(data) : data);
    const grow = (base, bytes) => {
      const merged = new Uint8Array(base.length + bytes.length);
      merged.set(base);
      merged.set(bytes, base.length);
      return merged;
    };

    return {
      existsSync: (p) => {
        const e = entryOf(p);
        return e !== undefined && e.kind !== null;
      },
      statSync: (p) => statObject(entryOf(p), p),
      lstatSync: (p) => statObject(entryOf(p), p),
      readdirSync: (p) => {
        const key = resolveAgainstCwd(p);
        const entries = snapshot.listings.get(key);
        if (entryOf(p) === undefined || entries === undefined || entries === null) {
          throw ENOENT('scandir', p);
        }
        return entries.map((entry) => entry.name);
      },
      readFileSync: (p, encoding) => {
        const entry = entryOf(p);
        if (entry === undefined || entry.kind === null) throw ENOENT('open', p);
        if (entry.kind === 'dir') {
          const e = new Error(`EISDIR: illegal operation on a directory, read '${p}'`);
          e.code = 'EISDIR';
          throw e;
        }
        if (entry.bytes === undefined) {
          // The wrapper prefetches everything the arguments imply; a body
          // reaching past that is a wrapper bug — loud, never blank.
          throw new Error(`dsh-shell-js snapshot: '${resolveAgainstCwd(p)}' was not prefetched for this applet (wrapper bug)`);
        }
        return encoding === 'utf8' || encoding === 'utf-8'
          ? new TextDecoder().decode(entry.bytes)
          : entry.bytes;
      },
      writeFileSync: (p, data) => {
        const key = resolveAgainstCwd(p);
        if (key === null) throw new Error(`path escapes the workspace: ${p}`);
        const bytes = encode(data);
        snapshot.files.set(key, { kind: 'file', size: bytes.length, mtime: '', bytes });
        snapshot.listings.delete(key);
        snapshot.ops.push({ op: 'write', key, bytes, append: false });
      },
      appendFileSync: (p, data) => {
        const key = resolveAgainstCwd(p);
        if (key === null) throw new Error(`path escapes the workspace: ${p}`);
        const bytes = encode(data);
        const prev = snapshot.files.get(key);
        const merged = prev?.bytes ? grow(prev.bytes, bytes) : bytes;
        snapshot.files.set(key, { kind: 'file', size: merged.length, mtime: '', bytes: merged });
        snapshot.ops.push({ op: 'write', key, bytes, append: true });
      },
      mkdirSync: (p, opts) => {
        void opts; // fsMkdir is recursive with existing:'ok' — both node shapes map
        const key = resolveAgainstCwd(p);
        if (key === null) throw new Error(`path escapes the workspace: ${p}`);
        snapshot.files.set(key, { kind: 'dir', size: 0, mtime: '', bytes: undefined });
        if (!snapshot.listings.has(key)) snapshot.listings.set(key, []);
        const parent = key === '' ? null : key.slice(0, key.lastIndexOf('/'));
        if (parent !== null && !snapshot.listings.has(parent)) snapshot.listings.set(parent, []);
        snapshot.ops.push({ op: 'mkdir', key });
      },
      rmdirSync: (p) => {
        const key = resolveAgainstCwd(p);
        snapshot.files.delete(key);
        snapshot.listings.delete(key);
        snapshot.ops.push({ op: 'remove', key, recursive: false });
      },
      rmSync: (p, opts = {}) => {
        const key = resolveAgainstCwd(p);
        const recursive = opts.recursive === true;
        for (const k of [...snapshot.files.keys()]) {
          if (k === key || (recursive && k.startsWith(`${key}/`))) snapshot.files.delete(k);
        }
        for (const k of [...snapshot.listings.keys()]) {
          if (k === key || (recursive && k.startsWith(`${key}/`))) snapshot.listings.delete(k);
        }
        snapshot.ops.push({ op: 'remove', key, recursive });
      },
      unlinkSync: (p) => {
        const key = resolveAgainstCwd(p);
        snapshot.files.delete(key);
        snapshot.ops.push({ op: 'remove', key, recursive: false });
      },
      renameSync: (from, to) => {
        const fromKey = resolveAgainstCwd(from);
        const toKey = resolveAgainstCwd(to);
        if (fromKey === null || toKey === null) throw new Error('path escapes the workspace');
        const entry = snapshot.files.get(fromKey);
        if (entry === undefined || entry.kind === null) throw ENOENT('rename', from);
        snapshot.files.delete(fromKey);
        snapshot.files.set(toKey, entry);
        snapshot.ops.push({ op: 'rename', from: fromKey, to: toKey });
      },
      // The in-memory fd emulation (DECISION §2.3 piece 1): head/tail read
      // through openSync/readSync/closeSync over the whole-file snapshot;
      // writable fds buffer in memory and flush as ONE fsWrite at close.
      openSync: (p, flags = 'r') => {
        const key = resolveAgainstCwd(p);
        const reading = flags.startsWith('r');
        const entry = entryOf(p);
        if (reading && (entry === undefined || entry.kind === null)) throw ENOENT('open', p);
        const fd = {
          key,
          reading,
          append: flags.startsWith('a'),
          data: reading ? (entry.bytes ?? new Uint8Array(0)) : new Uint8Array(0),
          pos: 0,
        };
        fds.add(fd);
        return fd;
      },
      readSync: (fd, buffer, offset, length, position) => {
        const at = position === null || position === undefined ? fd.pos : position;
        const slice = fd.data.subarray(at, at + length);
        buffer.set(slice, offset); // Uint8Array.set clamps on short reads
        if (position === null || position === undefined) fd.pos = at + slice.length;
        return slice.length;
      },
      writeSync: (fd, data, offset, length) => {
        const bytes = encode(data);
        const chunk = length === undefined ? bytes : bytes.subarray(offset ?? 0, (offset ?? 0) + length);
        if (fd.append || fd.data.length > 0) fd.data = grow(fd.data, chunk);
        else fd.data = chunk.slice();
        return chunk.length;
      },
      closeSync: (fd) => {
        fds.delete(fd);
        if (fd.reading) return;
        snapshot.files.set(fd.key, { kind: 'file', size: fd.data.length, mtime: '', bytes: fd.data });
        snapshot.ops.push({ op: 'write', key: fd.key, bytes: fd.data, append: fd.append });
      },
      // The chmod family: the COMMAND is refused by name (REFUSED_COMMANDS
      // — user intent needs a contract proposal, D5), but the pristine
      // cp -r body bookends every copied directory with an unconditional
      // chmodSync (cp.js's last line), and DECISION §2.2 declares plain
      // `cp -r` honor-able — so the adapter's chmodSync is a DISCLOSED
      // no-op: the gateway has no mode for fsStat to read or any primitive
      // to write, so there is literally nothing to change and no
      // observable divergence to hide. The timestamp family still throws
      // (only reachable under the refused -p flag).
      chmodSync: () => {},
      fchmodSync: () => {},
      utimesSync: () => { throw refusedPrimitive('utimes', 'the gateway fs face has no timestamp primitive (a touch needs a contract proposal, D5)'); },
      futimesSync: () => { throw refusedPrimitive('futimes', 'the gateway fs face has no timestamp primitive (a touch needs a contract proposal, D5)'); },
      symlinkSync: () => { throw refusedPrimitive('symlink', 'the gateway fs face has no link primitive of either kind (an ln needs a contract proposal, D5)'); },
      readlinkSync: () => { throw refusedPrimitive('readlink', 'the gateway fs face has no link primitive (an ln needs a contract proposal, D5)'); },
      chownSync: () => { throw refusedPrimitive('chown', 'the gateway fs face has no ownership primitive'); },
      lchownSync: () => { throw refusedPrimitive('lchown', 'the gateway fs face has no ownership primitive'); },
      fchownSync: () => { throw refusedPrimitive('fchown', 'the gateway fs face has no ownership primitive'); },
    };
  }
}

// The fd table for the sync face above (object-identity fds).
const fds = new Set();

// ---------------------------------------------------------------------------
// The other builtin faces (providers for parser.js's seam)
// ---------------------------------------------------------------------------

const osFace = {
  EOL: '\n',
  // The shell's home IS the workspace root; tmpdir is a workspace-local
  // scratch path (nothing in the honored applet set writes there).
  homedir: () => '/',
  tmpdir: () => '/.dsh-shell-js-tmp',
  platform: 'linux',
};

/** The util.format face echo needs (node's printf-ish conventions over the
 * argument list). Local on purpose: the repo's util shim drags a
 * shim-family graph (buffer/zlib/fflate) the plugin has no other need
 * for, and the closure this plugin adds to a host should be its own. */
const utilFormat = (template, ...args) => {
  if (typeof template !== 'string') {
    return [template, ...args].map((x) => String(x)).join(' ');
  }
  let argIndex = 0;
  const used = template.replace(/%[sdifjoO%]/g, (token) => {
    if (token === '%%') return '%';
    if (argIndex >= args.length) return token;
    const value = args[argIndex];
    argIndex += 1;
    switch (token[1]) {
      case 's': return String(value);
      case 'd':
      case 'i': return String(parseInt(value, 10));
      case 'f': return String(Number(value));
      default: return JSON.stringify(value); // %j %o %O
    }
  });
  const rest = args.slice(argIndex).map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
  return rest.length > 0 ? `${used} ${rest.join(' ')}` : used;
};

const subprocessRefusal = (prop, name) =>
  refusedPrimitive(`${name}.${String(prop)}`, NO_SUBPROCESS);

const subprocessStub = new Proxy({}, {
  get: (_t, prop) => { throw subprocessRefusal(prop, 'child_process'); },
});
const execaStub = new Proxy({}, {
  get: (_t, prop) => { throw subprocessRefusal(prop, 'execa'); },
});

// The snapshot a body is currently running against (set by runShelljs).
// shelljs's ls body calls `glob.sync` DIRECTLY for -R walks (a path the
// config.noglob wrapper switch cannot reach), so the fast-glob seam is a
// REAL provider over the live snapshot — every candidate still comes from
// gateway-driven listings, and outside a snapshot it refuses by name.
let currentSnapshot = null;

const fastGlobProvider = {
  sync(pattern, opts = {}) {
    if (currentSnapshot === null || minimatchFn === null) {
      throw refusedPrimitive('fast-glob.sync',
        'no applet snapshot is live (globbing runs over gateway listings inside applets)');
    }
    const patterns = Array.isArray(pattern) ? pattern : [pattern];
    const matches = new Set();
    for (const one of patterns) {
      const posix = String(one).replace(/\\/g, '/');
      if (EXTGLOB_PREFIX.test(posix)) continue; // noext: literal, matches nothing
      for (const dir of currentSnapshot.listings.keys()) {
        const entries = currentSnapshot.listings.get(dir);
        if (entries === null || entries === undefined) continue;
        for (const entry of entries) {
          const child = dir === '' ? entry.name : `${dir}/${entry.name}`;
          if (minimatchFn(child, posix, { dot: opts.dot === true })) matches.add(child);
        }
      }
    }
    return [...matches].sort();
  },
};

// A minimal Buffer face for the one global the pristine bodies touch
// (common.js probes `typeof Buffer.alloc === 'function'` at link time; the
// head/tail read loops call `buf.toString('utf8', start, end)` at run
// time). Presence-only and idempotent — the same posture as the process
// guard in parser.js.
if (globalThis.Buffer === undefined) {
  const attach = (u8) => {
    u8.toString = (_encoding, start = 0, end = u8.length) =>
      new TextDecoder().decode(u8.subarray(start, end));
    return u8;
  };
  const encoder = new TextEncoder();
  globalThis.Buffer = {
    alloc: (size) => attach(new Uint8Array(size ?? 0)),
    from: (src) => (typeof src === 'string' ? attach(encoder.encode(src)) : attach(new Uint8Array(src))),
    isBuffer: (x) => x instanceof Uint8Array,
    byteLength: (s) => (typeof s === 'string' ? encoder.encode(s).length : s.length),
  };
}

// ---------------------------------------------------------------------------
// The shelljs acquisition (memoized)
// ---------------------------------------------------------------------------

let shellObject = null;
let minimatchFn = null;
// The link-time `fs` exports object: pristine bodies bind THIS object at
// their load time, so a snapshot swaps its properties in place for the
// duration of one body call and restores the dormant stub after.
const linkFs = {};
const dormantLinkFs = () => {
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
  if (shellObject !== null) return;
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
  shellObject = shell;
  minimatchFn = vendorRequire('minimatch').minimatch;
  log.info('shelljs loaded through the vendor seam', { version: '0.10.0', noglob: true });
};

/** Run the sync body inside one snapshot: prefetch → body (fs face swapped
 * in place) → replay. Returns the body's return value. */
const runShelljs = async (prefetch, invoke) => {
  await ensureApplets();
  const snapshot = new Snapshot();
  await prefetch(snapshot);
  let result;
  let failure = null;
  const face = snapshot.nodeFace();
  const previous = { ...linkFs };
  for (const key of Object.keys(linkFs)) delete linkFs[key];
  Object.assign(linkFs, face);
  const previousSnapshot = currentSnapshot;
  currentSnapshot = snapshot;
  try {
    result = invoke(shellObject);
  } catch (error) {
    failure = error;
  } finally {
    currentSnapshot = previousSnapshot;
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
const shellStringOutcome = (result) => {
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
const piped = (stdinText) => shellObject.ShellString(stdinText ?? '');

/** Drain a pipeline stdin to text (null when there is none). */
const textOfStdin = async (stdin) => {
  if (stdin === null || stdin === undefined) return null;
  const chunks = [];
  for (;;) {
    const chunk = await stdin.read();
    if (chunk.done) break;
    chunks.push(new TextDecoder().decode(chunk.bytes));
  }
  return chunks.join('');
};

// ---------------------------------------------------------------------------
// argv helpers (flag parsing with the by-name refusal table)
// ---------------------------------------------------------------------------

/** Parse argv into {flags, args}. `known` is the applet's implemented flag
 * set; any flag outside it is refused BY NAME (DECISION §4.2), long options
 * wholesale (none are implemented), and value flags (-n 5) consume a value.
 * Multi-character flags in the known set (find's -name) match whole before
 * the per-character walk. */
const splitFlags = (argv, known, opts = {}) => {
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
      const whole = arg.slice(1);
      if (whole.length > 1 && known.has(whole)) {
        flags[whole] = flags[whole] ?? [];
        if (valueFlags.has(whole)) {
          const value = argv[i += 1];
          if (value === undefined) throw new ShellRefusal(2, `dsh-shell-js: -${whole} needs a value`);
          flags[whole].push(value);
        } else {
          flags[whole].push(true);
        }
        continue;
      }
      for (const ch of whole) {
        if (!known.has(ch)) {
          throw new ShellRefusal(2, `dsh-shell-js: -${ch} is not implemented by this applet `
            + `(implemented flags: -${[...known].join(' -') || 'none'})`);
        }
        flags[ch] = flags[ch] ?? [];
        if (valueFlags.has(ch)) {
          const value = argv[i += 1];
          if (value === undefined) throw new ShellRefusal(2, `dsh-shell-js: -${ch} needs a value`);
          flags[ch].push(value);
        } else {
          flags[ch].push(true);
        }
      }
    } else {
      args.push(arg);
    }
  }
  return { flags, args };
};

// ---------------------------------------------------------------------------
// The shelljs-backed applets
// ---------------------------------------------------------------------------

/** cat: files or stdin, -n numbering (GNU format lives in the body).
 * Note: shelljs's wrap() unshifts a dummy options string itself, so the
 * no-flag call passes NO options argument — an explicit '' would be
 * unshifted a second time and read as an empty file name. */
const appletCat = async (argv, ctx) => {
  const { flags, args } = splitFlags(argv, new Set('n'));
  const stdinText = args.length === 0 ? await textOfStdin(ctx.stdin) : null;
  if (args.length === 0 && stdinText === null) {
    throw new ShellRefusal(2, 'cat: no files given (no pipeline stdin either)');
  }
  const callArgs = 'n' in flags ? [{ number: true }] : [];
  const result = await runShelljs(
    async (snap) => { for (const file of args) await snap.readFile(file); },
    () => (args.length === 0
      ? piped(stdinText).cat(...callArgs)
      : shellObject.cat(...callArgs, ...args)),
  );
  return shellStringOutcome(result);
};

/** echo: no fs; util.format conventions (the body owns -n/-e). */
const appletEcho = async (argv) => {
  await ensureApplets();
  return shellStringOutcome(shellObject.echo(...argv));
};

/** cd: wrapper-owned (the pristine body drives process.chdir, which no
 * process-less host has) — fsStat + session cwd mutation (§4.1 #4). */
const appletCd = async (argv) => {
  const target = argv[0];
  let internal;
  if (target === '-') {
    if (session.oldpwd === null) {
      throw new ShellRefusal(2, 'cd: could not find previous directory (no OLDPWD yet)');
    }
    internal = session.oldpwd;
  } else if (target === undefined || target === '~' || target === '') {
    internal = ''; // home = the workspace root
  } else {
    internal = resolveAgainstCwd(target);
  }
  if (internal === null) {
    throw new ShellRefusal(2, `cd: '${target}' escapes the workspace`);
  }
  const g = toGateway(internal === '' ? '.' : internal);
  let stat;
  try {
    stat = await fsStat(g.scope, g.path);
  } catch {
    throw new ShellRefusal(2, `cd: no such file or directory: ${target ?? '/'}`);
  }
  if (stat.kind !== 'dir') throw new ShellRefusal(2, `cd: not a directory: ${target}`);
  session.oldpwd = session.cwd;
  session.cwd = internal;
  return { stdout: '', stderr: '', code: 0 };
};

/** ls: -a/-A, -R, -d honor-able; -l/-L refused by name (§2.2, §4.1 #5). */
const appletLs = async (argv) => {
  const { flags, args } = splitFlags(argv, new Set(['a', 'A', 'R', 'd']));
  const targets = args.length > 0 ? args : ['.'];
  const result = await runShelljs(
    async (snap) => {
      for (const target of targets) {
        await snap.stat(target);
        const entry = snap.files.get(resolveAgainstCwd(target));
        if (entry?.kind === 'dir') {
          if ('R' in flags) await snap.listTree(target);
          else await snap.listDir(target);
        }
      }
    },
    () => shellObject.ls({
      all: 'a' in flags || 'A' in flags,
      recursive: 'R' in flags,
      directory: 'd' in flags,
    }, ...targets),
  );
  return shellStringOutcome(result);
};

/** grep: the pristine filter; patterns are JavaScript RegExp, not POSIX
 * BRE/ERE (the §6 disclosure, carried into the tool description). */
const grepOptions = (flags) => ({
  inverse: 'v' in flags,
  nameOnly: 'l' in flags,
  ignoreCase: 'i' in flags,
  lineNumber: 'n' in flags,
  beforeContext: flags.B?.[0],
  afterContext: flags.A?.[0],
  context: flags.C?.[0],
});

const appletGrep = async (argv, ctx) => {
  const { flags, args } = splitFlags(argv, new Set(['v', 'l', 'i', 'n', 'B', 'A', 'C']), {
    valueFlags: new Set(['B', 'A', 'C']),
  });
  if (args.length === 0) throw new ShellRefusal(2, 'grep: a pattern is required');
  const pattern = args[0];
  const files = args.slice(1);
  const stdinText = files.length === 0 ? await textOfStdin(ctx.stdin) : null;
  if (files.length === 0 && stdinText === null) {
    throw new ShellRefusal(2, 'grep: no files given (no pipeline stdin either)');
  }
  const options = grepOptions(flags);
  const result = await runShelljs(
    async (snap) => { for (const file of files) await snap.readFile(file); },
    () => (files.length === 0
      ? piped(stdinText).grep(options, pattern)
      : shellObject.grep(options, pattern, ...files)),
  );
  return shellStringOutcome(result);
};

/** sed: the no-separator form (regex, replacement, files); -i via fsWrite
 * replay; patterns are JavaScript RegExp with no flags on string patterns
 * (the §6 disclosure). */
const appletSed = async (argv, ctx) => {
  const { flags, args } = splitFlags(argv, new Set('i'));
  if (args.length < 2) {
    throw new ShellRefusal(2, 'sed: usage: sed [-i] <regex> <replacement> <file...> '
      + '(the no-separator form; s/x/y/ strings are not implemented)');
  }
  const [regex, replacement] = args;
  const files = args.slice(2);
  const stdinText = files.length === 0 ? await textOfStdin(ctx.stdin) : null;
  if (files.length === 0 && stdinText === null) {
    throw new ShellRefusal(2, 'sed: no files given (no pipeline stdin either)');
  }
  const options = { inplace: 'i' in flags };
  const result = await runShelljs(
    async (snap) => { for (const file of files) await snap.readFile(file); },
    () => (files.length === 0
      ? piped(stdinText).sed(options, regex, replacement)
      : shellObject.sed(options, regex, replacement, ...files)),
  );
  return shellStringOutcome(result);
};

/** head/tail: whole-file reads under the in-memory fd emulation (§2.2). */
const headTail = (isHead) => async (argv, ctx) => {
  const { flags, args } = splitFlags(argv, new Set('n'), { valueFlags: new Set('n') });
  const files = args;
  const stdinText = files.length === 0 ? await textOfStdin(ctx.stdin) : null;
  const value = flags.n?.[0];
  // The options object is passed ONLY when -n was given (the '' trap: see
  // appletCat).
  const callArgs = value === undefined ? [] : [{ numLines: String(value).replace(/^[+-]/, '') }];
  const result = await runShelljs(
    async (snap) => { for (const file of files) await snap.readFile(file); },
    () => (files.length === 0
      ? piped(stdinText)[isHead ? 'head' : 'tail'](...callArgs)
      : shellObject[isHead ? 'head' : 'tail'](...callArgs, ...files)),
  );
  return shellStringOutcome(result);
};

/** sort: read + compare (localeCompare dialect, the §6 disclosure). */
const appletSort = async (argv, ctx) => {
  const { flags, args } = splitFlags(argv, new Set(['r', 'n']));
  const files = args;
  const stdinText = files.length === 0 ? await textOfStdin(ctx.stdin) : null;
  const options = { reverse: 'r' in flags, numerical: 'n' in flags };
  const result = await runShelljs(
    async (snap) => { for (const file of files) await snap.readFile(file); },
    () => (files.length === 0
      ? piped(stdinText).sort(options)
      : shellObject.sort(options, ...files)),
  );
  return shellStringOutcome(result);
};

/** uniq: read + compare (-i/-c/-d). */
const appletUniq = async (argv, ctx) => {
  const { flags, args } = splitFlags(argv, new Set(['i', 'c', 'd']));
  const files = args;
  const stdinText = files.length === 0 ? await textOfStdin(ctx.stdin) : null;
  const options = { ignoreCase: 'i' in flags, count: 'c' in flags, duplicates: 'd' in flags };
  const result = await runShelljs(
    async (snap) => { for (const file of files) await snap.readFile(file); },
    () => (files.length === 0
      ? piped(stdinText).uniq(options)
      : shellObject.uniq(options, ...files)),
  );
  return shellStringOutcome(result);
};

/** mkdir: recursive + existing-ok are fsMkdir natives (§4.1 #12). */
const appletMkdir = async (argv) => {
  const { flags, args } = splitFlags(argv, new Set('p'));
  if (args.length === 0) throw new ShellRefusal(2, 'mkdir: missing operand');
  const result = await runShelljs(
    async (snap) => { for (const dir of args) await snap.stat(dir); },
    () => shellObject.mkdir({ fullpath: 'p' in flags }, ...args),
  );
  return shellStringOutcome(result);
};

/** rm: recursive + missing-ok are fsRemove natives (§4.1 #13). */
const appletRm = async (argv) => {
  const { flags, args } = splitFlags(argv, new Set(['f', 'r', 'R']));
  if (args.length === 0) throw new ShellRefusal(2, 'rm: missing operand');
  const recursive = 'r' in flags || 'R' in flags;
  const result = await runShelljs(
    async (snap) => {
      for (const target of args) {
        await snap.stat(target);
        if (recursive) await snap.listTree(target);
      }
    },
    () => shellObject.rm({ force: 'f' in flags, recursive }, ...args),
  );
  return shellStringOutcome(result);
};

/** mv: fsRename's POSIX replace-target semantics are native (§4.1 #14). */
const appletMv = async (argv) => {
  const { flags, args } = splitFlags(argv, new Set(['f', 'n']));
  if (args.length < 2) throw new ShellRefusal(2, 'mv: missing destination file operand');
  const dest = args[args.length - 1];
  const result = await runShelljs(
    async (snap) => {
      for (const arg of args) await snap.stat(arg);
      const destKey = resolveAgainstCwd(dest);
      if (snap.files.get(destKey)?.kind === 'dir') await snap.listDir(destKey);
    },
    () => shellObject.mv({ no_force: 'n' in flags }, ...args),
  );
  return shellStringOutcome(result);
};

/** cp: -p refused by name (preserve needs owner/timestamps — no
 * primitives); plain/-r/-u honor-able (§2.2, §4.1 #15). */
const appletCp = async (argv) => {
  const { flags, args } = splitFlags(argv, new Set(['r', 'R', 'u', 'f', 'n']));
  if (args.length < 2) throw new ShellRefusal(2, 'cp: missing destination file operand');
  const sources = args.slice(0, -1);
  const dest = args[args.length - 1];
  const result = await runShelljs(
    async (snap) => {
      // cpdirSyncRecursive stats the dest's PARENT before recursing, and
      // its upward walk existsSync-probes every ancestor — so the prefetch
      // covers each source/dest ancestor chain, not just the leaf paths.
      const statChain = async (p) => {
        let cur = resolveAgainstCwd(p);
        while (cur !== null) {
          await snap.stat(cur === '' ? '.' : cur); // eslint-disable-line no-await-in-loop
          if (cur === '') break;
          const cut = cur.lastIndexOf('/');
          cur = cut <= 0 ? '' : cur.slice(0, cut);
        }
      };
      for (const source of sources) {
        await snap.stat(source);
        const entry = snap.files.get(resolveAgainstCwd(source));
        if (entry?.kind === 'dir') {
          // A recursive copy reads every file UNDER the tree — listing is
          // not enough, contents must be prefetched too.
          await snap.listTree(source);
          const treeKey = resolveAgainstCwd(source);
          for (const key of [...snap.files.keys()]) {
            if (snap.files.get(key)?.kind === 'file'
                && (treeKey === '' ? true : key.startsWith(`${treeKey}/`))) {
              await snap.readFile(key); // eslint-disable-line no-await-in-loop
            }
          }
        } else if (entry?.kind === 'file') await snap.readFile(source);
      }
      await snap.stat(dest);
      await statChain(dest);
      const destKey = resolveAgainstCwd(dest);
      if (snap.files.get(destKey)?.kind === 'dir') await snap.listDir(destKey);
    },
    () => shellObject.cp({
      recursive: 'r' in flags || 'R' in flags,
      update: 'u' in flags,
      no_force: 'n' in flags,
    }, ...args),
  );
  return shellStringOutcome(result);
};

/** find: the pristine walk, plus the wrapper's -name filter over vendored
 * minimatch; every other flag refused (§4.1 #16). */
const appletFind = async (argv) => {
  const { flags, args } = splitFlags(argv, new Set(['name']), { valueFlags: new Set(['name']) });
  const paths = args.length > 0 ? args : ['.'];
  const namePattern = flags.name?.[0];
  const result = await runShelljs(
    async (snap) => {
      for (const p of paths) {
        await snap.stat(p);
        if (snap.files.get(resolveAgainstCwd(p))?.kind === 'dir') await snap.listTree(p);
      }
    },
    () => shellObject.find(...paths),
  );
  let outcome = shellStringOutcome(result);
  if (namePattern !== undefined) {
    const keep = outcome.stdout.split('\n')
      .filter((line) => line !== '' && minimatchFn(P.basename(line), namePattern, { dot: false }));
    outcome = {
      stdout: keep.length > 0 ? `${keep.join('\n')}\n` : '',
      stderr: outcome.stderr,
      code: outcome.code,
    };
  }
  return outcome;
};

// ---------------------------------------------------------------------------
// The hand-written applets (§2.1: absent from shelljs)
// ---------------------------------------------------------------------------

/** wc: lines/words/bytes over whole-file reads or stdin; -l/-w/-c
 * (§4.1 #17 — utf8 world: bytes = utf8 byte length). */
const appletWc = async (argv, ctx) => {
  const { flags, args } = splitFlags(argv, new Set(['l', 'w', 'c']));
  const only = 'l' in flags || 'w' in flags || 'c' in flags;
  const want = { l: !only || 'l' in flags, w: !only || 'w' in flags, c: !only || 'c' in flags };
  const inputs = [];
  if (args.length === 0) {
    const stdinText = await textOfStdin(ctx.stdin);
    if (stdinText === null) throw new ShellRefusal(2, 'wc: no files given (no pipeline stdin either)');
    inputs.push({ name: null, text: stdinText });
  } else {
    for (const file of args) {
      const g = toGateway(resolveAgainstCwd(file));
      try {
        const read = await fsRead(g.scope, g.path);
        inputs.push({ name: file, text: new TextDecoder().decode(read.bytes) });
      } catch (error) {
        throw new ShellRefusal(2, `wc: ${file}: ${error?.message ?? error}`);
      }
    }
  }
  const out = inputs.map(({ name, text }) => {
    const lines = text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    const words = text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
    const bytes = new TextEncoder().encode(text).length;
    const parts = [want.l ? String(lines) : null, want.w ? String(words) : null, want.c ? String(bytes) : null];
    return `${parts.filter((x) => x !== null).join(' ')}${name !== null ? ` ${name}` : ''}\n`;
  });
  return { stdout: out.join(''), stderr: '', code: 0 };
};

/** env: prints the shell's variable table — NOT a host environment (there
 * is none). A prefix assignment scopes into the command (POSIX), so the
 * table shown is the session table overlaid with this command's
 * assignments (§2.3 piece 5, §4.1 #20). */
const appletEnv = async (_argv, ctx) => {
  const table = { ...session.vars, ...(ctx?.vars ?? {}) };
  const lines = Object.entries(table).map(([k, v]) => `${k}=${v}\n`);
  return { stdout: lines.join(''), stderr: '', code: 0 };
};

/** basename/dirname: pure path string ops, no fs (§4.1 #18/#19). */
const appletBasename = async (argv) => {
  if (argv.length < 1) throw new ShellRefusal(2, 'basename: missing operand');
  const suffix = argv.length > 1 ? argv[1] : undefined;
  return { stdout: `${P.basename(argv[0], suffix)}\n`, stderr: '', code: 0 };
};

const appletDirname = async (argv) => {
  if (argv.length < 1) throw new ShellRefusal(2, 'dirname: missing operand');
  return { stdout: `${P.dirname(argv[0])}\n`, stderr: '', code: 0 };
};

/** sha256sum: whole-file fsRead bytes → runtime/dsh/sha256.js hex, text
 * format `<hex>␣␣<path>` (§4.1 #21). */
const appletSha256sum = async (argv) => {
  const { args } = splitFlags(argv, new Set());
  if (args.length === 0) throw new ShellRefusal(2, 'sha256sum: no files given');
  const out = [];
  for (const file of args) {
    const g = toGateway(resolveAgainstCwd(file));
    try {
      const read = await fsRead(g.scope, g.path);
      out.push(`${sha256Hex(read.bytes)}  ${file}\n`);
    } catch (error) {
      throw new ShellRefusal(2, `sha256sum: ${file}: ${error?.message ?? error}`);
    }
  }
  return { stdout: out.join(''), stderr: '', code: 0 };
};

/** tar: -c/-t/-x -f over runtime/dsh/tar-mini.js. -z is refused by name
 * (no inflate primitive — the same design note tar-mini carries);
 * directories-in-archive are refused (ustar regular-file-only), never
 * silently skipped (§4.1 #22). */
const appletTar = async (argv) => {
  const { flags, args } = splitFlags(argv, new Set(['c', 't', 'x', 'f']), {
    valueFlags: new Set(['f']),
  });
  const modes = ['c', 't', 'x'].filter((m) => m in flags);
  if (modes.length !== 1) {
    throw new ShellRefusal(2, 'tar: exactly one of -c/-t/-x is required');
  }
  const archive = flags.f?.[0];
  if (archive === undefined) {
    throw new ShellRefusal(2, 'tar: -f <archive> is required (stdin/stdout archives are not implemented)');
  }
  const archiveGateway = toGateway(resolveAgainstCwd(archive));

  if (modes[0] === 'c') {
    if (args.length === 0) {
      throw new ShellRefusal(2, 'tar -c: no members given (archive the files you name)');
    }
    const members = [];
    for (const member of args) {
      const key = resolveAgainstCwd(member);
      if (key === null) throw new ShellRefusal(2, `tar: '${member}' escapes the workspace`);
      const g = toGateway(key === '' ? '.' : key);
      let stat;
      try {
        stat = await fsStat(g.scope, g.path);
      } catch {
        throw new ShellRefusal(2, `tar: ${member}: no such file or directory`);
      }
      if (stat.kind !== 'file') {
        throw new ShellRefusal(2, `tar: ${member}: only regular files can be archived `
          + '(ustar regular-file-only — directories are refused, not silently skipped)');
      }
      const read = await fsRead(g.scope, g.path);
      members.push({ path: key, bytes: read.bytes });
    }
    await fsWrite(archiveGateway.scope, archiveGateway.path, tarWrite(members));
    return { stdout: '', stderr: '', code: 0 };
  }

  let entries;
  try {
    const read = await fsRead(archiveGateway.scope, archiveGateway.path);
    entries = tarRead(read.bytes); // hostile-path guards live in tar-mini
  } catch (error) {
    throw new ShellRefusal(2, `tar: ${archive}: ${error?.message ?? error}`);
  }
  if (modes[0] === 't') {
    return { stdout: entries.map((m) => `${m.path}\n`).join(''), stderr: '', code: 0 };
  }
  for (const member of entries) {
    const g = toGateway(member.path);
    await fsWrite(g.scope, g.path, member.bytes);
  }
  return { stdout: '', stderr: '', code: 0 };
};

// ---------------------------------------------------------------------------
// The dispatch table (§4.1) and the by-name command refusals (§4.2)
// ---------------------------------------------------------------------------

export const APPLETS = {
  cat: appletCat,
  echo: appletEcho,
  pwd: async () => ({ stdout: session.cwd === '' ? '/\n' : `/${session.cwd}\n`, stderr: '', code: 0 }),
  cd: appletCd,
  ls: appletLs,
  grep: appletGrep,
  sed: appletSed,
  head: headTail(true),
  tail: headTail(false),
  sort: appletSort,
  uniq: appletUniq,
  mkdir: appletMkdir,
  rm: appletRm,
  mv: appletMv,
  cp: appletCp,
  find: appletFind,
  wc: appletWc,
  env: appletEnv,
  basename: appletBasename,
  dirname: appletDirname,
  sha256sum: appletSha256sum,
  tar: appletTar,
};

export const APPLET_NAMES = Object.keys(APPLETS).sort().join(', ');

/** Commands with no gateway backing — refused naming the missing capability
 * and the D5 path (§4.2). */
export const REFUSED_COMMANDS = {
  chmod: 'chmod: the gateway fs face (fsRead, fsWrite, fsStat, fsList, fsMkdir, fsRemove, fsRename) '
    + 'has no permission primitive — fsStat carries no mode and nothing can change one. '
    + 'This needs a contract proposal (D5), not an emulation.',
  ln: 'ln: the gateway fs face has no link primitive of either kind (no symlink, no hardlink). '
    + 'This needs a contract proposal (D5), not an emulation.',
  touch: 'touch: its core meaning is a timestamp update and the gateway has no utimes primitive; '
    + "shipping create-only under this name would silently change the command's meaning. "
    + 'This needs a contract proposal (D5).',
  exec: 'exec: there is no process to replace — no subprocess exists on this host '
    + '(single QuickJS runtime, no child processes by design).',
};

// ---------------------------------------------------------------------------
// The glob route's walker half (§3): recursive fsList descent (byte-sorted
// per contract — deterministic expansion order for free) + one vendored
// minimatch match per candidate, composed into sorted words. No match →
// null (the executor then keeps the literal word — the bash default).
// ---------------------------------------------------------------------------

const EXTGLOB_PREFIX = /^[?*+@!]\(/;
const SEGMENT_MAGIC = /[*?[\]]|\{[^}]*\}/;

/** Does one word carry glob magic (the executor's gate for expansion)? */
export const wordHasGlobMagic = (word) =>
  SEGMENT_MAGIC.test(String(word ?? ''));

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
  const walk = async (dir, depth) => {
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

  // Results take bash's spelling: an absolute pattern yields absolute
  // words; a relative pattern yields words relative to the CWD the shell
  // expanded it in — as a REAL relative path (`..` segments included), so
  // the argv a program receives resolves back to the matched candidate
  // under that same cwd. A match outside the cwd (a `..`-prefixed pattern
  // whose lexical fold anchored the walk at an ancestor) must come back as
  // `../name`, never as the bare name: the bare name would re-resolve
  // INSIDE the cwd and silently target the wrong file.
  const matches = candidates
    .filter((candidate) => minimatchFn(candidate, rel, { dot: false }))
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
