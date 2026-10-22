// dsh:logging-exempt (shim layer; specifier registration, no logging surface)
/** shims/node-module-resolve.js — the resolve() face, split from
 * node-module.js when the exports-map subpath support crossed the
 * function-size budget (2026-10-22). makeResolveFace(base) answers from the
 * staged fs view; the face's contracts live at the call site's header. */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';


const baseDirOf = (base) => {
  let p = base.startsWith('file:') ? fileURLToPath(base) : base;
  const isDirectory = /\/$/.test(p);
  p = p.replace(/\/+$/, '');
  if (isDirectory) return p === '' ? '/' : p;
  const cut = p.lastIndexOf('/');
  return cut > 0 ? p.slice(0, cut) : '/';
};

const resolvePathsFor = (base) => {
  const dirs = [];
  let current = baseDirOf(base);
  for (;;) {
    dirs.push(`${current}/node_modules`);
    if (current === '/' || current.length === 0) break;
    const cut = current.lastIndexOf('/');
    current = cut > 0 ? current.slice(0, cut) : '/';
  }
  return dirs;
};

/** node resolve() answers a request RELATIVE to the base's directory too
 * ('./main.js' from a manifest-owner validation); the staged view answers
 * the existing file or nothing. */
const resolveRelative = (base, request) => {
  if (!request.startsWith('./') && !request.startsWith('../')) return undefined;
  const baseDir = base.replace(/\/[^/]*$/, '');
  const parts = [];
  for (const seg of `${baseDir}/${request}`.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  const candidate = `/${parts.join('/')}`;
  return existsSync(candidate) ? candidate : undefined;
};

/** The manifest's answer for one subpath: the exports map when the package
 * carries one, else main for the root request. A subpath the exports map
 * does not name is a MISS (node's ERR_MODULE_NOT_FOUND shape) — answering
 * the package root instead would turn every unresolvable subpath row into
 * a mount (the typert loader's skip test). */
const manifestEntryFor = (dir, pkg, sub) => {
  const manifest = `${dir}/${pkg}/package.json`;
  if (!existsSync(manifest)) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(manifest, 'utf8'));
  } catch {
    return sub === null ? manifest : undefined;
  }
  if (sub !== null) {
    let target = parsed.exports?.[`./${sub}`];
    if (target === undefined) return undefined;
    if (typeof target !== 'string') target = target.default;
    const candidate = `${dir}/${pkg}/${String(target).replace(/^\.\//, '')}`;
    return existsSync(candidate) ? candidate : undefined;
  }
  // Real Node resolve() answers the package ENTRY, not the manifest —
  // callers import fileURL(resolve(specifier)) and importing a manifest
  // dies on the host loader (the typert loader row). An unparseable or
  // entry-less manifest answers itself.
  try {
    const main = String(parsed.main ?? 'index.js').replace(/^\.\//, '');
    const candidate = `${dir}/${pkg}/${main}`;
    if (existsSync(candidate)) return candidate;
  } catch { /* fall through — answer the manifest */ }
  return manifest;
};

/** require.resolve — the plugin-package inventory reads only `.paths(name)`
 * (the node_modules candidates a bare specifier would search); the face
 * answers from the staged fs view so workspace-seeded manifests resolve. */
export const makeResolveFace = (base) => {
  const resolve = (request) => {
    if (typeof request !== 'string' || request.length === 0) {
      throw new TypeError(`node:module: resolve needs a specifier, got ${String(request)}`);
    }
    const relative = resolveRelative(base, request);
    if (relative !== undefined) return relative;
    // A subpath request ('@scope/pkg/sub') names the package plus one
    // subpath: the scoped spelling splits at the second slash, the plain
    // one at the first.
    const slash = request.startsWith('@') ? request.indexOf('/', 1) : -1;
    const split = slash > 0 ? request.indexOf('/', slash + 1) : request.indexOf('/');
    const shapes = split > 0
      ? [{ pkg: request, sub: null }, { pkg: request.slice(0, split), sub: request.slice(split + 1) }]
      : [{ pkg: request, sub: null }];
    for (const dir of resolvePathsFor(base)) {
      for (const { pkg, sub } of shapes) {
        const entry = manifestEntryFor(dir, pkg, sub);
        if (entry !== undefined) return entry;
      }
    }
    const error = new Error(`Cannot find module '${request}' imported from ${base}`);
    error.code = 'MODULE_NOT_FOUND';
    error.requireStack = [base];
    throw error;
  };
  resolve.paths = (request) => {
    if (typeof request !== 'string' || request.length === 0) {
      throw new TypeError(`node:module: resolve.paths needs a specifier, got ${String(request)}`);
    }
    return resolvePathsFor(base);
  };
  return resolve;
};

