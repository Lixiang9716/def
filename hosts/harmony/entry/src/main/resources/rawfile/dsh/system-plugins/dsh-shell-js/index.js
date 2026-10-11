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
 *   - parser: hand-written recursive-descent bash-subset parser
 *     (parser-syntax.js — replaced the vendored bash-parser@0.5.0 on
 *     2026-10-11; parser.js re-exports its two faces)
 *   - executor: the §4.3 whitelist evaluator (exec.js)
 *   - applet bodies: vendored shelljs@0.10.0 pristine behind outboard
 *     seams, four hand-written applets, two backed by repo modules
 *     (sha256.js, tar-mini.js) — applets.js + applets-*.js
 *   - glob: vendored minimatch@10.0.3 + @isaacs/* as the matcher, a
 *     hand-written fsList walker (applets-shelljs.js)
 *   - streams: in-memory 64KB-window pipes, pull-type backpressure,
 *     pipeline members run as coroutines interleaved at await points
 *     (stream.js)
 *
 * The executor's honored surface and its by-name refusals are documented
 * at the top of exec.js; the applet contract and honesty rules at the top
 * of applets.js.
 */
import { createLogger } from 'logger.js';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { APPLET_NAMES, ensureApplets } from './applets.js';
import { runCommand, applyWorkdir } from './exec.js';

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

/** The `shell` capability, as the upstream tool layer consumes it: `resolve`
 * normalizes a request (the dsh-shell-wasm shape), `run` executes one
 * foreground command line. `timeoutMs`/`stdoutMaxBytes` are normalized and
 * carried, not enforced in v1 (the applets are bounded gateway calls; the
 * loop constructs that could hang are refused — §4.3). */
const shellCapability = {
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
};

export function activate({ register }) {
  register('shell', shellCapability);
}

/** The spine's mount shape (boot.js): the same executor, plus the
 * model-facing `shell` tool (the dsh-shell-wasm layout — one
 * implementation seen from two sides). */
export const name = 'dsh-shell-js';
export const inject = ['tools'];

export const shellExecutor = shellCapability;

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
