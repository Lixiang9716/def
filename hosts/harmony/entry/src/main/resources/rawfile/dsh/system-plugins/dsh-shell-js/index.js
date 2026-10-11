// dsh:logging-exempt (plugin entry; logging happens through the mounted logger)
/**
 * dsh-shell-js — an in-process bash-subset shell for hosts that have none.
 *
 * The third shell executor in the family: `dsh-bash-local` spawns a real
 * binary, `dsh-shell-wasm` runs one WASM module per command, and THIS one
 * interprets a bash-subset language in pure JS over the gateway's seven fs
 * primitives — no process, no thread, everything on the serial queue. The
 * model's mental model stays the ordinary one: a command line in, stdout
 * and an exit status out.
 *
 * Composition (decision of record: tmp/shell-js-spikes/DECISION.md):
 *   - parser: vendored bash-parser@0.5.0, `{mode:'bash'}` (parser.js)
 *   - applet bodies: vendored shelljs@0.10.0 pristine behind outboard
 *     seams, four hand-written applets, two backed by repo modules
 *     (sha256.js, tar-mini.js) — applets.js
 *   - glob: vendored minimatch@10.0.3 + @isaacs/* as the matcher, a
 *     hand-written fsList walker (applets.js)
 *   - streams: in-memory 64KB-window pipes, pull-type backpressure,
 *     pipeline members run as coroutines interleaved at await points
 *     (stream.js)
 *
 * What the executor RUNS (the §4.3 whitelist — everything else fails by
 * name, exit 2, never silently): pipelines `a | b`, `&&`/`||`, `;`/newline
 * sequences, `>`, `>>`, `2>`, `2>>`, `FOO=bar` prefix assignments,
 * `$VAR`/`${VAR}` simple expansion, comments, and §4.1 globs in word
 * position (bash default: no match → the literal word).
 *
 * NOT honored, and said out loud: `$((…))` arithmetic, `$(…)`/backticks,
 * heredocs, subshells, `{ … }` groups, loops and conditionals, function
 * definitions, `<`/`>&`/`>|`/`<>` redirects, background jobs, `!`
 * negation, and EVERY AST node type outside the whitelist (the defensive
 * catch-all that keeps bash-parser's unaudited dialect corners safe);
 * flags outside an applet's implemented set; chmod/ln/touch/exec (no
 * gateway primitive can honor them — the refusal names the D5 path);
 * unknown programs are 127, self-describing like the wasm sibling.
 */
import { createLogger } from 'logger.js';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { fsWrite } from 'gateway.js';
import { parseCommandLine, ShellParseError } from './parser.js';
import {
  APPLETS, APPLET_NAMES, REFUSED_COMMANDS, ensureApplets, expandGlob,
  wordHasGlobMagic, session, normalizeInternal, resolveAgainstCwd, toGateway,
  ShellRefusal,
} from './applets.js';
import { createPipe, CaptureWriter } from './stream.js';

const log = createLogger('dsh.shell.js');

export const manifest = {
  schemaVersion: 1,
  id: 'dsh-shell-js',
  version: '0.1.0',
  type: 'service',
  entry: 'index.js',
  // Exactly the contract's fs face (contract/primitives.md rows 1–2 and
  // 10–14): every name here exists in the frozen table, nothing else.
  capabilities: {
    required: ['fsRead', 'fsWrite', 'fsStat', 'fsList', 'fsMkdir', 'fsRemove', 'fsRename'],
    optional: [],
  },
  hooks: { activate: 'activate' },
};

// ---------------------------------------------------------------------------
// The refusal vocabulary (the house rule): every failure names what is
// missing. Exit 2 for constructs/flags, 127 for unknown programs.
// ---------------------------------------------------------------------------

const refuse = (message) => ({ exitCode: 2, stdout: '', stderr: `dsh-shell-js: ${message}` });

const notFound = (program) => ({
  exitCode: 127,
  stdout: '',
  stderr: `${program}: not found. Available applets: ${APPLET_NAMES}. `
    + 'This shell has no PATH — the applets above are everything it runs, '
    + 'in-process over the gateway fs primitives. File work outside them '
    + 'belongs to the fs tools (read/list/write/edit).',
});

