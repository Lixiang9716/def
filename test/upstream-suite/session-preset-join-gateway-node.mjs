// dsh:logging-exempt (test adapter: no logging surface of its own)
/**
 * session-preset-join-gateway-node.mjs — the gateway face the session-
 * preset-join hooks serve to our upstream layer: the REAL gateway shim's
 * exports with httpFetch replaced by a real-fetch bridge (the
 * ci/parity-node-gateway.mjs contract: one httpFetch over the loopback
 * capture server, streaming body, abortable). The explicit named export
 * wins over the star, so only the C-host seam is substituted.
 *
 * The fs seam-collapse world (2026-11-11): the product boot's `ctx.fs` is
 * the dsh-fs cordis provider over the gateway fs primitives, and the timers
 * shim arms every setTimeout through timerSchedule/timerCancel — both ride
 * `globalThis.__dshGatewayCall`, which on the C host the host itself
 * serves. installGatewaySeams(scopeRoot) stages that seam Node-side (the
 * test/panel/spine/spine-seams.mjs precedent): the fs family over REAL node
 * fs under the granted scope root — the scope-relative POSIX rule
 * contract/primitives.md §3-§4 pins (a missing path rejects `io` naming the
 * path, an escaping path `invalid`, listings sorted by name, publish is the
 * one-step temp→rename) — and the timer seam over real node timers whose
 * fires ride the §5 channel (`__dshGatewayOnEvent`). Unstaged primitives
 * fail loud (`unimplemented`): a silent arm is exactly the starvation the
 * missing gateway produced.
 */
import {
  readFileSync, writeFileSync, mkdirSync, rmSync, renameSync,
  statSync, readdirSync, openSync, closeSync, fsyncSync,
} from 'node:fs';
import { join } from 'node:path';
// REAL node timers: the runtime's timers shim REPLACES the ambient
// setTimeout with the gateway-backed one, so arming through the global
// would recurse into this very seam.
import { setTimeout as nodeSetTimeout, clearTimeout as nodeClearTimeout } from 'node:timers';

export async function httpFetch(url, options = {}) {
  const controller = new AbortController();
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: { ...options.headers },
    body: options.body,
    signal: controller.signal,
  }).catch((error) => {
    throw Object.assign(new Error(`node httpFetch to ${url} failed: ${error?.message ?? error}`), { cause: error });
  });
  async function* body() {
    for await (const chunk of response.body) {
      yield chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    }
  }
  return { status: response.status, headers: response.headers, body: body(), abort: () => controller.abort() };
}

export * from '../../runtime/dsh/gateway.js';

// ---- the node gateway seam (the C host's __dshGatewayCall face) ----------

const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};

let gatewayFsRoot = undefined;
let publishSeq = 0;
const armedTimers = new Map();
let timerSeq = 0;

/** The granted-scope address of one primitive call: the only granted scope
 * is `app`, rooted at the staged scope root. The provider spells
 * scope-relative POSIX; an absolute spelling UNDER the granted root (the
 * in-world spelling) is accepted by stripping the root. `..` escapes
 * reject `invalid` per contract/primitives.md §3. */
const realOf = (scope, path) => {
  if (scope !== 'app') fail('denied', `gateway fs: scope ${JSON.stringify(scope)} is not granted`);
  if (typeof path !== 'string' || path.length === 0) {
    fail('invalid', 'gateway fs: path must be a non-empty string');
  }
  let rel = String(path);
  if (gatewayFsRoot !== undefined) {
    if (rel === gatewayFsRoot) rel = '';
    else if (rel.startsWith(`${gatewayFsRoot}/`)) rel = rel.slice(gatewayFsRoot.length);
  }
  rel = rel.replace(/^\/+/, '');
  if (rel.split('/').includes('..')) fail('invalid', `gateway fs: path escapes the scope: ${path}`);
  return rel.length === 0 ? gatewayFsRoot : join(gatewayFsRoot, rel);
};

/** The fs family (contract/primitives.md §4 "filesystem additions" + the
 * durable pair), one arm per primitive, over real node fs. */
