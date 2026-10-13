/**
 * applets-hand.js — the hand-written applets (§2.1: absent from shelljs):
 * wc, env, basename, dirname, plus the repo-module-backed sha256sum
 * (runtime/dsh/sha256.js) and tar (runtime/dsh/tar-mini.js — uncompressed
 * ustar, regular files only, because the frozen gateway has no inflate
 * primitive). Split out of the original single applets.js for the
 * code-size gate's budgets.
 */

import { createLogger } from 'logger.js';
import { fsRead, fsStat, fsWrite } from 'gateway.js';
import { sha256Hex } from 'sha256.js';
import { tarWrite, tarRead } from 'tar-mini.js';
import {
  ShellRefusal, resolveAgainstCwd, toGateway, splitFlags, textOfStdin, P,
  session,
} from './applets-support.js';

const log = createLogger('dsh.shell.js.hand');

/** wc: lines/words/bytes over whole-file reads or stdin; -l/-w/-c
 * (§4.1 #17 — utf8 world: bytes = utf8 byte length). */
export const appletWc = async (argv, ctx) => {
  log.debug('applet', { applet: 'wc' });
  const { flags, args } = splitFlags(argv, new Set(['l', 'w', 'c']));
  const only = 'l' in flags || 'w' in flags || 'c' in flags;
  const want = { l: !only || 'l' in flags, w: !only || 'w' in flags, c: !only || 'c' in flags };
  const inputs = [];
  if (args.length === 0) {
    const stdinText = await textOfStdin(ctx.stdin);
    if (stdinText === null) throw new ShellRefusal(2, 'wc: no files given (no pipeline stdin either)');
    inputs.push({ name: null, text: stdinText });
  } else {
    for (const file of args) {
      const g = toGateway(resolveAgainstCwd(file));
      try {
        const read = await fsRead(g.scope, g.path);
        inputs.push({ name: file, text: new TextDecoder().decode(read.bytes) });
      } catch (error) {
        // The caller's spelling, never the gateway path — the error text
        // carries the workspace prefix the caller never wrote (the battery
        // caught it as "wc: missing.txt: cannot read dsh/missing.txt").
        void error;
        throw new ShellRefusal(2, `wc: ${file}: cannot read file`);
      }
    }
  }
  const out = inputs.map(({ name, text }) => {
    const lines = text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    const words = text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
    const bytes = new TextEncoder().encode(text).length;
    const parts = [want.l ? String(lines) : null, want.w ? String(words) : null, want.c ? String(bytes) : null];
    return `${parts.filter((x) => x !== null).join(' ')}${name !== null ? ` ${name}` : ''}\n`;
  });
  return { stdout: out.join(''), stderr: '', code: 0 };
};

/** env: prints the shell's variable table — NOT a host environment (there
 * is none). A prefix assignment scopes into the command (POSIX), so the
 * table shown is the session table overlaid with this command's
 * assignments (§2.3 piece 5, §4.1 #20). */
export const appletEnv = async (_argv, ctx) => {
  log.debug('applet', { applet: 'env' });
  const table = { ...session.vars, ...(ctx?.vars ?? {}) };
  const lines = Object.entries(table).map(([k, v]) => `${k}=${v}\n`);
  return { stdout: lines.join(''), stderr: '', code: 0 };
};

/** basename/dirname: pure path string ops, no fs (§4.1 #18/#19). */
export const appletBasename = async (argv) => {
  log.debug('applet', { applet: 'basename' });
  if (argv.length < 1) throw new ShellRefusal(2, 'basename: missing operand');
  const suffix = argv.length > 1 ? argv[1] : undefined;
  return { stdout: `${P.basename(argv[0], suffix)}\n`, stderr: '', code: 0 };
};

export const appletDirname = async (argv) => {
  log.debug('applet', { applet: 'dirname' });
  if (argv.length < 1) throw new ShellRefusal(2, 'dirname: missing operand');
  return { stdout: `${P.dirname(argv[0])}\n`, stderr: '', code: 0 };
};

