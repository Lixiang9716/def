// dsh:logging-exempt (node-side driver: console IS the product)
/**
 * host-gateway.mjs — the recording seat's HOST gateway primitives, UNIFIED
 * on the runtime's own shim world: the fs family + keychain the vendored
 * packages reach through globalThis.__dshGatewayCall delegate to the SAME
 * upstream/shims/fs.js module instance the runtime uses, so the jsshell
 * applets, the model's file tools, and the plugin-mount registry all see
 * ONE file world. (The 2026-10-26 split: the shell applets read real disk
 * through this module while the write tool wrote the shim mirror — two
 * inconsistent worlds the model diagnosed as "不同的文件系统".)
 *
 * Scope 'app' maps to <workspace>/app-scope in the shim's workspace
 * spelling; the shim's own root pin + read twins enforce containment and
 * serve real disk. The mount pipeline's registry writes ride the same
 * face, so a mount survives restarts through the shim's wsMirrorWriteReal.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require_ = createRequire(import.meta.url);
const nodeFs = require_('node:fs');
const { join, dirname } = require_('node:path');

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

/** The REAL proc seams (the toolface runners' shape): this seat's fs IS
 * the host disk, so the shims' metadata/read fallbacks answer truthfully
 * for files created outside the runtime. */
export const installProcSeams = (wsRoot) => {
  const nodeFs = require_('node:fs');
  // The write-tool's mirror flushes to real disk through this seam (the
  // canonical path is workspace-rooted — prefix it with the real root).
  globalThis.__dshProcWriteFileReal = (p, b64) => {
    // The shim's canonical arrives pinned-root-prefixed when the workspace
    // was mounted with the real absolute root (this seat's spelling) — take
    // it verbatim; a workspace-rooted '/foo' spelling gets the wsRoot prefix.
    const full = p.startsWith(wsRoot) ? p : join(wsRoot, p);
    nodeFs.mkdirSync(dirname(full), { recursive: true });
    nodeFs.writeFileSync(full, Buffer.from(b64, 'base64'));
  };
  // The mirror siblings (rm/chmod/mkdir keep the real disk from drifting
  // off the VFS — the staging-dir cleanup, the mode mirrors, explicit mkdirs).
  const realOf = (p) => (p.startsWith(wsRoot) ? p : join(wsRoot, p));
  globalThis.__dshProcRmReal = (p, recursive) => {
    try { nodeFs.rmSync(realOf(p), { recursive: recursive === true, force: true }); } catch { /* best-effort */ }
  };
  globalThis.__dshProcChmodReal = (p, mode) => {
    try { nodeFs.chmodSync(realOf(p), mode); } catch { /* best-effort */ }
  };
  globalThis.__dshProcMkdirReal = (p) => {
    try { nodeFs.mkdirSync(realOf(p), { recursive: true }); } catch { /* best-effort */ }
  };
  globalThis.__dshProcAccessReal = (p) => {
    try { nodeFs.accessSync(realOf(p)); return true; } catch { return false; }
  };
  globalThis.__dshProcStatReal = (p) => {
    try {
      const st = nodeFs.statSync(p);
      return {
        isFile: st.isFile(), isDirectory: st.isDirectory(),
        isSymbolicLink: st.isSymbolicLink(),
        size: Number(st.size), mode: Number(st.mode),
        mtimeMs: Math.trunc(Number(st.mtimeMs)),
      };
    } catch { return null; }
  };
  globalThis.__dshProcReaddirReal = (p) => {
    try { return nodeFs.readdirSync(p); } catch { return null; }
  };
  globalThis.__dshProcReadReal = (p) => {
    try { return nodeFs.readFileSync(p).toString('base64'); } catch { return null; }
  };
};

/** The shell applets' vendor reader (the shelljs/minimatch tree): the
 * device spelling is '/vendor/…' under the runtime root — read there. */
