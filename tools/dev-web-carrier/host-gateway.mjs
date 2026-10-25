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
const { join } = require_('node:path');

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

/** The REAL proc seams (the toolface runners' shape): this seat's fs IS
 * the host disk, so the shims' metadata/read fallbacks answer truthfully
 * for files created outside the runtime. */
export const installProcSeams = () => {
  const nodeFs = require_('node:fs');
  globalThis.__dshProcStatReal = (p) => {
    try {
      const st = nodeFs.statSync(p);
      return {
        isFile: st.isFile(), isSymbolicLink: st.isSymbolicLink(),
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
    try {
      return require_('node:fs').readFileSync(require_('node:path').join(runtimeDsh, `${dir}/${rel}`.replace(/^\//, '')), 'utf8');
    } catch (error) {
      throw Object.assign(new Error(`bundle-read miss: ${error?.message ?? error}`), { code: 'io' });
    }
  };
};

export const installHostGateway = async (repoRoot, wsRoot) => {
  // The SAME module instance the runtime's loader hands out (the seat's
  // registered hooks map this exact file URL for the runtime's imports).
  const shimFs = await import(pathToFileURL(join(repoRoot, 'runtime/dsh/upstream/shims/fs.js')).href);
  const keychain = new Map();

  const appPath = (scope, path) => {
    if (scope !== 'app') fail('denied', `gateway fs: scope ${JSON.stringify(scope)} is not granted`);
    if (typeof path !== 'string' || path.length === 0) fail('invalid', 'gateway fs: path must be a non-empty string');
    if (path.includes('..')) fail('invalid', `gateway fs: path escapes the scope: ${path}`);
    return join(wsRoot, 'app-scope', path);
  };

  const readArms = {
    fsRead: (a) => {
      const full = appPath(a.scope, a.path);
      let bytes;
      try { bytes = shimFs.readFileSync(full); } catch (e) { fail('io', `fsRead: ${e?.message ?? e}`); }
      return { bytesB64: Buffer.from(bytes).toString('base64'), mtime: 0 };
    },
    fsStat: (a) => {
      const full = appPath(a.scope, a.path);
      let st;
      try { st = shimFs.statSync(full); } catch { fail('io', `fsStat: ${a.path} not found`); }
      return { kind: st.isDirectory() ? 'dir' : 'file', size: Number(st.size), mtime: Number(st.mtimeMs) };
    },
    fsList: (a) => {
      const full = appPath(a.scope, a.path);
      let list;
      try {
        list = shimFs.readdirSync(full, { withFileTypes: true })
          .sort((x, y) => x.name.localeCompare(y.name))
          .map((e) => ({ name: e.name, kind: e.isDirectory() ? 'dir' : 'file' }));
      } catch (e) { fail('io', `fsList: ${e?.message ?? e}`); }
      return { entries: list };
    },
    keychainGet: (a) => {
      const raw = keychain.get(a.ref);
      return raw !== undefined ? { secretB64: raw } : null;
    },
  };

  const writeArms = {
    fsWrite: (a) => {
      if (a.scope !== 'app') fail('denied', `gateway fs: scope ${JSON.stringify(a.scope)} is not granted`);
      if (typeof a.bytesB64 !== 'string') fail('invalid', 'fsWrite: bytesB64 must be a string');
      const bytes = Buffer.from(a.bytesB64, 'base64');
      const full = appPath(a.scope, a.path);
      shimFs.mkdirSync(join(full, '..'), { recursive: true });
      shimFs.writeFileSync(full, bytes);
      return { written: bytes.length };
    },
    fsMkdir: (a) => {
      shimFs.mkdirSync(appPath(a.scope, a.path), { recursive: true });
      return {};
    },
    fsRemove: (a) => {
      const full = appPath(a.scope, a.path);
      try {
        shimFs.rmSync(full, { recursive: a.recursive === true });
      } catch (e) {
        if (a.missing === 'error') fail('io', `fsRemove: ${e?.message ?? e}`);
      }
      return {};
    },
    fsRename: (a) => {
      shimFs.renameSync(appPath(a.scope, a.from), appPath(a.scope, a.to));
      return {};
    },
    keychainSet: (a) => {
      keychain.set(a.ref, String(a.secretB64 ?? ''));
      return {};
    },
    presentApproval: (a) => {
      console.log(`[real-seat] approval auto-approved: ${a?.title ?? ''}`);
      return { approved: true };
    },
  };

  const orig = globalThis.__dshGatewayCall;
  globalThis.__dshGatewayCall = async (name, argsJson) => {
    const arm = readArms[name] ?? writeArms[name];
    if (arm !== undefined) return arm(JSON.parse(argsJson));
    return orig(name, argsJson);
  };
};
