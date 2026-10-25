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

/** Resolve one scope-relative POSIX path under the scope root, or fail. */
const locate = (scopeRoot, scope, path) => {
  if (scope !== 'app') fail('denied', `gateway fs: scope ${JSON.stringify(scope)} is not granted`);
  if (typeof path !== 'string' || path.length === 0) fail('invalid', 'gateway fs: path must be a non-empty string');
  const full = resolve(scopeRoot, `./${path.replaceAll('/', sep)}`);
  if (full !== scopeRoot && !full.startsWith(scopeRoot + sep)) fail('invalid', `gateway fs: path escapes the scope: ${path}`);
  return full;
};

const kindOf = (full) => {
  let st;
  try { st = fs.statSync(full); } catch { return undefined; }
  return st.isDirectory() ? 'dir' : 'file';
};

export const installHostGateway = (scopeRoot, httpFetchArm) => {
  fs.mkdirSync(scopeRoot, { recursive: true });
  const arms = {
    fsRead: (a) => {
      const full = locate(scopeRoot, a.scope, a.path);
      const kind = kindOf(full);
      if (kind !== 'file') fail('not-found', `fsRead: ${a.path} is not a file`);
      const bytes = fs.readFileSync(full);
      return { bytesB64: bytes.toString('base64'), mtime: fs.statSync(full).mtimeMs };
    },
    fsWrite: (a) => {
      const full = locate(scopeRoot, a.scope, a.path);
      fs.mkdirSync(dirname(full), { recursive: true });
      const bytes = typeof a.bytesB64 === 'string' ? Buffer.from(a.bytesB64, 'base64') : fail('invalid', 'fsWrite: bytesB64 must be a string');
      if (a.append === true) fs.appendFileSync(full, bytes);
      else if (a.create === false && !fs.existsSync(full)) fail('not-found', `fsWrite: ${a.path} does not exist`);
      else fs.writeFileSync(full, bytes);
      return { written: bytes.length };
    },
    fsStat: (a) => {
      const full = locate(scopeRoot, a.scope, a.path);
      const kind = kindOf(full);
      if (kind === undefined) fail('not-found', `fsStat: ${a.path} not found`);
      return { kind, size: fs.statSync(full).size, mtime: fs.statSync(full).mtimeMs };
    },
    fsList: (a) => {
      const full = locate(scopeRoot, a.scope, a.path);
      const kind = kindOf(full);
      if (kind !== 'dir') fail('not-found', `fsList: ${a.path} is not a directory`);
      const entries = fs.readdirSync(full, { withFileTypes: true })
        .sort((x, y) => x.name.localeCompare(y.name))
        .map((e) => ({ name: e.name, kind: e.isDirectory() ? 'dir' : 'file' }));
      return { entries };
    },
    fsMkdir: (a) => {
      const full = locate(scopeRoot, a.scope, a.path);
      fs.mkdirSync(full, { recursive: true });
      return {};
    },
    fsRemove: (a) => {
      const full = locate(scopeRoot, a.scope, a.path);
      if (!fs.existsSync(full)) {
        if (a.missing === 'error') fail('not-found', `fsRemove: ${a.path} not found`);
        return { removed: false };
      }
      fs.rmSync(full, { recursive: a.recursive === true });
      return { removed: true };
    },
    fsRename: (a) => {
      const from = locate(scopeRoot, a.scope, a.from);
      const to = locate(scopeRoot, a.scope, a.to);
      fs.mkdirSync(dirname(to), { recursive: true });
      fs.renameSync(from, to);
      return {};
    },
    'fsScope.persist': () => ({}),
    'fsScope.resolve': (a) => ({ path: join(scopeRoot, 'bookmarks', String(a.ref ?? '').replace(/^bkm:/, '')) }),
    keychainGet: (a) => {
      const file = join(scopeRoot, '.keychain', `${a.ref}.b64`);
      if (!fs.existsSync(file)) return null;
      return { secretB64: fs.readFileSync(file, 'utf8') };
    },
    keychainSet: (a) => {
      fs.mkdirSync(join(scopeRoot, '.keychain'), { recursive: true });
      fs.writeFileSync(join(scopeRoot, '.keychain', `${a.ref}.b64`), String(a.secretB64 ?? ''));
      return {};
    },
  };
  const orig = globalThis.__dshGatewayCall;
  globalThis.__dshGatewayCall = async (name, argsJson) => {
    const arm = arms[name];
    if (arm !== undefined) return arm(JSON.parse(argsJson));
    return orig(name, argsJson);
  };
};
