/**
 * Shell scenario `dsh-shell-js` — the dsh-shell-js system plugin (the one
 * `shell` tool seat's executor) driven through the REAL ToolRuntime dispatch
 * on the desktop CLI carrier.
 *
 * Flow: the mobile profile boot mounts the plugin beside the spine (boot.js
 * `ctx.plugin(ShellJs)`), the scenario confirms the `shell` tool is offered,
 * then drives nine command lines covering the four behavior families the
 * seat's session-level proof owes:
 *
 *   1. quotes + variables — double-quote folding over $VAR / ${VAR}
 *      expansion (a prefix assignment seeding the table), and the
 *      single-quote literal that keeps `$WHO` unexpanded;
 *   2. redirects — `>` create and `>>` append through the gateway fsWrite,
 *      round-tripped BOTH through the shell (`cat`) AND out-of-band through
 *      the gateway itself (fsRead) — the file exists in the scope, not in
 *      some shell-private memory;
 *   3. pipelines — a three-member `cat | sort | head -n 1` over the
 *      in-memory 64KB-window pipes;
 *   4. by-name refusals (the house rule: every failure names what is
 *      missing) — command substitution `$(…)` (exit 2, construct named),
 *      `chmod` (exit 2, the missing permission primitive + the D5 contract
 *      path named), an unknown program (exit 127, the applet list named).
 *
 * Every command emits exactly one `shell/call`, then one `shell/stdout` or
 * `shell/refused`, then one `shell/exit` — the event sequence
 * test/e2e/scenarios/dsh-shell-js.json matches one-to-one, in order.
 * Artifacts land under runtime/dsh/artifacts/macos-cli-dsh-shell-js/.
 */
import { createLogger } from 'logger.js';
import { fsRead, fsScope } from 'gateway.js';
import { bootUpstream } from 'upstream/boot.js';

const SCENARIO = 'dsh-shell-js';
const AGENT_ID = 'main';
const SESSION_ID = 's-dsh-shell-js-0001';
const NOTES_NAME = 'notes.txt';
const NOTES_TEXT = 'beta-line\nalpha-line\n';

const log = createLogger('dsh.scenario');
const emit = (event, fields = {}) => log.info('e2e', { scenario: SCENARIO, event, ...fields });
const fail = (reason) => {
  const error = reason instanceof Error ? reason : null;
  const message = error ? error.message : String(reason);
  log.debug('scenario failed', { reason: message });
  emit('scenario.failed', { reason: message });
  globalThis.__dshComplete(false, message);
};
const demand = (cond, reason) => {
  if (cond) return;
  log.debug('demand failed', { reason });
  fail(reason);
  throw new Error(reason);
};

const launchEnv = () => {
  log.debug('launch env phase begin', {});
  const raw = globalThis.__dshLaunchEnv?.();
  demand(typeof raw === 'string', 'launch env snapshot missing (CLI must pass --env)');
  return JSON.parse(raw);
};

/** One `shell` dispatch through the REAL ToolRuntime: the tool's structured
 * value is exactly {exitCode, stdout, stderr} (the output schema). */
const dispatch = async (ctx, command) => {
  log.debug('shell dispatch', { command });
  const outcome = await ctx.tools.execute({
    name: 'shell',
    arguments: { command },
    callId: `${SCENARIO}.shell`,
    signal: new AbortController().signal,
  });
  demand(outcome?.isError !== true, `shell dispatch failed: ${JSON.stringify(outcome?.error ?? outcome).slice(0, 300)}`);
  const value = outcome.value;
  demand(value !== undefined && typeof value.exitCode === 'number'
    && typeof value.stdout === 'string' && typeof value.stderr === 'string',
  `shell returned no structured result: ${JSON.stringify(value).slice(0, 200)}`);
  return value;
};

/** The success-family drive: call → stdout → exit, the observed stdout
 * demanded against `want` before anything is emitted. */
const runCommand = async (ctx, command, want) => {
  log.debug('command begin', { command });
  emit('shell/call', { command });
  const value = await dispatch(ctx, command);
  demand(value.exitCode === 0, `command failed (${value.exitCode}): ${value.stderr.slice(0, 200)}`);
  demand(value.stdout === want, `stdout mismatch: ${JSON.stringify(value.stdout)} != ${JSON.stringify(want)}`);
  emit('shell/stdout', { stdout: value.stdout });
  emit('shell/exit', { exitCode: value.exitCode });
};

/** The refusal-family drive: call → refused → exit. The refusal must name
 * what is missing (the house rule) — every needle in `needles` must appear
 * on stderr, the exit code must be the refusal vocabulary's, and stdout
 * must stay empty. */
const runRefusal = async (ctx, command, wantExitCode, missing, needles) => {
  log.debug('refusal begin', { command });
  emit('shell/call', { command });
  const value = await dispatch(ctx, command);
  demand(value.exitCode === wantExitCode, `refusal exited ${value.exitCode}, want ${wantExitCode}: ${value.stderr.slice(0, 200)}`);
  demand(value.stdout === '', `a refusal wrote stdout: ${JSON.stringify(value.stdout).slice(0, 120)}`);
  for (const needle of needles) {
    demand(value.stderr.includes(needle), `the refusal does not name it (${needle}): ${value.stderr.slice(0, 200)}`);
  }
  emit('shell/refused', { exitCode: value.exitCode, missing });
  emit('shell/exit', { exitCode: value.exitCode });
};