/** Friendly names for refused AST node types (§4.2). */
const NODE_LABELS = {
  Subshell: 'subshells ( … )',
  CompoundList: 'command groups { … }',
  If: 'if',
  While: 'while',
  Until: 'until',
  For: 'for',
  Case: 'case',
  Function: 'function definitions',
};

/** Friendly names for refused redirect operators (§4.2). */
const REDIRECT_LABELS = {
  less: '< (input redirect)',
  clobber: '>|',
  lessgreat: '<>',
  greatand: '>& (fd duplication)',
  dless: '<< (heredoc)',
  tless: '<<< (here-string)',
  lessand: '<&',
};

// ---------------------------------------------------------------------------
// Word evaluation: simple $VAR/${VAR} expansion + quote removal, the
// bash-parser contract exactly (words WITHOUT expansions are pre-folded by
// the parser; words WITH them carry raw text and loc offsets — verified
// against the parser during the decision round).
// ---------------------------------------------------------------------------

const expandWord = (word, vars) => {
  const text = String(word.text ?? '');
  const expansions = [...(word.expansion ?? [])].sort((a, b) => a.loc.start - b.loc.start);
  // Words WITHOUT expansions arrive already quote-folded by the parser
  // (probe-verified: `echo 'a"b'` carries the literal `a"b`) — their text
  // is pure data and must not run the quote machine again. Only
  // expansion-bearing words keep raw syntax quotes (the locs index them).
  if (expansions.length === 0) return text;
  for (const expansion of expansions) {
    if (expansion.type === 'ArithmeticExpansion') {
      throw new ShellRefusal(2, 'arithmetic expansion $((…)) is not implemented');
    }
    if (expansion.type === 'CommandExpansion') {
      throw new ShellRefusal(2, 'command substitution $(…)/backticks is not implemented');
    }
    if (expansion.type !== 'ParameterExpansion') {
      throw new ShellRefusal(2, `expansion type '${expansion.type}' is not implemented`);
    }
    if (expansion.op !== undefined || expansion.kind !== undefined) {
      throw new ShellRefusal(2, `parameter expansion operator on '${expansion.parameter}' is not `
        + 'implemented (only the simple $VAR / ${VAR} form is)');
    }
  }
  // Walk the raw text with a quote state machine: inside loc ranges emit
  // the value; quote characters at syntax positions are dropped; a quote
  // inside double quotes stays literal (bash semantics, probe-verified).
  let out = '';
  let inSingle = false;
  let inDouble = false;
  let at = 0;
  let expIndex = 0;
  while (at < text.length) {
    const expansion = expansions[expIndex];
    if (expansion !== undefined && at === expansion.loc.start) {
      if (!inSingle) out += String(vars[expansion.parameter] ?? '');
      else out += text.slice(at, expansion.loc.end + 1); // '…$X…' stays literal
      at = expansion.loc.end + 1;
      expIndex += 1;
      continue;
    }
    const ch = text[at];
    if (!inSingle && !inDouble && ch === "'") { inSingle = true; at += 1; continue; }
    if (inSingle && ch === "'") { inSingle = false; at += 1; continue; }
    if (!inSingle && !inDouble && ch === '"') { inDouble = true; at += 1; continue; }
    if (inDouble && ch === '"') { inDouble = false; at += 1; continue; }
    out += ch;
    at += 1;
  }
  return out;
};

/** Word-position evaluation: expansion first, then globbing (bash order —
 * the program never sees the pattern). No match → the literal word (the
 * bash default; nullglob/failglob are not exposed in v1). */
const evaluateWord = async (word, vars) => {
  const expanded = expandWord(word, vars);
  if (!wordHasGlobMagic(expanded)) return [expanded];
  const matches = await expandGlob(expanded);
  if (matches === null || matches.length === 0) return [expanded];
  return matches;
};

// ---------------------------------------------------------------------------
// Redirect targets: a sink that buffers the member's output and performs
// exactly one fsWrite at close ({append} maps both '>' create and '>>').
// ---------------------------------------------------------------------------

class RedirectSink {
  constructor(internal, append) {
    log.debug('redirect sink', { internal, append });
    const g = toGateway(internal);
    this.scope = g.scope;
    this.path = g.path;
    this.append = append === true;
    this.parts = [];
    this.bytesLength = 0;
    this.closed = false;
  }

