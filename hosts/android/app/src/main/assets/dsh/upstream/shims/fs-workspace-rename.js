// dsh:logging-exempt (shim layer; state plumbing, no logging surface)
/**
 * shims/fs-workspace-rename.js — the workspace MOVE/LINK/METADATA faces
 * (rename, link, chmod, utimes, symlink), split from fs-workspace-write.js
 * when that file crossed the code-size budget. The world model stays in
 * fs-workspace.js; imports are call-time-only (ESM-cycle safe), and every
 * consumer keeps importing through the fs-workspace.js specifier.
 */
import {
  workspace,
  wsAt,
  DIR_MODE,
  bumpClock,
  wsCreateFile,
  wsEexist,
  wsEnoent,
  wsIsDirAt,
  notifyWatches,
  resolveSymlinkAt,
  } from 'upstream/shims/fs-workspace.js';
import {
  wsMirrorChmodReal,
  wsResolveSymlinkChain,
} from 'upstream/shims/fs-workspace-write.js';

/** Move a tracked FILE entry (module level for size): delete + re-put
 * refreshes the map order; mtime re-rides the clock (ctime follows). */
const renameFileEntry = (state, sourcePath, dest) => {
  const entry = state.files.get(sourcePath);
  state.files.delete(sourcePath);
  entry.mtimeNs = bumpClock(state);
  entry.ctimeNs = entry.mtimeNs;
  state.files.set(dest, entry);
  notifyWatches(sourcePath);
  notifyWatches(dest);
};

/** Move a tracked DIRECTORY subtree (module level for size): every file and
 * subdir below the prefix re-keys under the destination; inos and tracked
 * modes ride. Real-disk mirror (W6-U r3): the VFS rename moves only its map
 * — the mirrored real source dir lingers (best-effort litter) and the dest
 * must exist for the seam's children (same mkdir-mirror argument as
 * wsMkdir). */
const renameDirSubtree = (state, sourcePath, dest) => {
  const prefix = `${sourcePath}/`;
  const moved = [];
  for (const [key, entry] of state.files) {
    if (key.startsWith(prefix)) moved.push([key, entry]);
  }
  for (const [key] of moved) state.files.delete(key);
  for (const [key, entry] of moved) state.files.set(dest + key.slice(sourcePath.length), entry);
  for (const dir of [...state.dirs]) {
    if (!dir.startsWith(prefix)) continue;
    state.dirs.delete(dir);
    const ino = state.dirIno.get(dir);
    state.dirIno.delete(dir);
    if (ino !== undefined) state.dirIno.set(dest + dir.slice(sourcePath.length), ino);
    const trackedMode = state.dirModes?.get(dir);
    if (trackedMode !== undefined) {
      state.dirModes.delete(dir);
      state.dirModes.set(dest + dir.slice(sourcePath.length), trackedMode);
    }
  }
  state.dirs.delete(sourcePath);
  const sourceIno = state.dirIno.get(sourcePath);
  state.dirIno.delete(sourcePath);
  if (sourceIno !== undefined) state.dirIno.set(dest, sourceIno);
  state.dirs.add(dest);
  try { globalThis.__dshProcMkdirReal?.(dest); } catch { /* best-effort */ }
};

export const wsRename = (from, to) => {
  const source = wsAt(from);
  const target = wsAt(to);
  if (source === null || target === null) {
    throw new Error(`node:fs.rename: path outside the writable workspace root: ${from} -> ${to}${wsRootHint(from)}`);
  }
  const { state } = source;
  const dest = wsResolveSymlinkChain(state, target.path);
  const sourcePath = wsResolveSymlinkChain(state, source.path);
  // Rename writes both directories: removal from the source's parent and
  // creation in the destination's (POSIX rename semantics).
  wsRequireDirWrite(state, sourcePath, 'rename');
  wsRequireDirWrite(state, dest, 'rename');
  // node's rename cross-checks: file onto an existing directory is EISDIR;
  // directory onto an existing non-directory is ENOTDIR.
  if (state.files.has(sourcePath) && (state.dirs.has(dest) || wsIsDirAt(dest))) {
    const error = new Error(`EISDIR: illegal operation on a directory, rename '${sourcePath}' -> '${dest}'`);
    error.code = 'EISDIR';
    error.errno = -21;
    error.syscall = 'rename';
    error.path = dest;
    throw error;
  }
  if (state.dirs.has(sourcePath) && state.files.has(dest)) {
    const error = new Error(`ENOTDIR: not a directory, rename '${sourcePath}' -> '${dest}'`);
    error.code = 'ENOTDIR';
    error.errno = -20;
    error.syscall = 'rename';
    error.path = dest;
    throw error;
  }
  if (state.files.has(sourcePath)) return renameFileEntry(state, sourcePath, dest);
  if (state.dirs.has(sourcePath)) return renameDirSubtree(state, sourcePath, dest);
  throw wsEnoent('rename', sourcePath);
};

