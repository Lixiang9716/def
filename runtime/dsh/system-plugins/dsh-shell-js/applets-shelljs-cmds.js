/**
 * applets-shelljs-cmds.js — the shelljs-backed applets: cat, echo, cd,
 * ls, grep, sed, head/tail, sort, uniq, mkdir, rm, mv, cp, find. The
 * bodies are byte-pristine vendored shelljs 0.10.0; ALL adaptation is in
 * these wrappers (the prefetch/invoke/replay shape from applets-shelljs.js,
 * the flag tables, and the by-name refusals). Split out of the original
 * single applets.js for the code-size gate's budgets.
 */

import {
  ShellRefusal, resolveAgainstCwd, toGateway, splitFlags, textOfStdin, P,
  session,
} from './applets-support.js';

const log = createLogger('dsh.shell.js.cmds');
import { createLogger } from 'logger.js';
import { fsStat } from 'gateway.js';
import {
  runShelljs, shellStringOutcome, piped, shellState, ensureApplets,
} from './applets-shelljs.js';

/** cat: files or stdin, -n numbering (GNU format lives in the body).
 * Note: shelljs's wrap() unshifts a dummy options string itself, so the
 * no-flag call passes NO options argument — an explicit '' would be
 * unshifted a second time and read as an empty file name. */
export const appletCat = async (argv, ctx) => {
  log.debug('applet', { applet: 'cat' });
  const { flags, args } = splitFlags(argv, new Set('n'));
  const stdinText = args.length === 0 ? await textOfStdin(ctx.stdin) : null;
  if (args.length === 0 && stdinText === null) {
    throw new ShellRefusal(2, 'cat: no files given (no pipeline stdin either)');
  }
  const callArgs = 'n' in flags ? [{ number: true }] : [];
  const result = await runShelljs(
    async (snap) => { for (const file of args) await snap.readFile(file); },
    () => (args.length === 0
      ? piped(stdinText).cat(...callArgs)
      : shellState.shell.cat(...callArgs, ...args)),
  );
  return shellStringOutcome(result);
};

/** echo: no fs; util.format conventions (the body owns -n/-e). */
export const appletEcho = async (argv) => {
  log.debug('applet', { applet: 'echo' });
  await ensureApplets();
  return shellStringOutcome(shellState.shell.echo(...argv));
};

/** cd: wrapper-owned (the pristine body drives process.chdir, which no
 * process-less host has) — fsStat + session cwd mutation (§4.1 #4). */
export const appletCd = async (argv) => {
  log.debug('applet', { applet: 'cd' });
  const target = argv[0];
  let internal;
  if (target === '-') {
    if (session.oldpwd === null) {
      throw new ShellRefusal(2, 'cd: could not find previous directory (no OLDPWD yet)');
    }
    internal = session.oldpwd;
  } else if (target === undefined || target === '~' || target === '') {
    internal = ''; // home = the workspace root
  } else {
    internal = resolveAgainstCwd(target);
  }
  if (internal === null) {
    throw new ShellRefusal(2, `cd: '${target}' escapes the workspace`);
  }
  const g = toGateway(internal === '' ? '.' : internal);
  let stat;
  try {
    stat = await fsStat(g.scope, g.path);
  } catch {
    throw new ShellRefusal(2, `cd: no such file or directory: ${target ?? '/'}`);
  }
  if (stat.kind !== 'dir') throw new ShellRefusal(2, `cd: not a directory: ${target}`);
  session.oldpwd = session.cwd;
  session.cwd = internal;
  return { stdout: '', stderr: '', code: 0 };
};

/** ls: -a/-A, -R, -d honor-able; -l/-L refused by name (§2.2, §4.1 #5). */
export const appletLs = async (argv) => {
  log.debug('applet', { applet: 'ls' });
  const { flags, args } = splitFlags(argv, new Set(['a', 'A', 'R', 'd']));
  const targets = args.length > 0 ? args : ['.'];
  const result = await runShelljs(
    async (snap) => {
      for (const target of targets) {
        await snap.stat(target);
        const entry = snap.files.get(resolveAgainstCwd(target));
        if (entry?.kind === 'dir') {
          if ('R' in flags) await snap.listTree(target);
          else await snap.listDir(target);
        }
      }
    },
    () => shellState.shell.ls({
      all: 'a' in flags || 'A' in flags,
      recursive: 'R' in flags,
      directory: 'd' in flags,
    }, ...targets),
  );
  return shellStringOutcome(result);
};

/** grep: the pristine filter; patterns are JavaScript RegExp, not POSIX
 * BRE/ERE (the §6 disclosure, carried into the tool description). */
const grepOptions = (flags) => ({
  inverse: 'v' in flags,
  nameOnly: 'l' in flags,
  ignoreCase: 'i' in flags,
  lineNumber: 'n' in flags,
  beforeContext: flags.B?.[0],
  afterContext: flags.A?.[0],
  context: flags.C?.[0],
});

