// gateway-shim.js — the panel suite's gateway.js: the wasmRun leg EXECUTES,
// the fs legs carry an in-memory workspace.
//
// The wasmRun shim is a byte-faithful mirror of the C runner the device
// serves (src/dsh_wasm.c): the caller's input rides the LAST
// 4096 bytes of the module's own memory as a NUL-terminated string, the
// export `run(ptr, len)` receives (pointer, length), dsh.emit(ptr, len)
// appends to the collected output, and the export's i32 return is the
// result. Node's own WebAssembly plays the interpreter — the vendored wasm3
// plays it on the device — so a program that behaves differently under this
// shim than under dsh_wasm.c is a broken module, and the suite catches it
// here rather than on a seat.
//
// The fs face is the contract's shape over one Map: fsRead answers
// `{bytes, mtime}` and refuses a missing path with the EXACT rejection the
// C hosts answer (`io` + "cannot read <path>") — the message the shell
// executor's not-found branch matches on.
import { createHash } from 'node:crypto';

export class GatewayError extends Error {
  constructor(code, primitive, message) {
    super(message ?? `gateway ${primitive} failed (${code})`);
    this.name = 'GatewayError';
    this.code = code;
    this.primitive = primitive;
  }
}

/** The in-memory workspace: (scope, path) → Uint8Array. Tests seed it
 * directly; the starter writes land here too. */
export const workspace = new Map();

export const fsRead = async (scope, path) => {
  const bytes = workspace.get(`${scope}/${path}`);
  if (!bytes) throw new GatewayError('io', 'fsRead', `cannot read ${path}`);
  return { bytes, mtime: new Date(0).toISOString() };
};

export const fsWrite = async (scope, path, bytes, opts = {}) => {
  const key = `${scope}/${path}`;
  // A directory target is an io failure on every real host — the shell
  // suite's redirect-flush failure leg depends on this semantics.
  if (workspace.get(key)?.dir === true) {
    throw new GatewayError('io', 'fsWrite', `cannot write ${path}: Is a directory`);
  }
  // {append: true} is the receipts journal's primitive (append-only lines —
  // the §4 journal is never rewritten).
  if (opts.append === true && workspace.has(key)) {
    const prev = workspace.get(key);
    const merged = new Uint8Array(prev.length + bytes.length);
    merged.set(prev, 0);
    merged.set(bytes, prev.length);
    workspace.set(key, merged);
    return { written: bytes.length };
  }
  workspace.set(key, bytes);
  return { written: bytes.length };
};

export const fsRemove = async (scope, path, opts = {}) => {
  const prefix = `${scope}/${path}/`;
  let removed = 0;
  for (const key of [...workspace.keys()]) {
    if (key === `${scope}/${path}` || (opts.recursive === true && key.startsWith(prefix))) {
      workspace.delete(key);
      removed++;
    }
  }
  // missing:"ok" is the contract default (rm -f rides it); the historical
  // io throw stays for callers that ask to be told about a miss.
  if (removed === 0 && opts.missing !== 'ok') {
    throw new GatewayError('io', 'fsRemove', `cannot read ${path}`);
  }
  return { removed };
};

// The v1.1.0 filesystem additions (contract primitives.md §4 "filesystem
// additions") — the legs the dsh-shell-js plugin's seven-fs manifest
// exercises. Semantics follow the frozen contract exactly: fsStat's io
// miss names the path, fsList is one level in byte order, fsMkdir is
// recursive with existing:"ok", fsRename replaces an existing target and
// moves a directory WITH its subtree. Ancestor directories that were never
// inserted explicitly still exist here (they do on every host — the scope
// root is the profile container), so stat/list synthesize them as dirs
// when children are present.

const childKeysOf = (key) => {
  const prefix = `${key}/`;
  return [...workspace.keys()].filter((k) => k.startsWith(prefix));
};

export const fsStat = async (scope, path) => {
  const key = `${scope}/${path}`;
  const entry = workspace.get(key);
  if (entry === undefined) {
    if (childKeysOf(key).length > 0) return { kind: 'dir', size: 0, mtime: new Date(0).toISOString() };
    // The contract's answer for a missing path is kind "other", not an io
    // rejection (main_cli.c's fsStat records the semantics; the device
    // hosts match). This double used to throw io, which let the snapshot's
    // kind:null arm answer for every reader while the real gateway's
    // "other" arm crashed — the divergence hid the wild-refusal class the
    // 2026-10-13 standing loop caught. Keep the double honest.
    return { kind: 'other', size: 0, mtime: '' };
  }
  if (entry.dir === true) return { kind: 'dir', size: 0, mtime: new Date(0).toISOString() };
  return { kind: 'file', size: entry.length, mtime: new Date(0).toISOString() };
};