  async write(chunk) {
    const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
    if (this.closed) throw new Error('write to a closed redirect');
    this.parts.push(bytes);
    this.bytesLength += bytes.length;
  }

  /** The flush is the close: one fsWrite. A failure propagates to the
   * caller — the member turns it into the command's failure (bash reports
   * `cannot create …` and exits 1); it must never become a silent
   * success. */
  async close() {
    if (this.closed) return;
    this.closed = true;
    const out = new Uint8Array(this.bytesLength);
    let at = 0;
    for (const part of this.parts) { out.set(part, at); at += part.length; }
    await fsWrite(this.scope, this.path, out, { append: this.append });
  }
}

/** The run-wide capture state one `run()` folds into its result. */
class RunOutput {
  constructor() {
    this.stdout = new CaptureWriter();
    this.stderr = new CaptureWriter();
  }
  async text() {
    return { stdout: this.stdout.text(), stderr: this.stderr.text() };
  }
}

// ---------------------------------------------------------------------------
// Command execution (one pipeline member)
// ---------------------------------------------------------------------------

/** Execute one Command node as a pipeline member. `stdin` is the pipe from
 * the previous member (or null); `stdout` is where this member's stdout
 * goes (the next pipe, or the run capture). The member CLOSES what it owns
 * (redirect sinks flush; pipe writers give the downstream its EOF) so a
 * pipeline can never deadlock on an open end. */