export const appletGrep = async (argv, ctx) => {
  log.debug('applet', { applet: 'grep' });
  const { flags, args } = splitFlags(argv, new Set(['v', 'l', 'i', 'n', 'B', 'A', 'C']), {
    valueFlags: new Set(['B', 'A', 'C']),
  });
  if (args.length === 0) throw new ShellRefusal(2, 'grep: a pattern is required');
  const pattern = args[0];
  const files = args.slice(1);
  const stdinText = files.length === 0 ? await textOfStdin(ctx.stdin) : null;
  if (files.length === 0 && stdinText === null) {
    throw new ShellRefusal(2, 'grep: no files given (no pipeline stdin either)');
  }
  const options = grepOptions(flags);
  const result = await runShelljs(
    async (snap) => { for (const file of files) await snap.readFile(file); },
    () => (files.length === 0
      ? piped(stdinText).grep(options, pattern)
      : shellState.shell.grep(options, pattern, ...files)),
  );
  return shellStringOutcome(result);
};

/** sed: the no-separator form (regex, replacement, files); -i via fsWrite
 * replay; patterns are JavaScript RegExp with no flags on string patterns
 * (the §6 disclosure). */
export const appletSed = async (argv, ctx) => {
  log.debug('applet', { applet: 'sed' });
  const { flags, args } = splitFlags(argv, new Set('i'));
  if (args.length < 2) {
    throw new ShellRefusal(2, 'sed: usage: sed [-i] <regex> <replacement> <file...> '
      + '(the no-separator form; s/x/y/ strings are not implemented)');
  }
  const [regex, replacement] = args;
  const files = args.slice(2);
  const stdinText = files.length === 0 ? await textOfStdin(ctx.stdin) : null;
  if (files.length === 0 && stdinText === null) {
    throw new ShellRefusal(2, 'sed: no files given (no pipeline stdin either)');
  }
  const options = { inplace: 'i' in flags };
  const result = await runShelljs(
    async (snap) => { for (const file of files) await snap.readFile(file); },
    () => (files.length === 0
      ? piped(stdinText).sed(options, regex, replacement)
      : shellState.shell.sed(options, regex, replacement, ...files)),
  );
  return shellStringOutcome(result);
};

/** head/tail: whole-file reads under the in-memory fd emulation (§2.2). */
export const headTail = (isHead) => async (argv, ctx) => {
  log.debug('applet', { applet: isHead ? 'head' : 'tail' });
  const { flags, args } = splitFlags(argv, new Set('n'), { valueFlags: new Set('n') });
  const files = args;
  const stdinText = files.length === 0 ? await textOfStdin(ctx.stdin) : null;
  const value = flags.n?.[0];
  // The options object is passed ONLY when -n was given (the '' trap: see
  // appletCat).
  const callArgs = value === undefined ? [] : [{ numLines: String(value).replace(/^[+-]/, '') }];
  const result = await runShelljs(
    async (snap) => { for (const file of files) await snap.readFile(file); },
    () => (files.length === 0
      ? piped(stdinText)[isHead ? 'head' : 'tail'](...callArgs)
      : shellState.shell[isHead ? 'head' : 'tail'](...callArgs, ...files)),
  );
  return shellStringOutcome(result);
};

/** sort: read + compare (localeCompare dialect, the §6 disclosure). */
export const appletSort = async (argv, ctx) => {
  log.debug('applet', { applet: 'sort' });
  const { flags, args } = splitFlags(argv, new Set(['r', 'n']));
  const files = args;
  const stdinText = files.length === 0 ? await textOfStdin(ctx.stdin) : null;
  const options = { reverse: 'r' in flags, numerical: 'n' in flags };
  const result = await runShelljs(
    async (snap) => { for (const file of files) await snap.readFile(file); },
    () => (files.length === 0
      ? piped(stdinText).sort(options)
      : shellState.shell.sort(options, ...files)),
  );
  return shellStringOutcome(result);
};

/** uniq: read + compare (-i/-c/-d). */
export const appletUniq = async (argv, ctx) => {
  log.debug('applet', { applet: 'uniq' });
  const { flags, args } = splitFlags(argv, new Set(['i', 'c', 'd']));
  const files = args;
  const stdinText = files.length === 0 ? await textOfStdin(ctx.stdin) : null;
  const options = { ignoreCase: 'i' in flags, count: 'c' in flags, duplicates: 'd' in flags };
  const result = await runShelljs(
    async (snap) => { for (const file of files) await snap.readFile(file); },
    () => (files.length === 0
      ? piped(stdinText).uniq(options)
      : shellState.shell.uniq(options, ...files)),
  );
  return shellStringOutcome(result);
};

/** mkdir: recursive + existing-ok are fsMkdir natives (§4.1 #12). */
export const appletMkdir = async (argv) => {
  log.debug('applet', { applet: 'mkdir' });
  const { flags, args } = splitFlags(argv, new Set('p'));
  if (args.length === 0) throw new ShellRefusal(2, 'mkdir: missing operand');
  const result = await runShelljs(
    async (snap) => { for (const dir of args) await snap.stat(dir); },
    () => shellState.shell.mkdir({ fullpath: 'p' in flags }, ...args),
  );
  return shellStringOutcome(result);
};