export const fsList = async (scope, path) => {
  const base = `${scope}/${path}`;
  const names = new Set();
  for (const key of childKeysOf(base)) {
    const rest = key.slice(base.length + 1);
    if (rest.length > 0) names.add(rest.split('/')[0]);
  }
  if (names.size === 0 && workspace.get(base) === undefined && childKeysOf(base).length === 0) {
    throw new GatewayError('io', 'fsList', `cannot list ${path}`);
  }
  // Byte order per contract (deterministic across hosts).
  const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    entries: sorted.map((name) => {
      const entry = workspace.get(`${base}/${name}`);
      const kind = entry?.dir === true || childKeysOf(`${base}/${name}`).length > 0
        ? 'dir' : 'file';
      return { name, kind };
    }),
  };
};

export const fsMkdir = async (scope, path, _opts = {}) => {
  // Recursive with existing:"ok" is the default — parents are implicit in
  // the Map the same way ancestors are synthesized above.
  workspace.set(`${scope}/${path}`, { dir: true });
  return {};
};

export const fsRename = async (scope, from, to) => {
  const fromKey = `${scope}/${from}`;
  const toKey = `${scope}/${to}`;
  const entry = workspace.get(fromKey);
  if (entry === undefined && childKeysOf(fromKey).length === 0) {
    throw new GatewayError('io', 'fsRename', `cannot rename ${from}: no such file`);
  }
  // POSIX rename: an existing target is replaced; a moved directory takes
  // its whole subtree with it.
  if (workspace.get(fromKey)?.dir === true || (workspace.get(fromKey) === undefined && childKeysOf(fromKey).length > 0)) {
    for (const key of childKeysOf(fromKey)) {
      workspace.set(`${toKey}${key.slice(fromKey.length)}`, workspace.get(key));
      workspace.delete(key);
    }
  }
  if (entry !== undefined) {
    workspace.delete(fromKey);
    workspace.set(toKey, entry);
  }
  return {};
};

/** The http face for the install legs: routes the TEST installs per url —
 * the same `{status, body: AsyncIterable<Uint8Array>}` response shape the
 * C host serves (install-fetch.js drains the body as an async iterable). */
const httpRoutes = new Map(); // url → {status, bodyBytes}

export const __httpRoute = (url, bodyBytes, status = 200) => {
  httpRoutes.set(url, { status, bodyBytes });
};

export const __httpReset = () => httpRoutes.clear();

/** Test-side read of one stored file (the full `scope/path` key). */
export const __dump = (key) => workspace.get(key);

export const httpFetch = async (url, opts = {}) => {
  const route = httpRoutes.get(url);
  if (route === undefined) throw new GatewayError('network', 'httpFetch', `no route: ${url}`);
  return {
    status: route.status,
    body: (async function* served() { yield route.bodyBytes; })(),
  };
};

export const wasmRun = async (scope, path, func, input = '') => {
  const bytes = workspace.get(`${scope}/${path}`);
  if (!bytes) throw new GatewayError('io', 'wasmRun', `cannot read ${path}`);
  const instance = new WebAssembly.Instance(
    new WebAssembly.Module(bytes),
    { dsh: { emit: (ptr, len) => {
      const mem = new Uint8Array(instance.exports.memory.buffer);
      out.push(mem.slice(ptr, ptr + len));
    } } },
  );
  const out = [];
  const mem = new Uint8Array(instance.exports.memory.buffer);
  const RESERVE = 4096; // dsh_wasm.c's DSH_WASM_INPUT_RESERVE
  if (mem.length <= RESERVE) throw new GatewayError('io', 'wasmRun', 'module memory too small');
  const inPtr = mem.length - RESERVE;
  const text = new TextEncoder().encode(input);
  if (text.length > RESERVE - 1) throw new GatewayError('io', 'wasmRun', 'input too large');
  mem.set(text, inPtr);
  mem[inPtr + text.length] = 0;
  const run = instance.exports[func];
  if (typeof run !== 'function') {
    throw new GatewayError('io', 'wasmRun', `no export "${func}"`);
  }
  const result = run(inPtr, text.length);
  const merged = new Uint8Array(out.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of out) { merged.set(chunk, at); at += chunk.length; }
  return { result, output: new TextDecoder().decode(merged) };
};

/** The sha256 the byte pins are stated in (programs.js PINS). */
export const sha256Hex = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');
