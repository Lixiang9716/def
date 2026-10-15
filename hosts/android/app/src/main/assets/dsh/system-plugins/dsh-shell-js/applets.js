/**
 * applets.js — the dispatch table and the public surface of the dsh-shell-js
 * applet layer (DECISION §2). The implementation lives in four modules this
 * facade stitches together (the code-size gate's file/function budgets; the
 * boundaries are dependency-one-way, no cycles):
 *
 *   - applets-support.js   session, refusals, path model, `path` face,
 *                          argv flag parsing, pure word helpers
 *   - applets-snapshot.js  the prefetch→body→replay snapshot microcosm,
 *                          the node-face `fs`, the os/util/process faces
 *   - applets-shelljs.js   the shelljs acquisition + provider mount, the
 *                          runShelljs seam, the glob route (§3)
 *   - applets-shelljs-cmds.js / applets-hand.js — the applet wrappers
 *
 * ## Where the 22 applets come from
 *
 * - shelljs 0.10.0 (vendored pristine, loaded through parser.js's seam):
 *   cat, echo, pwd, cd (wrapper-owned cwd — see appletCd), ls, grep, sed,
 *   head, tail, sort, uniq, mkdir, rm, mv, cp, find. The bodies are
 *   byte-pristine; ALL adaptation is in the seams.
 * - Hand-written: wc, env, basename, dirname (absent from shelljs).
 * - Repo modules: sha256sum (runtime/dsh/sha256.js), tar
 *   (runtime/dsh/tar-mini.js — uncompressed ustar, regular files only,
 *   because the frozen gateway has no inflate primitive).
 *
 * ## The load-bearing seam: sync bodies over an async gateway
 *
 * Every gateway primitive is asynchronous (contract §1: Promise in, Promise
 * out), while shelljs bodies call `fs.readFileSync` and use the return value
 * synchronously — no sync bridge exists and none may exist (a nested event
 * loop inside one call would re-enter pending jobs mid-applet: shared
 * mutable state across module boundaries, exactly what D8 forbids). The
 * seam is therefore a per-applet SNAPSHOT MICROCOSMOS (applets-snapshot.js):
 *
 *   1. PREFETCH (async, real gateway calls): the wrapper stats/lists/reads
 *      everything the applet's arguments imply into an in-memory snapshot.
 *   2. BODY (sync, pristine): the node-face `fs` adapter serves the
 *      body entirely from the snapshot; every mutation is applied to the
 *      snapshot AND recorded as a replay op.
 *   3. REPLAY (async, real gateway calls): recorded ops apply in order; a
 *      replay failure becomes the applet's failure, naming primitive+path.
 *
 * The microcosm is not an approximation. This runtime has ONE serial queue:
 * between the prefetch awaits and the replay awaits the body runs to
 * completion with nothing else interleaved, so the snapshot is coherent
 * with the workspace for the whole body. Whole-file reads stay bounded by
 * the host's max read size (an oversize read is the gateway's named
 * `invalid` rejection — disclosed in the tool description).
 *
 * ## Globbing is the executor's, not the bodies'
 *
 * bash expands globs before a program sees argv, and so does this shell
 * (DECISION §4.3): index.js expands word-position globs through
 * `expandGlob` (hand-written fsList walker + vendored minimatch — §3), and
 * shelljs runs with `config.noglob = true`. The `fast-glob` provider exists
 * for the one path that switch cannot reach — shelljs's ls body calls
 * `glob.sync` DIRECTLY for -R walks — and serves it over the live snapshot
 * (still gateway-sourced listings, still minimatch); outside a snapshot it
 * refuses by name.
 *
 * ## Applet contract
 *
 * Every applet is `async (argv, { stdin, vars }) => { stdout, stderr,
 * code }`. `stdin` is a stream.js PipeReader or null; the executor drains
 * pipeline stdin into it (or closes it when the applet never reads — the
 * upstream writer then refuses by name, the EPIPE posture, never a hang).
 * `vars` carries this command's prefix assignments (the env applet prints
 * the session table overlaid with them). The executor owns writing stdout
 * to the next pipe or capture sink.
 *
 * ## Honesty rules (the house rule)
 *
 * Anything a command asks for that the seven gateway primitives cannot
 * honor fails BY NAME (exit 2, stderr naming what is missing): `cp -p`,
 * `ls -l`, `tar -z`, every flag outside an applet's implemented set, the
 * chmod/utimes/symlink family (no such primitive — a contract proposal is
 * the D5 path), and subprocesses (structurally impossible — AGENTS #2).
 */

import {
  session, ShellRefusal, normalizeInternal, resolveAgainstCwd, toGateway,
  wordHasGlobMagic, unavailableRefusal,
} from './applets-support.js';
import { ensureApplets, expandGlob } from './applets-shelljs.js';
import {
  appletCat, appletEcho, appletCd, appletLs, appletGrep, appletSed,
  headTail, appletSort, appletUniq, appletMkdir, appletRm, appletMv,
  appletCp, appletFind,
} from './applets-shelljs-cmds.js';
import {
  appletWc, appletEnv, appletBasename, appletDirname, appletSha256sum,
  appletTar,
} from './applets-hand.js';

// ---------------------------------------------------------------------------
// The dispatch table (§4.1) and the by-name command refusals (§4.2)
// ---------------------------------------------------------------------------

export const APPLETS = {
  cat: appletCat,
  echo: appletEcho,
  pwd: async () => ({ stdout: session.cwd === '' ? '/\n' : `/${session.cwd}\n`, stderr: '', code: 0 }),
  cd: appletCd,
  ls: appletLs,
  grep: appletGrep,
  sed: appletSed,
  head: headTail(true),
  tail: headTail(false),
  sort: appletSort,
  uniq: appletUniq,
  mkdir: appletMkdir,
  rm: appletRm,
  mv: appletMv,
  cp: appletCp,
  find: appletFind,
  wc: appletWc,
  env: appletEnv,
  basename: appletBasename,
  dirname: appletDirname,
  sha256sum: appletSha256sum,
  tar: appletTar,
};

export const APPLET_NAMES = Object.keys(APPLETS).sort().join(', ');

/** Commands with no gateway backing — refused naming the missing capability
 * and the D5 path (§4.2). */
export const REFUSED_COMMANDS = {
  chmod: 'chmod: the gateway fs face (fsRead, fsWrite, fsStat, fsList, fsMkdir, fsRemove, fsRename) '
    + 'has no permission primitive — fsStat carries no mode and nothing can change one. '
    + 'This needs a contract proposal (D5), not an emulation.',
  ln: 'ln: the gateway fs face has no link primitive of either kind (no symlink, no hardlink). '
    + 'This needs a contract proposal (D5), not an emulation.',
  touch: 'touch: its core meaning is a timestamp update and the gateway has no utimes primitive; '
    + "shipping create-only under this name would silently change the command's meaning. "
    + 'This needs a contract proposal (D5).',
  exec: 'exec: there is no process to replace — no subprocess exists on this host '
    + '(single QuickJS runtime, no child processes by design).',
};

// ---------------------------------------------------------------------------
// Re-exports: the surface index.js consumes, unchanged from the days when
// this layer was one file.
// ---------------------------------------------------------------------------

export {
  session, ShellRefusal, normalizeInternal, resolveAgainstCwd, toGateway,
  wordHasGlobMagic, unavailableRefusal,
} from './applets-support.js';
export { ensureApplets, expandGlob } from './applets-shelljs.js';