/** Hard-link create-if-absent: bytes shared by copy, destination must not
 * exist. The LINK SHARES IDENTITY: node reports one dev+ino pair for every
 * name of a hard-linked object, and attachment-local's dedup contract
 * asserts the alias stat()s to the OBJECT's ino (measured 2026-09-28: two
 * distinct inos failed the identity assert, R3-G1). */
export const wsLink = (sourcePath, destPath) => {
  const source = wsAt(sourcePath);
  const target = wsAt(destPath);
  if (source === null || target === null) {
    throw new Error(`node:fs.link: path outside the writable workspace root: ${sourcePath} -> ${destPath}${wsRootHint(sourcePath)}`);
  }
  const { state } = source;
  const entry = state.files.get(source.path);
  if (entry === undefined) throw wsEnoent('link', source.path);
  wsRequireDirWrite(state, target.path, 'link');
  // link(2) fails EEXIST on ANY occupant of the destination name — a
  // symlink entry occupies it too (the session-persistence-jsonl
  // "colliding symlink target" publication test leans on the refusal).
  if (state.files.has(target.path) || state.dirs.has(target.path)
      || state.symlinks?.has(target.path)) throw wsEexist('link', target.path);
  wsCreateFile(state, target.path, entry.bytes.slice(), entry.mode);
  state.files.get(target.path).ino = entry.ino;
  // Real-disk write-through (the session-persistence resume leg, 2026-10-11):
  // the jsonl backend publishes its log via link()+unlink() — the link face
  // is the LAST writer of the artifact's bytes and had no real twin, so the
  // staged temp's write-through mirror was unlink-mirrored away and a stored
  // session left the container disk with directories only (measured: the
  // resume leg's process-1 disk check). Materialize the linked bytes at the
  // destination: parents are mkdir -p'd by the intrinsic, and the 8 MB cap /
  // best-effort posture match the sibling mirrors — the VFS stays the world
  // of record, and what the disk needs is byte-identical durability, not
  // real-inode identity (the two names stay one object in the VFS).
  try {
    const bytes = entry.bytes;
    if (bytes.length <= 8 * 1024 * 1024) {
      let bin = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      globalThis.__dshProcWriteFileReal?.(target.path, btoa(bin));
    }
  } catch { /* structural mirror is best-effort */ }
};

/** chmod on a workspace file or directory. */
export const wsChmod = (path, mode) => {
  const at = wsAt(path);
  if (at === null) {
    throw new Error(`node:fs.chmod: path outside the writable workspace root: ${path}${wsRootHint(path)}`);
  }
  const file = at.state.files.get(at.path);
  if (file !== undefined) {
    file.mode = typeof mode === 'number' ? mode : file.mode;
    if (typeof mode === 'number') wsMirrorChmodReal(wsResolveSymlinkChain(at.state, at.path), mode);
    return;
  }
  if (!at.state.dirs.has(at.path) && !wsIsDirAt(path)) throw wsEnoent('chmod', at.path);
  // Directory modes are tracked (tightenModes stats the 0700 back) and,
  // since W4-N 2026-09-28, ENFORCED for mutations through wsRequireDirWrite
  // below (the contract's conformance clause requires permission-flag
  // enforcement; the settings-file concurrency spec chmods the settings dir
  // 0500 and expects the writer's create to fail with EACCES).
  if (typeof mode === 'number') {
    at.state.dirModes.set(at.path, mode);
    wsMirrorChmodReal(wsResolveSymlinkChain(at.state, at.path), mode);
  }
};

/* ---- directory write-permission gate (W4-N, 2026-09-28) ------------------ */

