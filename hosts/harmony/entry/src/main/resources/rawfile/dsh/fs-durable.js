/**
 * fs-durable — the durable-fs face of the capability gateway (contract
 * v1.11.0, folded 2026-10-19): fsPublishAtomic / fsSync over the same `call`
 * seam gateway.js owns every other primitive. Split from gateway.js at the
 * code-size gate (the surface.js precedent — gateway.js crossed 500 lines
 * when this face landed).
 *
 * The publish is ONE host step — same-directory temp → write → fsync(file) →
 * rename → fsync(directory) — because the atomicity of the sequence cannot be
 * composed from smaller primitives across gateway round-trips; publish is
 * rename-based by law of measurement (Android SELinux denies link(2) for app
 * domains — PR #587). Bytes travel base64 like every bytes parameter; the
 * contract layer's `bytes` is Uint8Array (§3), encoded here.
 */
import { createLogger } from 'logger.js';
import { call } from 'gateway.js';
import { bytesToBase64 } from 'dsh:util-crypto';

const log = createLogger('dsh.fs-durable');

/** Write `bytes` to `path` as ONE atomic durable publish; resolves
 * `{ written }` (the fsWrite vocabulary). The parent directory must exist —
 * publish does not create parents (`fsMkdir` first). */
export const fsPublishAtomic = async (scope, path, bytes) => {
  log.debug('fsPublishAtomic', { scope, path, bytes: bytes?.length ?? 0 });
  const res = await call('fsPublishAtomic', {
    scope,
    path,
    bytesB64: bytesToBase64(bytes),
  });
  return { written: res.written };
};

/** One explicit durability barrier by path: fsync the file (`kind: "file"`)
 * or the directory (`kind: "dir"`). The kind must match what the path is —
 * a mismatch rejects `io` (no stat-guessing). */
export const fsSync = async (scope, path, opts = {}) => {
  log.debug('fsSync', { scope, path, kind: opts.kind });
  await call('fsSync', { scope, path, kind: opts.kind });
};
