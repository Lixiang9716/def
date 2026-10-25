// dsh:logging-exempt (node-side driver: console IS the product)
/**
 * host-gateway.mjs — the recording seat's HOST gateway primitives: the fs
 * family + keychain the vendored packages reach through
 * globalThis.__dshGatewayCall when the plugin plane writes (the device C
 * host implements these natively; the panel's spine-seams loud-fails them
 * by design). Paths are scope-relative POSIX, refused on escape (the
 * gateway-audit invariant); scope 'app' is the only granted scope.
 */
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { join, resolve, dirname, sep } = require_('node:path');
const fs = require_('node:fs');

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

/** Resolve one scope-relative POSIX path under the scope root, or fail.
 * Not-found rides code 'io' — the device host's spelling, and the only
 * code the runtime reads as the fresh-roster answer. */
const locate = (root, scope, path) => {
  if (scope !== 'app') fail('denied', `gateway fs: scope ${JSON.stringify(scope)} is not granted`);
  if (typeof path !== 'string' || path.length === 0) fail('invalid', 'gateway fs: path must be a non-empty string');
  const full = resolve(root, `./${path.replaceAll('/', sep)}`);
  if (full !== root && !full.startsWith(root + sep)) fail('invalid', `gateway fs: path escapes the scope: ${path}`);
  return full;
};

const kindOf = (full) => {
  try {
    return fs.statSync(full).isDirectory() ? 'dir' : 'file';
  } catch {
    return undefined;
  }
};

const readArms = (root) => {
  const at = (scope, path) => locate(root, scope, path);
  return {
    fsRead: (a) => {
      const full = at(a.scope, a.path);
      if (kindOf(full) !== 'file') fail('io', `fsRead: ${a.path} is not a file`);
      return { bytesB64: fs.readFileSync(full).toString('base64'), mtime: fs.statSync(full).mtimeMs };
    },
    fsStat: (a) => {
      const full = at(a.scope, a.path);
      const kind = kindOf(full);
      if (kind === undefined) fail('io', `fsStat: ${a.path} not found`);
      return { kind, size: fs.statSync(full).size, mtime: fs.statSync(full).mtimeMs };
    },
    fsList: (a) => {
      const full = at(a.scope, a.path);
      if (kindOf(full) !== 'dir') fail('io', `fsList: ${a.path} is not a directory`);
      const entries = fs.readdirSync(full, { withFileTypes: true })
        .sort((x, y) => x.name.localeCompare(y.name))
        .map((e) => ({ name: e.name, kind: e.isDirectory() ? 'dir' : 'file' }));
      return { entries };
    },
    keychainGet: (a) => {
      const file = join(root, '.keychain', `${a.ref}.b64`);
      return fs.existsSync(file) ? { secretB64: fs.readFileSync(file, 'utf8') } : null;
    },
  };
};

const writeArms = (root) => {
  const at = (scope, path) => locate(root, scope, path);
  return {
    fsWrite: (a) => {
      const full = at(a.scope, a.path);
      const bytes = typeof a.bytesB64 === 'string'
        ? Buffer.from(a.bytesB64, 'base64') : fail('invalid', 'fsWrite: bytesB64 must be a string');
      fs.mkdirSync(dirname(full), { recursive: true });
      if (a.append === true) fs.appendFileSync(full, bytes);
      else if (a.create === false && !fs.existsSync(full)) fail('io', `fsWrite: ${a.path} does not exist`);
      else fs.writeFileSync(full, bytes);
      return { written: bytes.length };
    },
    fsMkdir: (a) => {
      fs.mkdirSync(at(a.scope, a.path), { recursive: true });
      return {};
    },
    fsRemove: (a) => {
      const full = at(a.scope, a.path);
      if (!fs.existsSync(full)) {
        if (a.missing === 'error') fail('io', `fsRemove: ${a.path} not found`);
        return { removed: false };
      }
      fs.rmSync(full, { recursive: a.recursive === true });
      return { removed: true };
    },
    fsRename: (a) => {
      const to = at(a.scope, a.to);
      fs.mkdirSync(dirname(to), { recursive: true });
      fs.renameSync(at(a.scope, a.from), to);
      return {};
    },
    keychainSet: (a) => {
      fs.mkdirSync(join(root, '.keychain'), { recursive: true });
      fs.writeFileSync(join(root, '.keychain', `${a.ref}.b64`), String(a.secretB64 ?? ''));
      return {};
    },
    // The mount checkpoint (plugin-mount.js §4): a native dialog on hosts
    // that present one. The seat has no dialog surface — the owner-driven
    // recording harness approves loudly instead; `{approved: false}` is the
    // user-dismissal value the mount refuses on, never a seat answer.
    presentApproval: (a) => {
      console.log(`[real-seat] approval auto-approved: ${a?.title ?? ''}`);
      return { approved: true };
    },
  };
};

const scopeArms = (root) => ({
  'fsScope.persist': () => ({}),
  'fsScope.resolve': (a) => ({ path: join(root, 'bookmarks', String(a.ref ?? '').replace(/^bkm:/, '')) }),
});

/** The REAL proc seams (the toolface runners' shape): this seat's fs IS
 * the host disk, so the shims' metadata/read fallbacks answer truthfully
 * for files created outside the runtime. */
export const installProcSeams = () => {
  globalThis.__dshProcStatReal = (p) => {
    try {
      const st = fs.statSync(p);
      return {
        isFile: st.isFile(), isSymbolicLink: st.isSymbolicLink(),
        size: Number(st.size), mode: Number(st.mode),
        mtimeMs: Math.trunc(Number(st.mtimeMs)),
      };
    } catch { return null; }
  };
  globalThis.__dshProcReaddirReal = (p) => {
    try { return fs.readdirSync(p); } catch { return null; }
  };
  globalThis.__dshProcReadReal = (p) => {
    try { return fs.readFileSync(p).toString('base64'); } catch { return null; }
  };
};

export const installHostGateway = (scopeRoot) => {
  fs.mkdirSync(scopeRoot, { recursive: true });
  const arms = { ...readArms(scopeRoot), ...writeArms(scopeRoot), ...scopeArms(scopeRoot) };
  const orig = globalThis.__dshGatewayCall;
  globalThis.__dshGatewayCall = async (name, argsJson) => {
    const arm = arms[name];
    if (arm !== undefined) return arm(JSON.parse(argsJson));
    return orig(name, argsJson);
  };
};