/** The EACCES shape node's fs faces throw for a denied syscall. */
const wsEacces = (syscall, path) => {
  const error = new Error(`EACCES: permission denied, ${syscall} '${path}'`);
  error.code = 'EACCES';
  error.errno = -13;
  error.syscall = syscall;
  error.path = path;
  return error;
};

/** Refuse a mutation when ANY existing ancestor directory of the target
 * lacks the owner write bit. Only explicitly chmod'ed dirs carry a tracked
 * mode (dirModes); everything else rides the default 0755, so the gate
 * bites exactly where a caller made a directory read-only. Path-resolution
 * fidelity note: node needs write on the IMMEDIATE parent (plus search on
 * the ancestors); checking every existing ancestor is a strict superset
 * that keeps the spec-visible behavior (a 0500 settings dir refuses the
 * writer's create) while costing one Map look-up per prefix. */
export const wsRequireDirWrite = (state, targetPath, syscall) => {
  if (targetPath === state.root) return;
  let end = targetPath.indexOf('/', state.root.length + 1);
  while (end > 0) {
    const dir = targetPath.slice(0, end);
    if (wsIsDirAt(dir) && ((state.dirModes?.get(dir) ?? DIR_MODE) & 0o200) === 0) {
      throw wsEacces(syscall, targetPath);
    }
    end = targetPath.indexOf('/', end + 1);
  }
};

/* ---- utimes + symlink faces (the 2026-09-27 suite round) ---------------- */

/** utimes on a workspace file: the seconds-since-epoch floats node accepts
 * become the entry's mtime (the mtime-based sweeps and spill aging read it
 * back through stat). Atime is accepted and not stored — nothing in the
 * closure reads atime. */
export const wsUtimes = (path, atimeSeconds, mtimeSeconds) => {
  const at = wsAt(path);
  if (at === null) {
    throw new Error(`node:fs.utimes: path outside the writable workspace root: ${path}${wsRootHint(path)}`);
  }
  const { state, path: canonical } = at;
  const entry = state.files.get(canonical);
  if (entry === undefined) {
    if (state.dirs.has(canonical) || state.symlinks?.has(canonical)) return;
    throw wsEnoent('utimes', canonical);
  }
  const ms = Number(mtimeSeconds);
  if (!Number.isFinite(ms)) {
    throw new TypeError(`node:fs.utimes: mtime must be a finite number, got ${String(mtimeSeconds)}`);
  }
  entry.mtimeNs = BigInt(Math.round(ms * 1000)) * 1000000n;
  entry.ctimeNs = entry.mtimeNs;
};

/** symlink(target, path) — store the raw target string; readers resolve one
 * hop through resolveSymlinkAt (fs.js). Node validates the parent directory;
 * the link itself may dangle. */

/** Real-disk rename mirror (W8 cwd/tmp-fidelity). The VFS rename re-keys its
 * maps only — the workspace-write round mirrored write/rm/mkdir/chmod but
 * left rename's real side unmoved, so a moved file lingered under the old
 * name on the disk the seam's children read and never appeared at the new
 * one (measured: workspace-changes' turn diff lost the same.txt → moved.txt
 * rename entirely — real git saw the file unchanged). After the core
 * re-key, whatever the VFS now holds at the DESTINATION (one file or a
 * subtree) is the rename's payload: the real source is removed and the
 * destination re-materialized from the moved entries. Best-effort like the
 * sibling mirrors — the VFS stays the world of record. */
export const writeRealFile = (path, bytes) => {
  if (typeof path !== 'string' || !path.startsWith('/') || !(bytes instanceof Uint8Array)
      || bytes.length > 8 * 1024 * 1024) return;
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  globalThis.__dshProcWriteFileReal?.(path, btoa(bin));
};

export const mirrorRenameReal = (state, sourcePath, destPath) => {
  try {
    const destFile = state.files.get(destPath);
    if (destFile !== undefined) {
      globalThis.__dshProcRmReal?.(sourcePath, false);
      writeRealFile(destPath, destFile.bytes);
      return;
    }
    if (state.dirs.has(destPath)) {
      globalThis.__dshProcRmReal?.(sourcePath, true);
      globalThis.__dshProcMkdirReal?.(destPath);
      const prefix = `${destPath}/`;
      for (const [key, entry] of state.files) {
        if (key.startsWith(prefix)) writeRealFile(key, entry.bytes);
      }
    }
  } catch { /* structural mirror is best-effort */ }
};