const runMember = async (node, { stdin, stdout, runOutput }) => {
  if (node.async === true) {
    throw new ShellRefusal(2, 'background jobs (&) are not implemented — commands run to completion');
  }
  if (node.bang === true) {
    throw new ShellRefusal(2, 'command negation (!) is not implemented');
  }

  // Prefix: assignments only (a Redirect in prefix position — the `&>`
  // mis-parse — is refused by its operator name below).
  const commandVars = { ...session.vars };
  for (const item of node.prefix ?? []) {
    if (item.type !== 'AssignmentWord') {
      if (item.type === 'Redirect') {
        const label = REDIRECT_LABELS[item.op?.type] ?? `'${item.op?.text ?? item.op?.type}'`;
        throw new ShellRefusal(2, `redirect ${label} in prefix position is not implemented`);
      }
      throw new ShellRefusal(2, `prefix entry type '${item.type}' is not supported in assignment position`);
    }
    const eq = item.text.indexOf('=');
    if (eq <= 0) throw new ShellRefusal(2, `assignment '${item.text}' is malformed`);
    commandVars[item.text.slice(0, eq)] = item.text.slice(eq + 1);
  }

  // Suffix: words and redirects; anything else in argument position (the
  // 'dless' heredoc token, notably) is refused by name.
  const wordNodes = [];
  const redirects = [];
  for (const item of node.suffix ?? []) {
    if (item.type === 'Word') wordNodes.push(item);
    else if (item.type === 'Redirect') redirects.push(item);
    else {
      throw new ShellRefusal(2, `token '${item.text ?? item.type}' (type ${item.type}) is not supported in argument position${item.type === 'dless' ? ' — heredocs are not implemented' : ''}`);
    }
  }

  // Redirects: '>' create, '>>' append, '2>'/'2>>' stderr (§4.3). A target
  // that escapes the workspace is refused by name (resolveAgainstCwd
  // folding null into the root would silently write the workspace root —
  // the house rule forbids exactly that).
  let memberStdout = stdout;
  let memberStderr = runOutput.stderr;
  for (const redirect of redirects) {
    const op = redirect.op?.type;
    const target = expandWord(redirect.file, commandVars);
    const fd = redirect.numberIo?.text ?? '1';
    if (op === 'great' || op === 'dgreat') {
      const append = op === 'dgreat';
      const spelling = append ? '>>' : '>';
      const internal = resolveAgainstCwd(target);
      if (internal === null) {
        throw new ShellRefusal(2, `redirect target '${target}' escapes the workspace`);
      }
      if (fd === '1') memberStdout = new RedirectSink(internal, append);
      else if (fd === '2') memberStderr = new RedirectSink(internal, append);
      else {
        throw new ShellRefusal(2, `redirect ${fd}${spelling} targets fd ${fd}; only stdout (1) and stderr (2) are redirected`);
      }
    } else {
      const label = REDIRECT_LABELS[op] ?? `'${redirect.op?.text ?? op}'`;
      throw new ShellRefusal(2, `redirect ${label} is not implemented (supported: > >> 2> 2>>)`);
    }
  }

  // Close what this member owes: a pipe writer delivers the downstream its
  // EOF (without it the reader would wait forever — a deadlock on a
  // single-threaded runtime), a redirect sink flushes its single fsWrite.
  // That includes a pipe writer a REDIRECT REPLACED (`echo hi > f | wc`:
  // the member's stdout became the sink, but the pipe to the next member
  // still owes it an EOF — the post-Promise.all abort backstop can never
  // reach a member still parked on that read). Never throws; returns the
  // FIRST close failure so the caller can fail the command (a failed
  // redirect write is bash's `cannot create …`, exit 1 — never a silent
  // success), while an already-failed member just does the bookkeeping
  // without masking its own error.
  const closeOwnedSinks = async () => {
    let failure = null;
    if (memberStdout !== stdout && stdout !== runOutput.stdout) {
      try { await stdout.close(); } catch (error) { failure = error; }
    }
    if (memberStdout !== runOutput.stdout) {
      try { await memberStdout.close(); } catch (error) { failure = failure ?? error; }
    }
    if (memberStderr !== runOutput.stderr) {
      try { await memberStderr.close(); } catch (error) { failure = failure ?? error; }
    }
    return failure;
  };

  // The success-path exit: close, and a flush failure fails the command
  // (exit 1, stderr naming the target) without stopping the rest of the
  // line — bash runs the next command after a failed redirect write.
  const exitThrough = async (code) => {
    const failure = await closeOwnedSinks();
    if (failure !== null) {
      await runOutput.stderr.write(`dsh-shell-js: redirect write failed: ${failure?.message ?? failure}\n`);
      return { exitCode: 1 };
    }
    return { exitCode: code };
  };

  // Assignment-only command (no program word): persists, bash semantics.
  if (node.name === undefined || node.name === null) {
    Object.assign(session.vars, commandVars);
    return exitThrough(0);
  }

  // The program word and argv (glob expansion in word position).
  const program = expandWord(node.name, commandVars);
  const argv = [];
  for (const word of wordNodes) {
    argv.push(...await evaluateWord(word, commandVars));
  }

  const applet = APPLETS[program];
  try {
    if (applet === undefined) {
      if (Object.prototype.hasOwnProperty.call(REFUSED_COMMANDS, program)) {
        throw new ShellRefusal(2, REFUSED_COMMANDS[program]);
      }
      const nf = notFound(program);
      await memberStderr.write(nf.stderr);
      return exitThrough(nf.exitCode);
    }
    const outcome = await applet(argv, { stdin, vars: commandVars });
    if (outcome.stdout.length > 0) await memberStdout.write(outcome.stdout);
    if (outcome.stderr.length > 0) await memberStderr.write(outcome.stderr);
    return exitThrough(outcome.code);
  } catch (error) {
    // The member already failed; closing is best-effort EOF/flush
    // bookkeeping and must not mask the original error.
    await closeOwnedSinks();
    throw error;
  }
};

/** One pipeline: members launched as coroutines at once, connected by
 * 64KB-window pipes (pull-type backpressure — stream.js), status = the
 * LAST member's (§4.3). Every member closes its stdin on exit, so an
 * upstream writer blocked on a full window refuses by name (the EPIPE
 * posture) instead of hanging the run — on a single-threaded runtime a
 * hang would be unkillable. */