const bootPhase = async (env) => {
  log.debug('boot phase begin', {});
  const resolved = await fsScope.resolve('scope://app/');
  const root = resolved?.path;
  demand(typeof root === 'string' && root.startsWith('/'), `profile container not resolved: ${JSON.stringify(root)}`);
  const { ctx } = await bootUpstream({
    scenario: SCENARIO,
    agentId: AGENT_ID,
    sessionId: SESSION_ID,
    cwd: root,
    onEvent: emit,
    container: {
      cwd: root,
      scopeRoot: root, // the CLI container IS the scope root (main_cli.c) — the shell's workspace anchor
      tmpdir: `${root}/tmp`,
      home: `${root}/home`,
      env,
      argv: ['dsh', '--profile', 'mobile'],
    },
    llm: {
      baseURL: env.DSH_MOCK_LLM_URL,
      apiKey: env.DSH_MOCK_LLM_KEY,
      provider: 'mock',
 kind: 'mock',
            model: 'mock-1',
    },
  });
  log.debug('boot phase done', { root });
  return ctx;
};

const offeredPhase = (ctx) => {
  log.debug('offered phase begin', {});
  const visible = ctx.tools?.view?.(undefined)?.visible;
  demand(visible instanceof Map, 'the tool layer exposed no visibility view');
  demand(visible.has('shell'), 'the shell tool is not offered');
  emit('shell/offered', { tools: 1 });
};

/** Quotes + variables: a prefix assignment seeds the table, double quotes
 * fold around $VAR/${VAR} expansion, single quotes stay literal. */
const quotesPhase = async (ctx) => {
  log.debug('quotes phase begin', {});
  await runCommand(ctx, 'WHO=dsh; echo "hello from ${WHO}-shell, $WHO in double quotes"',
    'hello from dsh-shell, dsh in double quotes\n');
  await runCommand(ctx, "echo '$WHO stays literal in single quotes'",
    '$WHO stays literal in single quotes\n');
};

/** Redirects: `>` creates and `>>` appends through the gateway fsWrite; the
 * round trip runs through the shell (`cat`) AND out-of-band through the
 * gateway itself (fsRead) — persistence is the scope, not shell memory. */
const redirectPhase = async (ctx) => {
  log.debug('redirect phase begin', {});
  await runCommand(ctx, `echo beta-line > ${NOTES_NAME}`, '');
  await runCommand(ctx, `echo alpha-line >> ${NOTES_NAME}`, '');
  await runCommand(ctx, `cat ${NOTES_NAME}`, NOTES_TEXT);
  const read = await fsRead('app', NOTES_NAME);
  const text = new TextDecoder().decode(read.bytes);
  demand(text === NOTES_TEXT, `the gateway face sees drifted bytes: ${JSON.stringify(text)}`);
  emit('shell/persisted', { name: NOTES_NAME, bytes: read.bytes.length });
};

/** Pipelines: three members over the 64KB-window pipes; `sort` reorders
 * what the redirect phase landed, `head -n 1` proves the last member's
 * status-and-output discipline. */
const pipePhase = async (ctx) => {
  log.debug('pipe phase begin', {});
  await runCommand(ctx, `cat ${NOTES_NAME} | sort | head -n 1`, 'alpha-line\n');
};

/** By-name refusals: the construct, the missing primitive, the unknown
 * program — each exit code from the refusal vocabulary, each stderr
 * naming what is missing. */
const refusalsPhase = async (ctx) => {
  log.debug('refusals phase begin', {});
  await runRefusal(ctx, 'echo "nested $(echo boom) is refused"', 2, 'command substitution',
    ['command substitution $(…)/backticks is not implemented']);
  await runRefusal(ctx, `chmod +x ${NOTES_NAME}`, 2, 'permission primitive',
    ['has no permission primitive', 'contract proposal (D5)']);
  await runRefusal(ctx, 'no-such-applet --version', 127, 'program',
    ['not found', 'Available applets:']);
};

const main = async () => {
  log.debug('main begin', {});
  const env = launchEnv();
  demand(typeof env.DSH_MOCK_LLM_URL === 'string' && env.DSH_MOCK_LLM_URL.startsWith('http://127.0.0.1:'),
    `the LLM route is not the loopback mock: ${JSON.stringify(env.DSH_MOCK_LLM_URL)}`);
  const ctx = await bootPhase(env);
  emit('session/created', { sessionId: SESSION_ID });
  emit('agent/created', { id: AGENT_ID, sessionId: SESSION_ID });

  offeredPhase(ctx);
  await quotesPhase(ctx);
  await redirectPhase(ctx);
  await pipePhase(ctx);
  await refusalsPhase(ctx);

  emit('upstream/completed', {
    status: 'pass',
    upstream: '0.1.6-alpha.2',
    shellJs: 'system-plugins/dsh-shell-js over the gateway fs primitives',
  });
  globalThis.__dshComplete(true, 'pass');
};

main().catch(fail);
