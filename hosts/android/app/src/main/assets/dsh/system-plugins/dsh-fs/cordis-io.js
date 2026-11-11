// dsh:logging-exempt (pure function module — the fs-local text/edit semantics
// restated over the gateway's byte world, a codec class: no policy decisions
// and no I/O of its own; the caller owns the log)
/**
 * dsh-fs cordis face — the shared mechanics (split from cordis.js at the
 * code-size gate, the dsh-office word/excel precedent): the fs-local
 * text/edit semantics restated over the gateway's byte world, the
 * gateway→FsError vocabulary mapping, and the absence-shaped fsStat probe.
 * The seam-collapse design contract lives in cordis.js's header; this file
 * adds nothing behavioral on its own.
 */
import { createLogger } from 'logger.js';
import { FsError } from '@deepseek-ai/dsh-fs';
import { fsStat, GatewayError } from 'gateway.js';

const log = createLogger('dsh.fs.cordis.io');

/** fs-local's byte sample for the NUL binary rejection. */
export const BINARY_SAMPLE_BYTES = 8192;
/** fs-local's default contextual-diff-basis bound (FsWriteOutcome.before). */
export const DEFAULT_DIFF_BASIS_MAX_BYTES = 10 * 1024 * 1024;

/** Lexically resolve `.`/`..` segments of an absolute path (the shims'
 * fs-workspace lexical, restated so the plugin imports no shim face).
 * Returns null when the spelling climbs above the root. */
export const lexical = (path) => {
  const out = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg !== '..') {
      out.push(seg);
      continue;
    }
    if (out.length === 0) return null;
    out.pop();
  }
  return `/${out.join('/')}`;
};

/** The fs version signal of one fsStat answer — the stat's own fields are
 * the only freshness token the gateway carries (declared gap: no dev/ino). */
export const versionSignalOf = (info) => `${info.mtime}:${info.size}`;

/** fs-local's throwIfAborted: cancellation before an op is FS_ABORTED. */
export const throwIfAborted = (signal, verb) => {
  if (signal?.aborted) throw new FsError(`${verb} aborted`, 'FS_ABORTED');
};

/** Collapse CRLF to LF — the canonical edit/diff basis (fs-local semantics).
 * Lone `\r` bytes stay untouched. */
export const normalizeLineEndings = (content) => content.replaceAll('\r\n', '\n');

/** The read-time line-ending style (fs-local detectLineEndings). */
export const detectLineEndings = (raw) => {
  const sample = raw.slice(0, 4096);
  const crlf = sample.split('\r\n').length - 1;
  return crlf > sample.split('\n').length - 1 - crlf ? 'CRLF' : 'LF';
};

/** LF-normalized content back to the style detected at read time. */
export const restoreLineEndings = (content, style) => (style === 'LF'
  ? content
  : normalizeLineEndings(content).split('\n').join('\r\n'));

const countOccurrences = (content, needle) => {
  let count = 0;
  let index = 0;
  for (;;) {
    const found = content.indexOf(needle, index);
    if (found === -1) return count;
    count += 1;
    index = found + needle.length;
  }
};

/** Literal replacement over LF-normalized content (fs-local semantics):
 * empty or missing old → FS_EDIT_NOT_FOUND; multiple matches without
 * replaceAll → FS_AMBIGUOUS_EDIT. */
export const applyLiteralEdit = (content, oldString, newString, replaceAll, displayPath) => {
  const from = normalizeLineEndings(oldString);
  if (from.length === 0) {
    throw new FsError('old_string must be a non-empty string', 'FS_EDIT_NOT_FOUND');
  }
  const to = normalizeLineEndings(newString);
  const matches = countOccurrences(content, from);
  if (matches === 0) {
    throw new FsError(`old_string was not found in "${displayPath}"`, 'FS_EDIT_NOT_FOUND');
  }
  if (!replaceAll && matches > 1) {
    throw new FsError(
      `old_string matched ${matches} times in "${displayPath}"; provide a more specific old_string or set replace_all to true`,
      'FS_AMBIGUOUS_EDIT');
  }
  return { content: content.split(from).join(to), matches };
};

/** Fatal UTF-8 decode (the shim TextDecoder's fs-local face): invalid
 * bytes reject FS_NOT_TEXT naming the verb. */
export const decodeUtf8 = (bytes, verb, displayPath) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new FsError(`cannot ${verb} "${displayPath}": invalid UTF-8 text`, 'FS_NOT_TEXT');
  }
};

/** NUL-byte binary sample rejection over the first 8 KiB (fs-local's
 * readWholeText gate; editText checks the whole buffer separately). */
export const rejectBinarySample = (bytes, displayPath) => {
  const sample = bytes.subarray(0, BINARY_SAMPLE_BYTES);
  for (let i = 0; i < sample.length; i += 1) {
    if (sample[i] === 0) {
      throw new FsError(`cannot read "${displayPath}": binary file`, 'FS_NOT_TEXT');
    }
  }
};

/** Whether `bytes` carries a NUL byte anywhere (fs-local's readForEdit
 * whole-buffer binary gate). */
export const carriesNul = (bytes) => {
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === 0) return true;
  }
  return false;
};

/** Map a gateway rejection onto the seam's FsError vocabulary. The caller
 * has already answered absence from fsStat, so `io` here is a genuine I/O
 * failure; `unavailable` is a capability gap carried honestly in the
 * message (the seam has no dedicated code for it); an unknown code fails
 * loud as FS_IO_ERROR naming the original. */
export const gatewayFsError = (error, verb, displayPath) => {
  const message = error?.message ?? 'gateway call failed';
  const code = error instanceof GatewayError ? error.code : undefined;
  const byCode = {
    denied: 'FS_PERMISSION_DENIED',
    invalid: 'FS_SANDBOX_DENIED',
    timeout: 'FS_ABORTED',
    cancelled: 'FS_ABORTED',
  };
  return new FsError(`cannot ${verb} "${displayPath}": ${message}`,
    byCode[code] ?? 'FS_IO_ERROR', { cause: error });
};

/** fsStat's answer for one gateway address, or null when absent. Absence
 * is BOTH shapes the hosts answer (contract/primitives.md §4): a missing
 * path rejects `io`, or answers kind "other" with an empty mtime (the CLI
 * and device hosts' own miss shape). */
export const probeStat = async (scope, path) => {
  let info;
  try {
    info = await fsStat(scope, path);
  } catch (error) {
    if (error instanceof GatewayError && error.code === 'io') return null;
    throw error;
  }
  if (info.kind === 'other' && !info.mtime) return null;
  log.debug('probe hit', { path, kind: info.kind, size: info.size });
  return info;
};
