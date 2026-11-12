/**
 * dsh-fs cordis face — the `ctx.fs` FileSystem provider over the gateway fs
 * primitives (the fs seam-collapse pilot): the upstream `ctx.fs` seam
 * (@deepseek-ai/dsh-fs FileSystem) becomes the ONLY fs surface in the
 * product boot, and THIS class is its provider, replacing the vendored
 * @deepseek-ai/dsh-fs-local in boot.js's file-tools row. fs-local stays in
 * the closure for the parity/suite legs — it is never edited (D6), and the
 * registry activate face in index.js is untouched.
 *
 * Identity model: FsTarget.targetKey carries the NORMALIZED SCOPE-RELATIVE
 * POSIX path (the opaque key in this world — no realpath machinery exists
 * here); displayPath is the absolute in-world spelling under the workspace
 * root (what the model and the workspaceFiles wire see, byte-compatible
 * with fs-local's display paths). processPath returns that absolute form —
 * the path-math anchor the workspaceFiles adapters resolve related files
 * with. The gateway (scope, path) address derives per call from the pinned
 * profile globals via the shared scope-address.js derivation — read, never
 * guessed (the dsh-shell-js toGateway rule), and a host that granted no
 * scoped workspace refuses loudly (GatewayError('unavailable'), the shell's
 * posture) instead of degrading to the bare relative spelling.
 *
 * Mutations publish through fsPublishAtomic (contract v1.11.0): ONE host
 * step — same-directory temp → write → fsync → rename → fsync(dir) — the
 * rename-based atomic semantics fs-local implements in-process. Parents
 * are created first (publish does not create parents).
 *
 * Honest gaps over the fs-local baseline (declared, not hidden):
 *   - versions derive from the fsStat signal only (`mtime:size`); the
 *     gateway carries no dev/ino, so the token has the stat's own
 *     granularity (1s mtime on the CLI host). The per-target lock below
 *     keeps in-session guard chains exact; an external same-second
 *     same-size rewrite can still slip a stale guard.
 *   - no symlink face: the gateway has no no-follow probe, so lstat never
 *     reports `symlink` and reads cannot resolve links.
 *   - readBytes/readByteRange are bounded by the pre-read stat and the
 *     post-read length (the primitives have no windowed read), so the
 *     whole file transits the bridge; the length check still refuses
 *     truncation-shaped overruns with FS_TOO_LARGE.
 *   - paths outside the workspace root refuse FS_SANDBOX_DENIED before any
 *     primitive call (fs-local has no containment; this world's boundary
 *     IS the granted scope).
 *   - the sandboxPolicy argument is accepted and ignored: this provider
 *     confines by the granted scope (base sandboxMode stays undefined,
 *     the fs-local posture), not by a per-call sandbox mode.
 */