/** sha256sum: whole-file fsRead bytes → runtime/dsh/sha256.js hex, text
 * format `<hex>␣␣<path>` (§4.1 #21). */
export const appletSha256sum = async (argv) => {
  log.debug('applet', { applet: 'sha256sum' });
  const { args } = splitFlags(argv, new Set());
  if (args.length === 0) throw new ShellRefusal(2, 'sha256sum: no files given');
  const out = [];
  for (const file of args) {
    const g = toGateway(resolveAgainstCwd(file));
    try {
      const read = await fsRead(g.scope, g.path);
      out.push(`${sha256Hex(read.bytes)}  ${file}\n`);
    } catch (error) {
      throw new ShellRefusal(2, `sha256sum: ${file}: ${error?.message ?? error}`);
    }
  }
  return { stdout: out.join(''), stderr: '', code: 0 };
};

/** The tar -c half: stat + read each named member (regular files only —
 * ustar regular-file-only, directories refused by name, never silently
 * skipped) and write the uncompressed archive. */
const tarCreate = async (archiveGateway, args) => {
  log.debug('tar create', { members: args.length });
  if (args.length === 0) {
    throw new ShellRefusal(2, 'tar -c: no members given (archive the files you name)');
  }
  const members = [];
  for (const member of args) {
    const key = resolveAgainstCwd(member);
    if (key === null) throw new ShellRefusal(2, `tar: '${member}' escapes the workspace`);
    const g = toGateway(key === '' ? '.' : key);
    let stat;
    try {
      stat = await fsStat(g.scope, g.path);
    } catch {
      throw new ShellRefusal(2, `tar: ${member}: no such file or directory`);
    }
    if (stat.kind !== 'file') {
      throw new ShellRefusal(2, `tar: ${member}: only regular files can be archived `
        + '(ustar regular-file-only — directories are refused, not silently skipped)');
    }
    const read = await fsRead(g.scope, g.path);
    members.push({ path: key, bytes: read.bytes });
  }
  await fsWrite(archiveGateway.scope, archiveGateway.path, tarWrite(members));
  return { stdout: '', stderr: '', code: 0 };
};

/** The tar -x half: extract every entry through fsWrite (the hostile-path
 * guards live in tar-mini). */
const tarExtract = async (entries) => {
  log.debug('tar extract', { members: entries.length });
  for (const member of entries) {
    const g = toGateway(member.path);
    await fsWrite(g.scope, g.path, member.bytes);
  }
  return { stdout: '', stderr: '', code: 0 };
};

/** tar: -c/-t/-x -f over runtime/dsh/tar-mini.js. -z is refused by name
 * (no inflate primitive — the same design note tar-mini carries);
 * directories-in-archive are refused, never silently skipped (§4.1 #22). */
export const appletTar = async (argv) => {
  log.debug('applet', { applet: 'tar' });
  const { flags, args } = splitFlags(argv, new Set(['c', 't', 'x', 'f']), {
    valueFlags: new Set(['f']),
  });
  const modes = ['c', 't', 'x'].filter((m) => m in flags);
  if (modes.length !== 1) {
    throw new ShellRefusal(2, 'tar: exactly one of -c/-t/-x is required');
  }
  const archive = flags.f?.[0];
  if (archive === undefined) {
    throw new ShellRefusal(2, 'tar: -f <archive> is required (stdin/stdout archives are not implemented)');
  }
  const archiveGateway = toGateway(resolveAgainstCwd(archive));
  if (modes[0] === 'c') return tarCreate(archiveGateway, args);
  let entries;
  try {
    const read = await fsRead(archiveGateway.scope, archiveGateway.path);
    entries = tarRead(read.bytes); // hostile-path guards live in tar-mini
  } catch (error) {
    throw new ShellRefusal(2, `tar: ${archive}: ${error?.message ?? error}`);
  }
  if (modes[0] === 't') {
    return { stdout: entries.map((m) => `${m.path}\n`).join(''), stderr: '', code: 0 };
  }
  return tarExtract(entries);
};