const fsArms = {
  fsRead: (a) => {
    const p = realOf(a.scope, a.path);
    let st;
    let bytes;
    try {
      st = statSync(p);
      bytes = readFileSync(p);
    } catch (error) {
      fail('io', `fsRead ${a.path}: ${error?.message ?? error}`);
    }
    return { bytesB64: Buffer.from(bytes).toString('base64'), mtime: new Date(st.mtimeMs).toISOString() };
  },
  fsWrite: (a) => {
    if (typeof a.bytesB64 !== 'string') fail('invalid', 'fsWrite: bytesB64 must be a string');
    const p = realOf(a.scope, a.path);
    const bytes = Buffer.from(a.bytesB64, 'base64');
    try {
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, bytes, { flag: a.append === true ? 'a' : 'w' });
    } catch (error) {
      fail('io', `fsWrite ${a.path}: ${error?.message ?? error}`);
    }
    return { written: bytes.byteLength };
  },
  fsStat: (a) => {
    const p = realOf(a.scope, a.path);
    let st;
    try {
      st = statSync(p);
    } catch {
      fail('io', `fsStat: ${a.path} not found`);
    }
    return {
      kind: st.isFile() ? 'file' : st.isDirectory() ? 'dir' : 'other',
      size: st.isDirectory() ? 0 : Number(st.size),
      mtime: new Date(st.mtimeMs).toISOString(),
    };
  },
  fsList: (a) => {
    const p = realOf(a.scope, a.path);
    let dirents;
    try {
      dirents = readdirSync(p, { withFileTypes: true });
    } catch (error) {
      fail('io', `fsList ${a.path}: ${error?.message ?? error}`);
    }
    const entries = dirents
      .map((d) => ({ name: d.name, kind: d.isFile() ? 'file' : d.isDirectory() ? 'dir' : 'other' }))
      .sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0)); // byte order (§4)
    return { entries };
  },
  fsMkdir: (a) => {
    // Test-vehicle honesty: always mkdir -p — the contract's
    // `existing: "error"` exists refusal is not staged (no caller here
    // passes it; the C host implements the refusal).
    const p = realOf(a.scope, a.path);
    try {
      mkdirSync(p, { recursive: true });
    } catch (error) {
      fail('io', `fsMkdir ${a.path}: ${error?.message ?? error}`);
    }
    return {};
  },
  fsRemove: (a) => {
    const p = realOf(a.scope, a.path);
    try {
      rmSync(p, { recursive: a.recursive === true });
    } catch (error) {
      if (a.missing === 'error') fail('io', `fsRemove ${a.path}: ${error?.message ?? error}`);
    }
    return {};
  },
  fsRename: (a) => {
    try {
      renameSync(realOf(a.scope, a.from), realOf(a.scope, a.to));
    } catch (error) {
      fail('io', `fsRename ${a.from}: ${error?.message ?? error}`);
    }
    return {};
  },
  fsPublishAtomic: (a) => {
    if (typeof a.bytesB64 !== 'string') fail('invalid', 'fsPublishAtomic: bytesB64 must be a string');
    const p = realOf(a.scope, a.path);
    const bytes = Buffer.from(a.bytesB64, 'base64');
    const temp = `${p}.dsh-publish-${++publishSeq}`;
    try {
      // ONE step: same-directory temp → write → rename (§4 "the durable-fs
      // primitives"); the parent must exist — publish does not create it.
      // Test-vehicle honesty: the contract's fsync(file)/fsync(dir) steps
      // are skipped — same-directory rename still carries the atomicity
      // the provider's guard chain needs; durability is the C host's face.
      writeFileSync(temp, bytes);
      renameSync(temp, p);
    } catch (error) {
      try { rmSync(temp, { force: true }); } catch { /* best-effort */ }
      fail('io', `fsPublishAtomic ${a.path}: ${error?.message ?? error}`);
    }
    return { written: bytes.byteLength };
  },
  fsSync: (a) => {
    const p = realOf(a.scope, a.path);
    let st;
    let fd;
    try {
      st = statSync(p);
      const isDir = st.isDirectory();
      if ((a.kind === 'dir') !== isDir) {
        fail('io', `fsSync ${a.path}: kind ${JSON.stringify(a.kind)} does not match the path`);
      }
      fd = openSync(p, isDir ? 'r' : 'r+');
      fsyncSync(fd);
    } catch (error) {
      fail('io', `fsSync ${a.path}: ${error?.message ?? error}`);
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    return {};
  },
};

/** Stage the node gateway seam: the timer pair over real node timers (fires
 * ride the §5 channel the gateway shim dispatches) plus the fs family over
 * real fs under `scopeRoot`. Timers are unref'd — the seam never holds the
 * driver's event loop open (the driver's control flow ends the process). */
export const installGatewaySeams = (scopeRoot) => {
  gatewayFsRoot = scopeRoot;
  globalThis.__dshGatewayCall = async (name, argsJson) => {
    const args = argsJson === undefined ? {} : JSON.parse(argsJson);
    if (name === 'timerSchedule') {
      const timerId = ++timerSeq;
      const t = nodeSetTimeout(() => {
        armedTimers.delete(timerId);
        globalThis.__dshGatewayOnEvent?.(JSON.stringify({ event: 'timer.fire', timerId }));
      }, Math.max(0, Number(args.delayMs) || 0));
      t.unref?.();
      armedTimers.set(timerId, t);
      return { timerId };
    }
    if (name === 'timerCancel') {
      const t = armedTimers.get(args.timerId);
      if (t !== undefined) {
        nodeClearTimeout(t);
        armedTimers.delete(args.timerId);
      }
      return {};
    }
    const arm = fsArms[name];
    if (arm !== undefined) return arm(args);
    fail('unimplemented', `gateway ${name} is not staged node-side (session-preset-join)`);
  };
};