import { createLogger } from 'logger.js';
import { FileSystem, FsError, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs';
import { fsRead, fsList, fsMkdir } from 'gateway.js';
import { appScopeAddress, scopeRoots, workspacePrefix } from 'scope-address.js';
import { fsPublishAtomic } from 'fs-durable.js';
import {
  DEFAULT_DIFF_BASIS_MAX_BYTES, lexical, versionSignalOf,
  throwIfAborted, normalizeLineEndings, detectLineEndings, restoreLineEndings,
  applyLiteralEdit, decodeUtf8, rejectBinarySample, carriesNul, gatewayFsError, probeStat,
} from './cordis-io.js';
import { pathToFileURL } from 'node:url';

const log = createLogger('dsh.fs.cordis');

/** streamText chunk size — boundaries carry no meaning (the fs contract). */
const STREAM_CHUNK_CHARS = 64 * 1024;

/** The provider class: boot.js mounts it with `ctx.plugin(DshFsProvider,
 * { cwd })` exactly where fs-local used to mount. */
export class DshFsProvider extends FileSystem {
  /** The workspace root (absolute POSIX): resolution default AND this
   * world's containment boundary (the fs-local contrast is declared in the
   * header). Optionally overrides the diff-basis bound. */
  cwd;
  diffBasisMaxBytes;
  /** Per-targetKey tail promise: serializes mutating ops so the
   * read→guard→publish window cannot interleave (fs-local's lock rule). */
  locks = new Map();

  constructor(ctx, config) {
    super(ctx);
    log.debug('construct', { cwd: config?.cwd });
    if (typeof config?.cwd !== 'string' || !config.cwd.startsWith('/')) {
      throw new Error('dsh-fs cordis: config.cwd must be an absolute POSIX path');
    }
    const basis = config.diffBasisMaxBytes ?? DEFAULT_DIFF_BASIS_MAX_BYTES;
    if (!Number.isSafeInteger(basis) || basis <= 0) {
      throw new Error('dsh-fs cordis: diffBasisMaxBytes must be a positive safe integer');
    }
    this.cwd = config.cwd;
    this.diffBasisMaxBytes = basis;
  }

  /** The scope-relative identity of `path` against this workspace: the
   * absolute in-world spelling plus the normalized relative key. Throws
   * FS_SANDBOX_DENIED when the spelling climbs out of the workspace. */
  locate(path, opts) {
    log.debug('locate', { path });
    const base = typeof opts?.cwd === 'string' ? opts.cwd : this.cwd;
    const absolute = lexical(path.startsWith('/') ? path : `${base}/${path}`);
    const root = base.endsWith('/') ? base.slice(0, -1) : base;
    const rel = absolute === null ? null
      : absolute === root ? ''
        : absolute.startsWith(`${root}/`) ? absolute.slice(root.length + 1) : null;
    if (rel === null) {
      throw new FsError(`path "${path}" escapes its scope`, 'FS_SANDBOX_DENIED');
    }
    return { absolute, rel };
  }

  /** The gateway (scope, path) address for a normalized relative key — the
   * workspace prefix inside the `app` scope rides the pinned globals (the
   * shared scope-address.js derivation). Missing/misshapen globals refuse
   * loudly (GatewayError('unavailable'), the shell's posture) — a config
   * error is a defect, never a silent empty-prefix degrade. */
  address(rel) {
    log.debug('address', { rel });
    return appScopeAddress(rel, workspacePrefix(scopeRoots('fs')));
  }

  /** fsStat over a relative key, absence-shaped (cordis-io probeStat). */
  async probe(rel) {
    const { scope, path } = this.address(rel);
    log.debug('probe', { scope, path });
    return await probeStat(scope, path);
  }

  /** Require an existing regular file (fs-local statRegularFile). */
  async statRegular(rel, displayPath, verb, signal) {
    log.debug('statRegular', { rel, verb });
    throwIfAborted(signal, verb);
    const info = await this.probe(rel);
    if (!info) throw new FsError(`cannot ${verb} "${displayPath}": not found`, 'FS_NOT_FOUND');
    if (info.kind !== 'file') {
      throw new FsError(`cannot ${verb} "${displayPath}": not a regular file`,
        'FS_NOT_REGULAR_FILE');
    }
    return info;
  }

  /** The target identity of a resolved target: the relative key without
   * the root sentinel spelling. */
  keyOf(target) {
    const rel = String(target.targetKey);
    log.debug('keyOf', { rel });
    return rel === '.' ? '' : rel;
  }

  /** Whole-file gateway read mapped onto the FsError vocabulary: resolves
   * the raw bytes (the shim's {bytes, mtime} envelope unwrapped). */
  async readWhole(rel, verb, displayPath) {
    const { scope, path } = this.address(rel);
    log.debug('gateway read', { scope, path });
    try {
      return (await fsRead(scope, path)).bytes;
    } catch (error) {
      throw gatewayFsError(error, verb, displayPath);
    }
  }

  /** Run `op` with exclusive access to `rel` (FIFO per key, fs-local's
   * withLock). */
  async withLock(rel, op) {
    log.debug('lock', { rel });
    const run = (this.locks.get(rel) ?? Promise.resolve()).then(op, op);
    const tail = run.then(() => undefined, () => undefined);
    this.locks.set(rel, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(rel) === tail) this.locks.delete(rel);
    }
  }

  /** One atomic durable publish: parents first (publish does not create
   * them), an abort check before the rename lands, then fsPublishAtomic —
   * the contract's one-step temp→write→fsync→rename→fsync(dir). */
  async publish(rel, text, displayPath, signal) {
    throwIfAborted(signal, 'write');
    const cut = rel.lastIndexOf('/');
    if (cut > 0) {
      const parent = this.address(rel.slice(0, cut));
      log.debug('publish parent mkdir', { path: parent.path });
      try {
        await fsMkdir(parent.scope, parent.path);
      } catch (error) {
        throw gatewayFsError(error, 'write', displayPath);
      }
    }
    throwIfAborted(signal, 'write');
    const dest = this.address(rel);
    log.debug('publish', { path: dest.path, chars: text.length });
    try {
      await fsPublishAtomic(dest.scope, dest.path, new TextEncoder().encode(text));
    } catch (error) {
      throw gatewayFsError(error, 'write', displayPath);
    }
  }

  /** The version token after a publish: the fresh stat's signal, or the
   * fs-local sentinel when a concurrent unlink won the race. */
  async versionAfterPublish(rel) {
    const after = await this.probe(rel);
    if (after) return FsVersion(versionSignalOf(after));
    log.debug('post-publish miss', { rel });
    return FsVersion(`missing:${this.address(rel).path}`);
  }

  /** fs-local's guarded-write intents over the probed existing state:
   * createIfAbsent rejects an existing target (FS_NOT_OBSERVED),
   * replaceIfVersion rejects absence or a version mismatch
   * (FS_STALE_VERSION); omission means unconditional create-or-overwrite. */
  assertWriteIntent(expected, existing, displayPath) {
    log.debug('write intent', { expected: expected?.kind ?? 'unconditional', existing: existing !== undefined });
    if (expected?.kind === 'createIfAbsent' && existing) {
      throw new FsError(
        `cannot overwrite existing "${displayPath}" without reading it first`,
        'FS_NOT_OBSERVED');
    }
    if (expected?.kind === 'replaceIfVersion') {
      if (!existing) {
        throw new FsError(`cannot write "${displayPath}": file no longer exists`,
          'FS_STALE_VERSION');
      }
      if (versionSignalOf(existing) !== String(expected.version)) {
        throw new FsError(`cannot write "${displayPath}": file changed since it was read`,
          'FS_STALE_VERSION');
      }
    }
  }

  /** fs-local's best-effort overwrite diff basis: the LF-normalized prior
   * text, or null for an at/above-bound, binary, non-UTF-8, or raced-away
   * file. Only FS_ABORTED propagates (fs-local readTextForDiff's posture). */
  async diffBasis(rel, info, displayPath) {
    if (info.size >= this.diffBasisMaxBytes) return null;
    try {
      const raw = await this.readWhole(rel, 'read', displayPath);
      rejectBinarySample(raw, displayPath);
      return normalizeLineEndings(decodeUtf8(raw, 'read', displayPath));
    } catch (error) {
      if (error instanceof FsError && error.code === 'FS_ABORTED') throw error;
      log.debug('diff basis declined', { rel });
      return null;
    }
  }

  async resolve(path, opts) {
    log.debug('resolve', { path });
    throwIfAborted(opts?.signal, 'resolve');
    const { absolute, rel } = this.locate(path, opts);
    return { targetKey: FsTargetKey(rel === '' ? '.' : rel), displayPath: absolute };
  }

  processPath(target) {
    log.debug('processPath', { key: target.targetKey });
    return target.displayPath;
  }

  processPathFromHostPath(hostPath) {
    log.debug('processPathFromHostPath', { hostPath });
    if (typeof hostPath !== 'string' || !hostPath.startsWith('/')) return undefined;
    const root = this.cwd.endsWith('/') ? this.cwd.slice(0, -1) : this.cwd;
    const absolute = lexical(hostPath);
    if (absolute === null) return undefined;
    return absolute === root || absolute.startsWith(`${root}/`) ? absolute : undefined;
  }

  fileUrl(target) {
    log.debug('fileUrl', { path: target.displayPath });
    return pathToFileURL(this.processPath(target)).href;
  }

  contains(parent, child) {
    log.debug('contains', { parent: parent.displayPath, child: child.displayPath });
    const a = this.processPath(parent);
    const b = this.processPath(child);
    return b === a || b.startsWith(`${a}/`);
  }

  async stat(target, signal) {
    log.debug('stat', { key: target.targetKey });
    throwIfAborted(signal, 'stat');
    const info = await this.probe(this.keyOf(target));
    throwIfAborted(signal, 'stat');
    if (!info) return undefined;
    return {
      version: FsVersion(versionSignalOf(info)),
      type: info.kind === 'file' ? 'file' : info.kind === 'dir' ? 'directory' : 'other',
      size: info.size,
    };
  }

  async lstat(path, opts, signal) {
    log.debug('lstat', { path });
    throwIfAborted(signal, 'lstat');
    if (typeof path !== 'string' || path.trim().length === 0) {
      throw new FsError('file_path must be a non-empty string', 'FS_NOT_FOUND');
    }
    const { rel } = this.locate(path, opts);
    const info = await this.probe(rel);
    throwIfAborted(signal, 'lstat');
    if (!info) return undefined;
    // The gateway world has no no-follow probe (declared gap): a symlink
    // answers as its target kind would through fsStat — `symlink` is
    // unreachable here.
    return {
      version: FsVersion(versionSignalOf(info)),
      type: info.kind === 'file' ? 'file' : info.kind === 'dir' ? 'directory' : 'other',
      size: info.size,
    };
  }

  async readText(target, signal) {
    log.debug('readText', { key: target.targetKey });
    const rel = this.keyOf(target);
    await this.statRegular(rel, target.displayPath, 'read', signal);
    const raw = await this.readWhole(rel, 'read', target.displayPath);
    rejectBinarySample(raw, target.displayPath);
    return decodeUtf8(raw, 'read', target.displayPath);
  }

  /** streamText: readText's text semantics delivered as decoded fixed-size
   * chunks (boundaries carry no meaning per the contract). */
  async streamText(target, signal) {
    log.debug('streamText', { key: target.targetKey });
    const text = await this.readText(target, signal);
    const chunks = [];
    for (let at = 0; at < text.length; at += STREAM_CHUNK_CHARS) {
      chunks.push(text.slice(at, at + STREAM_CHUNK_CHARS));
    }
    return (async function* replay() {
      for (const chunk of chunks) yield chunk;
    })();
  }

  async readBytes(target, signal, maxBytes) {
    log.debug('readBytes', { key: target.targetKey, maxBytes });
    const rel = this.keyOf(target);
    const info = await this.statRegular(rel, target.displayPath, 'read', signal);
    if (info.size > maxBytes) {
      throw new FsError(
        `cannot read "${target.displayPath}": ${info.size} bytes exceeds the ${maxBytes}-byte limit`,
        'FS_TOO_LARGE');
    }
    const raw = await this.readWhole(rel, 'read', target.displayPath);
    if (raw.byteLength > maxBytes) {
      throw new FsError(
        `cannot read "${target.displayPath}": content exceeds the ${maxBytes}-byte limit`,
        'FS_TOO_LARGE');
    }
    return raw;
  }

  async readByteRange(target, range, signal) {
    log.debug('readByteRange', { key: target.targetKey, range });
    const rel = this.keyOf(target);
    await this.statRegular(rel, target.displayPath, 'read', signal);
    if (!Number.isSafeInteger(range.offset) || range.offset < 0
      || !Number.isSafeInteger(range.length) || range.length < 0) {
      throw new FsError(`cannot read "${target.displayPath}": invalid byte window`,
        'FS_IO_ERROR');
    }
    if (range.length === 0) return new Uint8Array(0);
    // No windowed read primitive exists (declared gap): the whole file
    // transits the bridge; the slice is exact.
    const raw = await this.readWhole(rel, 'read', target.displayPath);
    return raw.subarray(range.offset, range.offset + range.length);
  }

  async listDir(target, signal) {
    log.debug('listDir', { key: target.targetKey });
    throwIfAborted(signal, 'list');
    const rel = this.keyOf(target);
    const info = await this.probe(rel);
    if (!info) {
      throw new FsError(`cannot list "${target.displayPath}": not found`, 'FS_NOT_FOUND');
    }
    if (info.kind !== 'dir') {
      throw new FsError(`cannot list "${target.displayPath}": not a directory`,
        'FS_NOT_DIRECTORY');
    }
    const { scope, path } = this.address(rel);
    let listing;
    try {
      listing = await fsList(scope, path);
    } catch (error) {
      throw gatewayFsError(error, 'list', target.displayPath);
    }
    const entries = [];
    for (const entry of listing.entries) {
      throwIfAborted(signal, 'list');
      entries.push(await this.listEntry(rel, target.displayPath, entry));
    }
    return entries;
  }

  /** One listed child: the resolved target plus cheap metadata when the
   * probe still answers (fs-local's per-child probe). */
  async listEntry(parentRel, parentPath, entry) {
    log.debug('listEntry', { parentRel, name: entry.name });
    const childRel = parentRel === '' ? entry.name : `${parentRel}/${entry.name}`;
    const childInfo = await this.probe(childRel);
    return {
      name: entry.name,
      type: entry.kind === 'file' ? 'file' : entry.kind === 'dir' ? 'directory' : 'other',
      target: {
        targetKey: FsTargetKey(childRel),
        displayPath: `${parentPath}/${entry.name}`,
      },
      ...(childInfo ? { version: FsVersion(versionSignalOf(childInfo)) } : {}),
      ...(childInfo && entry.kind === 'file' ? { size: childInfo.size } : {}),
    };
  }

  async writeText(target, content, expected, signal, sandboxPolicy) {
    log.debug('writeText', { key: target.targetKey, chars: content.length });
    const rel = this.keyOf(target);
    return this.withLock(rel, async () => {
      throwIfAborted(signal, 'write');
      const existing = await this.probe(rel);
      if (existing && existing.kind !== 'file') {
        throw new FsError(`cannot write "${target.displayPath}": not a regular file`,
          'FS_NOT_REGULAR_FILE');
      }
      this.assertWriteIntent(expected, existing, target.displayPath);
      const withinBasis = globalThis.Buffer.byteLength(content, 'utf8') < this.diffBasisMaxBytes;
      const before = existing && withinBasis
        ? await this.diffBasis(rel, existing, target.displayPath)
        : null;
      await this.publish(rel, content, target.displayPath, signal);
      return {
        operation: existing ? 'update' : 'create',
        version: await this.versionAfterPublish(rel),
        before,
        after: normalizeLineEndings(content),
      };
    });
  }

  async editText(target, edit, expected, signal, sandboxPolicy) {
    log.debug('editText', { key: target.targetKey });
    const rel = this.keyOf(target);
    return this.withLock(rel, async () => {
      throwIfAborted(signal, 'edit');
      const existing = await this.probe(rel);
      if (!existing) {
        throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`,
          'FS_STALE_VERSION');
      }
      if (existing.kind !== 'file') {
        throw new FsError(`cannot edit "${target.displayPath}": not a regular file`,
          'FS_NOT_REGULAR_FILE');
      }
      if (expected && versionSignalOf(existing) !== String(expected.version)) {
        throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`,
          'FS_STALE_VERSION');
      }
      const raw = await this.readWhole(rel, 'edit', target.displayPath);
      if (carriesNul(raw)) {
        throw new FsError(`cannot edit "${target.displayPath}": binary file`, 'FS_NOT_TEXT');
      }
      const original = decodeUtf8(raw, 'edit', target.displayPath);
      const normalized = normalizeLineEndings(original);
      const edited = applyLiteralEdit(normalized, edit.oldString, edit.newString,
        edit.replaceAll, target.displayPath);
      const content = restoreLineEndings(edited.content, detectLineEndings(original));
      await this.publish(rel, content, target.displayPath, signal);
      return {
        version: await this.versionAfterPublish(rel),
        before: normalized,
        after: edited.content,
      };
    });
  }
}
