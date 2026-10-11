/**
 * applets-snapshot.js — the snapshot microcosm: prefetch (gateway) → body
 * (sync) → replay (gateway). Split out of the original single applets.js
 * for the code-size gate's budgets; the design decision of record is
 * tmp/shell-js-spikes/DECISION.md §2.3.
 *
 * Every gateway primitive is asynchronous (contract §1) while shelljs
 * bodies call `fs.readFileSync` and use the return value synchronously —
 * no sync bridge exists and none may exist (a nested event loop inside one
 * call would re-enter pending jobs mid-applet: shared mutable state across
 * module boundaries, exactly what D8 forbids). The seam is therefore a
 * per-applet SNAPSHOT MICROCOSMOS: the wrapper prefetches everything the
 * arguments imply, the body runs entirely off the in-memory snapshot
 * through the node-face `fs` below, and recorded mutations replay in order
 * afterwards. The microcosm is not an approximation — this runtime has ONE
 * serial queue, so the body runs to completion with nothing else
 * interleaved and the snapshot stays coherent.
 *
 * Also here: the remaining pure builtin faces the pristine bodies are
 * provided (os, util.format, the child_process/execa refusal stubs) and
 * the Buffer global presence guard.
 */

import { createLogger } from 'logger.js';
import {
  fsRead, fsWrite, fsStat, fsList, fsMkdir, fsRemove, fsRename,
} from 'gateway.js';
import {
  NO_SUBPROCESS, ShellRefusal, refusedPrimitive, resolveAgainstCwd,
  toGateway,
} from './applets-support.js';

const log = createLogger('dsh.shell.js.snapshot');

const ENOENT = (what, p) => {
  log.debug('enoent', { what, p });
  const e = new Error(`ENOENT: no such file or directory, ${what} '${p}'`);
  e.code = 'ENOENT';
  return e;
};

const listTreeBound = (internal, bound) => new ShellRefusal(2,
  `dsh-shell-js: directory walk under '${internal}' exceeds ${bound} directories (snapshot bound)`);

// The fd table for the sync face below (object-identity fds).
const fds = new Set();

// The snapshot a body is currently running against (set by runShelljs in
// applets-shelljs.js). shelljs's ls body calls `glob.sync` DIRECTLY for -R
// walks (a path the config.noglob wrapper switch cannot reach), so the
// fast-glob provider (applets-shelljs.js) reads THIS live state — every
// candidate still comes from gateway-driven listings, and outside a
// snapshot it refuses by name.
export const snapshotState = { current: null };

/** One per-applet snapshot: everything the body may touch, plus the replay
 * queue for its mutations. The workspace root ('') is seeded as a
 * directory — it exists by construction (it IS the pinned workspace), and
 * mkdirSyncRecursive's upward walk stops on exactly that answer. */
class Snapshot {
  constructor() {
    log.debug('snapshot', {});
    this.files = new Map();     // canonical path → {kind, size, mtime, bytes}
    this.listings = new Map();  // canonical dir path ('' = root) → entries[]|null
    this.ops = [];              // replay ops, in body order
    this.files.set('', { kind: 'dir', size: 0, mtime: '', bytes: undefined });
  }