const runPipeline = async (commands, runOutput) => {
  log.debug('pipeline', { members: commands.length });
  const pipes = [];
  for (let i = 0; i < commands.length - 1; i += 1) pipes.push(createPipe());
  const stdinOf = (i) => (i === 0 ? null : pipes[i - 1].reader);
  const stdoutOf = (i) => (i === pipes.length ? runOutput.stdout : pipes[i].writer);

  const jobs = commands.map((node, i) => (async () => {
    try {
      return await runMember(node, {
        stdin: stdinOf(i),
        stdout: stdoutOf(i),
        runOutput,
      });
    } catch (error) {
      return {
        exitCode: error instanceof ShellRefusal ? error.exitCode : 1,
        error,
      };
    } finally {
      const reader = stdinOf(i);
      if (reader !== null) reader.close();
    }
  })());

  const settled = await Promise.all(jobs);

  // Backstop: any pipe still open (a member that threw before its finally
  // ran is impossible — finally always runs — but an aborted pipe must
  // never leak waiting wake-ups).
  for (const pipe of pipes) pipe.writer.abort('pipeline complete');

  let last = settled[settled.length - 1] ?? { exitCode: 0 };
  let refused = false;
  for (const result of settled) {
    if (result.error instanceof ShellRefusal) {
      await runOutput.stderr.write(`${result.error.message}\n`);
      refused = true; // a construct-level refusal stops the whole line (§4.2)
    } else if (result.error !== undefined) {
      await runOutput.stderr.write(`dsh-shell-js: pipeline member failed: ${result.error?.message ?? result.error}\n`);
    }
  }
  if (last.error !== undefined) last = { exitCode: last.exitCode };
  return { exitCode: last.exitCode, refused };
};

// ---------------------------------------------------------------------------
// The AST evaluator (§4.3 whitelist; §4.2 refusals)
// ---------------------------------------------------------------------------

const evaluateNode = async (node, runOutput) => {
  if (node.type === 'Command') return runPipeline([node], runOutput);
  if (node.type === 'Pipeline') return runPipeline(node.commands, runOutput);
  if (node.type === 'LogicalExpression') {
    const left = await evaluateNode(node.left, runOutput);
    if (node.op === 'and' && left.exitCode !== 0) return left;
    if (node.op === 'or' && left.exitCode === 0) return left;
    return evaluateNode(node.right, runOutput);
  }
  const label = NODE_LABELS[node.type] ?? `'${node.type}'`;
  const message = `dsh-shell-js: construct ${label} is not implemented by this shell `
    + '(pipelines, &&/||, sequences, redirects and assignments are)';
  await runOutput.stderr.write(`${message}\n`);
  return { exitCode: 2 };
};

const runCommand = async (command) => {
  let ast;
  try {
    ast = parseCommandLine(command);
  } catch (error) {
    if (error instanceof ShellParseError) {
      return refuse(`parse error — ${error.message}${error.syntax ? ' (unclosed quote)' : ''}`);
    }
    return refuse(`parse error — ${error?.message ?? error}`);
  }
  if (ast === null) return { exitCode: 0, stdout: '', stderr: '' };
  if (ast.type !== 'Script' || !Array.isArray(ast.commands)) {
    return refuse(`top-level node '${ast.type}' is not a command script`);
  }

  const runOutput = new RunOutput();
  let status = { exitCode: 0 };
  for (const node of ast.commands) {
    status = await evaluateNode(node, runOutput);
    if (status.refused === true) break; // the line refuses as one (§4.2)
  }
  const text = await runOutput.text();
  return { exitCode: status.exitCode, stdout: text.stdout, stderr: text.stderr };
};

/** The initial cwd of a run from the request's workdir: device-absolute
 * spellings inside the workspace map in; anything else is treated as
 * workspace-relative; an escape keeps the current cwd (session-persistent
 * across runs of this shell instance, like upstream `ctx.shell`). */
const applyWorkdir = (workdir) => {
  if (typeof workdir !== 'string' || workdir.length === 0) return;
  const workspace = globalThis.__dshProfileCwd;
  let rel = workdir;
  if (typeof workspace === 'string' && workdir.startsWith(workspace)) {
    rel = workdir.slice(workspace.length);
  }
  const clean = normalizeInternal(rel);
  if (clean !== null) session.cwd = clean;
};

/** The `shell` capability, as the upstream tool layer consumes it: `resolve`
 * normalizes a request (the dsh-shell-wasm shape), `run` executes one
 * foreground command line. `timeoutMs`/`stdoutMaxBytes` are normalized and
 * carried, not enforced in v1 (the applets are bounded gateway calls; the
 * loop constructs that could hang are refused — §4.3). */