/** rm: recursive + missing-ok are fsRemove natives (§4.1 #13). */
export const appletRm = async (argv) => {
  log.debug('applet', { applet: 'rm' });
  const { flags, args } = splitFlags(argv, new Set(['f', 'r', 'R']));
  if (args.length === 0) throw new ShellRefusal(2, 'rm: missing operand');
  const recursive = 'r' in flags || 'R' in flags;
  const result = await runShelljs(
    async (snap) => {
      for (const target of args) {
        await snap.stat(target);
        if (recursive) await snap.listTree(target);
      }
    },
    () => shellState.shell.rm({ force: 'f' in flags, recursive }, ...args),
  );
  return shellStringOutcome(result);
};

/** mv: fsRename's POSIX replace-target semantics are native (§4.1 #14). */
export const appletMv = async (argv) => {
  log.debug('applet', { applet: 'mv' });
  const { flags, args } = splitFlags(argv, new Set(['f', 'n']));
  if (args.length < 2) throw new ShellRefusal(2, 'mv: missing destination file operand');
  const dest = args[args.length - 1];
  const result = await runShelljs(
    async (snap) => {
      for (const arg of args) await snap.stat(arg);
      const destKey = resolveAgainstCwd(dest);
      if (snap.files.get(destKey)?.kind === 'dir') await snap.listDir(destKey);
    },
    () => shellState.shell.mv({ no_force: 'n' in flags }, ...args),
  );
  return shellStringOutcome(result);
};

/** A recursive copy reads every file UNDER the tree — listing is not
 * enough, contents must be prefetched too (the cpdirSyncRecursive body
 * reads each member's bytes). */
const prefetchTreeFiles = async (snap, source) => {
  log.debug('prefetch tree', { source });
  await snap.listTree(source);
  const treeKey = resolveAgainstCwd(source);
  for (const key of [...snap.files.keys()]) {
    const under = treeKey === '' || key.startsWith(`${treeKey}/`);
    if (snap.files.get(key)?.kind === 'file' && under) await snap.readFile(key);
  }
};

/** cp: -p refused by name (preserve needs owner/timestamps — no
 * primitives); plain/-r/-u honor-able (§2.2, §4.1 #15). */
export const appletCp = async (argv) => {
  log.debug('applet', { applet: 'cp' });
  const { flags, args } = splitFlags(argv, new Set(['r', 'R', 'u', 'f', 'n']));
  if (args.length < 2) throw new ShellRefusal(2, 'cp: missing destination file operand');
  const sources = args.slice(0, -1);
  const dest = args[args.length - 1];
  const result = await runShelljs(
    async (snap) => {
      // cpdirSyncRecursive stats the dest's PARENT before recursing, and
      // its upward walk existsSync-probes every ancestor — so the prefetch
      // covers each source/dest ancestor chain, not just the leaf paths.
      const statChain = async (p) => {
        let cur = resolveAgainstCwd(p);
        while (cur !== null) {
          await snap.stat(cur === '' ? '.' : cur); // eslint-disable-line no-await-in-loop
          if (cur === '') break;
          const cut = cur.lastIndexOf('/');
          cur = cut <= 0 ? '' : cur.slice(0, cut);
        }
      };
      for (const source of sources) {
        await snap.stat(source);
        const entry = snap.files.get(resolveAgainstCwd(source));
        if (entry?.kind === 'dir') await prefetchTreeFiles(snap, source);
        else if (entry?.kind === 'file') await snap.readFile(source);
      }
      await snap.stat(dest);
      await statChain(dest);
      const destKey = resolveAgainstCwd(dest);
      if (snap.files.get(destKey)?.kind === 'dir') await snap.listDir(destKey);
    },
    () => shellState.shell.cp({
      recursive: 'r' in flags || 'R' in flags,
      update: 'u' in flags,
      no_force: 'n' in flags,
    }, ...args),
  );
  return shellStringOutcome(result);
};

/** find: the pristine walk, plus the wrapper's -name filter over vendored
 * minimatch; every other flag refused (§4.1 #16). */
export const appletFind = async (argv) => {
  log.debug('applet', { applet: 'find' });
  const { flags, args } = splitFlags(argv, new Set(['name']), { valueFlags: new Set(['name']) });
  const paths = args.length > 0 ? args : ['.'];
  const namePattern = flags.name?.[0];
  const result = await runShelljs(
    async (snap) => {
      for (const p of paths) {
        await snap.stat(p);
        if (snap.files.get(resolveAgainstCwd(p))?.kind === 'dir') await snap.listTree(p);
      }
    },
    () => shellState.shell.find(...paths),
  );
  let outcome = shellStringOutcome(result);
  if (namePattern !== undefined) {
    const keep = outcome.stdout.split('\n')
      .filter((line) => line !== '' && shellState.minimatch(P.basename(line), namePattern, { dot: false }));
    outcome = {
      stdout: keep.length > 0 ? `${keep.join('\n')}\n` : '',
      stderr: outcome.stderr,
      code: outcome.code,
    };
  }
  return outcome;
};