  /** Prefetch one path's stat (a miss records kind:null — existsSync then
   * answers false the way the body expects). */
  async stat(internal) {
    log.debug('prefetch stat', { internal });
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
    log.debug('prefetch read', { internal });
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
    log.debug('prefetch listdir', { internal });
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
    log.debug('prefetch listtree', { internal });
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
        if (walked > bound) throw listTreeBound(internal, bound);
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
   * call (cp -r, sed -i) observes its own writes. Assembled from the
   * module-level face builders below (each within the function-size
   * budget). */
  nodeFace() {
    log.debug('node face', {});
    const snapshot = this;
    const entryOf = (internal) => snapshot.files.get(resolveAgainstCwd(internal));
    return {
      ...faceStat(entryOf),
      ...faceRead(snapshot, entryOf),
      ...faceMutate(snapshot),
      ...faceRemove(snapshot),
      ...faceFd(snapshot),
      ...faceDenied(),
    };
  }
}

// ---------------------------------------------------------------------------
// The node-face builders (module level: one function per face group)
// ---------------------------------------------------------------------------

/** stat/lstat + existsSync over the snapshot's entry table. */
const faceStat = (entryOf) => {
  log.debug('face stat', {});
  const statObject = (entry, spelling) => {
    log.debug('stat object', { spelling });
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
  return {
    existsSync: (p) => {
      const e = entryOf(p);
      return e !== undefined && e.kind !== null;
    },
    statSync: (p) => statObject(entryOf(p), p),
    lstatSync: (p) => statObject(entryOf(p), p),
  };
};

const encode = (data) => (typeof data === 'string' ? new TextEncoder().encode(data) : data);
const grow = (base, bytes) => {
  log.debug('grow', { base: base.length, bytes: bytes.length });
  const merged = new Uint8Array(base.length + bytes.length);
  merged.set(base);
  merged.set(bytes, base.length);
  return merged;
};

/** readdir/readFile — reads come only from prefetched snapshot bytes. */
const faceRead = (snapshot, entryOf) => ({
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
});

/** The mutating writers: each queues its replay op so the body's own reads
 * observe its writes (cp -r, sed -i). */
const faceMutate = (snapshot) => ({
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
});

/** The removing/rename side of the face. */
const faceRemove = (snapshot) => ({
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
});

/** The in-memory fd emulation (DECISION §2.3 piece 1): head/tail read
 * through openSync/readSync/closeSync over the whole-file snapshot;
 * writable fds buffer in memory and flush as ONE fsWrite at close. */
const faceFd = (snapshot) => ({
  openSync: (p, flags = 'r') => {
    const key = resolveAgainstCwd(p);
    const reading = flags.startsWith('r');
    const entry = snapshot.files.get(key);
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
});

/** The chmod family: the COMMAND is refused by name (REFUSED_COMMANDS —
 * user intent needs a contract proposal, D5), but the pristine cp -r body
 * bookends every copied directory with an unconditional chmodSync
 * (cp.js's last line), and DECISION §2.2 declares plain `cp -r` honor-able
 * — so the adapter's chmodSync is a DISCLOSED no-op: the gateway has no
 * mode for fsStat to read or any primitive to write, so there is literally
 * nothing to change and no observable divergence to hide. The timestamp
 * and link families still throw (only reachable under refused flags). */
const faceDenied = () => ({
  chmodSync: () => {},
  fchmodSync: () => {},
  utimesSync: () => { throw refusedPrimitive('utimes', 'the gateway fs face has no timestamp primitive (a touch needs a contract proposal, D5)'); },
  futimesSync: () => { throw refusedPrimitive('futimes', 'the gateway fs face has no timestamp primitive (a touch needs a contract proposal, D5)'); },
  symlinkSync: () => { throw refusedPrimitive('symlink', 'the gateway fs face has no link primitive of either kind (an ln needs a contract proposal, D5)'); },
  readlinkSync: () => { throw refusedPrimitive('readlink', 'the gateway fs face has no link primitive (an ln needs a contract proposal, D5)'); },
  chownSync: () => { throw refusedPrimitive('chown', 'the gateway fs face has no ownership primitive'); },
  lchownSync: () => { throw refusedPrimitive('lchown', 'the gateway fs face has no ownership primitive'); },
  fchownSync: () => { throw refusedPrimitive('fchown', 'the gateway fs face has no ownership primitive'); },
});

// ---------------------------------------------------------------------------
// The other builtin faces (providers for parser.js's seam)
// ---------------------------------------------------------------------------

export const osFace = {
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
export const utilFormat = (template, ...args) => {
  log.debug('util format', { template });
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

export const subprocessStub = new Proxy({}, {
  get: (_t, prop) => { throw subprocessRefusal(prop, 'child_process'); },
});
export const execaStub = new Proxy({}, {
  get: (_t, prop) => { throw subprocessRefusal(prop, 'execa'); },
});

// A minimal Buffer face for the one global the pristine bodies touch
// (common.js probes `typeof Buffer.alloc === 'function'` at link time; the
// head/tail read loops call `buf.toString('utf8', start, end)` at run
// time). Presence-only and idempotent — the same posture as the process
// guard in parser.js.
if (globalThis.Buffer === undefined) {
  const attach = (u8) => {
    log.debug('buffer attach', {});
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

export { Snapshot };