export function activate({ register }) {
  register('shell', {
    resolve(request) {
      return {
        command: request.command,
        workdir: request.workdir ?? globalThis.__dshProfileCwd ?? '',
        timeoutMs: request.timeoutMs,
        stdoutMaxBytes: request.stdoutMaxBytes,
      };
    },
    async run(request) {
      const spec = this.resolve(request);
      await ensureApplets();
      // Only an EXPLICIT workdir re-anchors the session — resolve()'s
      // default (the pinned workspace) would otherwise reset `cd` state on
      // every run of the same shell.
      if (request.workdir !== undefined) applyWorkdir(spec.workdir);
      const result = await runCommand(spec.command);
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        command: spec.command,
      };
    },
    // No sandbox mode: there is no process to confine. Everything the
    // shell touches goes through the gateway primitives, which are already
    // scope-confined and audited per call.
    sandboxMode: undefined,
  });
}

/** The spine's mount shape (boot.js): the same executor, plus the
 * model-facing `shell` tool (the dsh-shell-wasm layout — one
 * implementation seen from two sides). */
export const name = 'dsh-shell-js';
export const inject = ['tools'];

export const shellExecutor = {
  resolve(request) {
    return {
      command: request.command,
      workdir: request.workdir ?? globalThis.__dshProfileCwd ?? '',
      timeoutMs: request.timeoutMs,
      stdoutMaxBytes: request.stdoutMaxBytes,
    };
  },
  async run(request) {
    const spec = this.resolve(request);
    await ensureApplets();
    if (request.workdir !== undefined) applyWorkdir(spec.workdir);
    const result = await runCommand(spec.command);
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      command: spec.command,
    };
  },
  sandboxMode: undefined,
};

const SHELL_DESCRIPTION = 'A bash-subset shell running IN-PROCESS over this '
  + "host's scoped workspace (no /bin exists; the applets: "
  + `${APPLET_NAMES}). Supported: pipelines (a | b), && / ||, ; sequences, `
  + 'redirects > >> 2> 2>>, FOO=bar assignments, $VAR/${VAR} expansion, '
  + 'globs in word position (no match passes through as a literal word). '
  + 'NOT implemented, and refused by name with exit 2: arithmetic $((…)), '
  + 'command substitution $(…), heredocs, subshells, loops, if/case, '
  + 'functions, input redirects, background jobs; chmod/ln/touch (no '
  + 'gateway primitive exists — the refusal says so); flags outside an '
  + "applet's implemented set (ls -l, cp -p, tar -z). Unknown programs are "
  + 'exit 127 with the applet list. DIALECT NOTES (real divergences, on '
  + 'purpose): grep/sed patterns are JavaScript RegExp, NOT POSIX BRE/ERE '
  + '(\\d, +, lookahead work; \\( does not; sed takes the no-separator form '
  + 'sed <regex> <replacement> <file> and string patterns carry no flags); '
  + 'sort/uniq compare with localeCompare; all I/O is whole-file, utf8 '
  + 'end-to-end, bounded by the host max read size (an oversize read '
  + 'fails naming the file); ls never shows . or .. and has no -l (no '
  + 'mode/owner exists to show); env prints the SHELL variable table, not '
  + 'a process environment (none exists); tar is uncompressed (no inflate '
  + 'primitive) and archives regular files only; timeoutMs/stdoutMaxBytes '
  + 'are carried, not enforced (commands are bounded gateway calls).';

export const apply = (ctx) => {
  ctx.tools.register(defineTool({
    name: 'shell',
    description: SHELL_DESCRIPTION,
    parameters: {
      command: {
        type: 'string',
        required: true,
        description: 'The command line, e.g. "cat notes.txt | grep TODO" — '
          + 'a bash-subset line over the scoped workspace.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          exitCode: { type: 'integer', required: true },
          stdout: { type: 'string', required: true },
          stderr: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.stdout}${value.stderr}`
          + `\n[exit code: ${value.exitCode}]`,
      }],
    },
    async execute(args) {
      const result = await shellExecutor.run({ command: args.command });
      return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    },
  }));
  log.info('dsh-shell-js tools registered', { applets: APPLET_NAMES.split(', ').length });
};