export const installBundleSeam = (runtimeDsh) => {
  globalThis.__dshBundleRequire = (base, request) => {
    const dir = base.slice(0, base.lastIndexOf('/'));
    const rel = request.replace(/^\.\//, '');
    // Under Node the parser hands a REAL absolute base (import.meta.dirname
    // spelling); device callers hand the '/vendor/…' specifier-space (the
    // leading slash is VIRTUAL — relative to the runtime root). Only a base
    // under the real runtime tree reads verbatim.
    const realTree = base.startsWith(`${runtimeDsh}/`) || base === runtimeDsh;
    const target = realTree
      ? `${dir}/${rel}`
      : require_('node:path').join(runtimeDsh, `${dir}/${rel}`.replace(/^\//, ''));
    try {
      return require_('node:fs').readFileSync(target, 'utf8');
    } catch (error) {
      throw Object.assign(new Error(`bundle-read miss: ${error?.message ?? error}`), { code: 'io' });
    }
  };
};

const appPathOf = (root, scope, path) => {
  if (scope !== 'app') fail('denied', `gateway fs: scope ${JSON.stringify(scope)} is not granted`);
  if (typeof path !== 'string' || path.length === 0) fail('invalid', 'gateway fs: path must be a non-empty string');
  if (path.includes('..')) fail('invalid', `gateway fs: path escapes the scope: ${path}`);
  return join(root, 'app-scope', path);
};

/** The read-side arms over the shim fs (same module instance as the runtime). */
const readArms = (shimFs, wsRoot) => {
  const at = (scope, path) => appPathOf(wsRoot, scope, path);
  return {
    fsRead: (a) => {
      let bytes;
      try { bytes = shimFs.readFileSync(at(a.scope, a.path)); } catch (e) { fail('io', `fsRead: ${e?.message ?? e}`); }
      return { bytesB64: Buffer.from(bytes).toString('base64'), mtime: 0 };
    },
    fsStat: (a) => {
      let st;
      try { st = shimFs.statSync(at(a.scope, a.path)); } catch { fail('io', `fsStat: ${a.path} not found`); }
      return { kind: st.isDirectory() ? 'dir' : 'file', size: Number(st.size), mtime: Number(st.mtimeMs) };
    },
    fsList: (a) => {
      let list;
      try {
        list = shimFs.readdirSync(at(a.scope, a.path), { withFileTypes: true })
          .sort((x, y) => x.name.localeCompare(y.name))
          .map((e) => ({ name: e.name, kind: e.isDirectory() ? 'dir' : 'file' }));
      } catch (e) { fail('io', `fsList: ${e?.message ?? e}`); }
      return { entries: list };
    },
    keychainGet: () => null,
  };
};

/** The pending in-band approvals: id → resolver. The presentApproval arm
 * parks here while the page's approval card waits for the user; the
 * approval/decide endpoint (real-seat handleApi) completes it. */
const pendingApprovals = new Map();
let approvalSeq = 0;

/** The write-side arms + the mount checkpoint — the checkpoint is IN-BAND:
 * the ask rides the app/cards mux channel to the page (the card the user
 * answers lives in the conversation), and the arm settles on the page's
 * decision. No page subscriber (headless boot) → auto-approve after the
 * grace timeout, loudly, exactly the old posture. */
const writeArms = (shimFs, wsRoot) => {
  const at = (scope, path) => appPathOf(wsRoot, scope, path);
  return {
    fsWrite: (a) => {
      if (typeof a.bytesB64 !== 'string') fail('invalid', 'fsWrite: bytesB64 must be a string');
      const bytes = Buffer.from(a.bytesB64, 'base64');
      const full = at(a.scope, a.path);
      shimFs.mkdirSync(join(full, '..'), { recursive: true });
      shimFs.writeFileSync(full, bytes);
      return { written: bytes.length };
    },
    fsMkdir: (a) => { shimFs.mkdirSync(at(a.scope, a.path), { recursive: true }); return {}; },
    fsRemove: (a) => {
      try { shimFs.rmSync(at(a.scope, a.path), { recursive: a.recursive === true }); } catch { return { removed: false }; }
      return { removed: true };
    },
    fsRename: (a) => { shimFs.renameSync(at(a.scope, a.from), at(a.scope, a.to)); return {}; },
    keychainSet: () => ({}),
    presentApproval: (a) => {
      const id = `approval-${++approvalSeq}-${Date.now()}`;
      const ask = {
        type: 'approval.request', id,
        title: a?.title ?? '插件挂载',
        reason: a?.reason ?? a?.detail ?? '',
      };
      return new Promise((resolve) => {
        pendingApprovals.set(id, resolve);
        globalThis.__dshEmitApproval?.(ask);
        setTimeout(() => {
          if (!pendingApprovals.has(id)) return;
          pendingApprovals.delete(id);
          console.log(`[real-seat] approval ${id} auto-approved (no page answer in 120s): ${a?.title ?? ''}`);
          resolve({ approved: true });
        }, 120_000).unref?.();
      });
    },
  };
};

/** The approval/decide endpoint's resolver: completes the parked arm and
 * tells the page the decision landed. False = no such pending ask. */
export const decideApproval = (id, approved) => {
  const resolve = pendingApprovals.get(id);
  if (resolve === undefined) return false;
  pendingApprovals.delete(id);
  resolve({ approved: approved === true });
  return true;
};

export const installHostGateway = async (repoRoot, wsRoot) => {
  // The SAME module instance the runtime's loader hands out (the seat's
  // registered hooks map this exact file URL for the runtime's imports).
  const shimFs = await import(pathToFileURL(join(repoRoot, 'runtime/dsh/upstream/shims/fs.js')).href);
  const arms = { ...readArms(shimFs, wsRoot), ...writeArms(shimFs, wsRoot) };
  const orig = globalThis.__dshGatewayCall;
  globalThis.__dshGatewayCall = async (name, argsJson) => {
    const arm = arms[name];
    if (arm !== undefined) return arm(JSON.parse(argsJson));
    return orig(name, argsJson);
  };
  // TEMP trace (2026-10-26): one line per gateway fsWrite while the
  // write-through seam is under verification.
  const traced = globalThis.__dshGatewayCall;
  globalThis.__dshGatewayCall = async (name, argsJson) => {
    if (name === 'fsWrite') console.log(`[gw] fsWrite path=${JSON.parse(argsJson)?.path}`);
    return traced(name, argsJson);
  };
};
