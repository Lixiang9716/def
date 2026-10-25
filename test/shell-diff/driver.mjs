/**
 * driver.mjs — the dsh side of the shell-diff harness (test-hardening
 * row 6). Runs INSIDE the desktop CLI runtime (`dsh-cli . driver.mjs`,
 * exactly like the e2e scenarios): boots the mobile profile over the
 * vendored upstream spine, then feeds every case script through the REAL
 * ToolRuntime `shell` dispatch — the same seat the e2e scenario
 * dsh-shell-js drives.
 *
 * The case matrix rides the host→runtime staged-data seam: run.sh passes
 * `--bus-inject test/shell-diff/cases.json`, the host delivers the file's
 * content as ONE bus line right after eval, and the module-scope handler
 * buffers it until main() consumes it (the settings-surfaces pattern —
 * deliveries may arrive while eval is still winding down).
 *
 * Per case, three dispatches against the one persistent shell session:
 *   1. `cd cases/<id>`   — the case's fixture directory (created through
 *      the gateway first), so globs/redirects are isolated per case;
 *   2. the case script   — the recorded result;
 *   3. `cd`              — back to the workspace root (a case that cd'd
 *      mid-script must not re-anchor the next case).
 *
 * Results land as one JSONL file at the workspace root
 * (`shell-diff-results.jsonl`): the runner pins the container with
 * DSH_SPIKE_TMPDIR and reads the file from disk. The runner never parses
 * this log for results — the JSONL is the product, the log is diagnostics.
 *
 * usage (from runtime/dsh, the legs' cwd):
 *   DSH_SPIKE_TMPDIR=<dir> ./build/dsh-cli . ../../test/shell-diff/driver.mjs \
 *     --http --bus-inject ../../test/shell-diff/cases.json \
 *     --env DSH_MOCK_LLM_URL=... --env DSH_MOCK_LLM_KEY=...
 */
import { createLogger } from 'logger.js';
import { fsScope, fsWrite } from 'gateway.js';
import { bootUpstream } from 'upstream/boot.js';

const SCENARIO = 'shell-diff';
const AGENT_ID = 'main';
const SESSION_ID = 's-shell-diff-0001';
const RESULTS_NAME = 'shell-diff-results.jsonl';

const log = createLogger('dsh.shell-diff');
const fail = (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  log.debug('scenario failed', { reason: message });
  globalThis.__dshComplete(false, message);
};
const demand = (cond, reason) => {
  if (cond) return;
  fail(reason);
  throw new Error(reason);
};

/** Bus plumbing: the host injects the case matrix right after eval — the
 * subscription exists at module scope and buffers until main() reads it. */
const busDeliveries = [];
globalThis.__dshBusOnMessage = (line) => {
  busDeliveries.push(JSON.parse(line));
};

const launchEnv = () => {
  log.debug('launch env phase begin', {});
  const raw = globalThis.__dshLaunchEnv?.();
  demand(typeof raw === 'string', 'launch env snapshot missing (CLI must pass --env)');
  return JSON.parse(raw);
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
    onEvent: (event, fields = {}) => log.debug('e2e', { scenario: SCENARIO, event, ...fields }),
    container: {
      cwd: root,
      scopeRoot: root, // the CLI container IS the scope root (main_cli.c)
      tmpdir: `${root}/tmp`,
      home: `${root}/home`,
      env,
      argv: ['dsh', '--profile', 'mobile'],
    },
    llm: {
      baseURL: env.DSH_MOCK_LLM_URL,
      apiKey: env.DSH_MOCK_LLM_KEY,
      provider: 'mock',
      model: 'mock-1',
    },
  });
  log.debug('boot phase done', { root });
  return ctx;
};

/** One `shell` dispatch through the REAL ToolRuntime. A case's failure is
 * DATA, never scenario-fatal: a refused/deadlined dispatch (e.g. the
 * pipeline-refusal deadlock) is recorded as an exitCode -1 result and the
 * run continues — the post-case `cd` re-anchors the session. Only a
 * structurally broken answer (no structured value) fails the run. */
const dispatch = async (ctx, command) => {
  log.debug('shell dispatch', { chars: command.length });
  const outcome = await ctx.tools.execute({
    name: 'jsshell',
    arguments: { command },
    callId: `${SCENARIO}.shell`,
    signal: new AbortController().signal,
  });
  if (outcome?.isError === true) {
    const message = outcome?.error?.message ?? JSON.stringify(outcome?.error ?? outcome).slice(0, 300);
    log.debug('dispatch failed in-band', { message });
    return { exitCode: -1, stdout: '', stderr: `dispatch-error: ${message}` };
  }
  const value = outcome.value;
  demand(value !== undefined && typeof value.exitCode === 'number'
    && typeof value.stdout === 'string' && typeof value.stderr === 'string',
  `shell returned no structured result: ${JSON.stringify(value).slice(0, 200)}`);
  return value;
};

/** One case: fixtures through the gateway, `cd` in, run, `cd` back. The
 * CLI backend's fsWrite materializes missing parents, so no fsMkdir is
 * needed to stage `cases/<id>/…` (the backend has no fsMkdir). Every case
 * dir gets a dot-prefixed marker file: it creates the dir for cases with
 * no fixtures, and dotfiles are invisible to bash's globs, so both seats
 * keep identical worldviews. */
const runCase = async (ctx, one) => {
  log.debug('case begin', { id: one.id });
  const dir = `cases/${one.id}`;
  await fsWrite('app', `${dir}/.case`, new TextEncoder().encode(`${one.id}\n`));
  for (const [name, content] of Object.entries(one.files ?? {})) {
    await fsWrite('app', `${dir}/${name}`, new TextEncoder().encode(content));
  }
  const anchor = await dispatch(ctx, `cd ${dir}`);
  demand(anchor.exitCode === 0, `case ${one.id}: cd into the fixture dir failed: ${anchor.stderr.slice(0, 200)}`);
  const result = await dispatch(ctx, one.script);
  const back = await dispatch(ctx, 'cd');
  demand(back.exitCode === 0, `case ${one.id}: cd back to the root failed: ${back.stderr.slice(0, 200)}`);
  log.debug('case done', { id: one.id, exitCode: result.exitCode });
  return {
    id: one.id,
    family: one.family,
    kind: one.kind,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

const main = async () => {
  log.debug('main begin', {});
  const env = launchEnv();
  demand(typeof env.DSH_MOCK_LLM_URL === 'string' && env.DSH_MOCK_LLM_URL.startsWith('http://127.0.0.1:'),
    `the LLM route is not the loopback mock: ${JSON.stringify(env.DSH_MOCK_LLM_URL)}`);
  const ctx = await bootPhase(env);

  // The staged case matrix (--bus-inject delivered it during boot).
  const delivery = busDeliveries.find((m) => m?.type === 'shell-diff.cases');
  demand(delivery !== undefined, 'no shell-diff.cases bus delivery was injected by the host (--bus-inject test/shell-diff/cases.json)');
  const cases = delivery.cases;
  demand(Array.isArray(cases) && cases.length > 0, `the delivered case matrix is empty: ${JSON.stringify(delivery).slice(0, 120)}`);
  demand(busDeliveries.length === 1, `unexpected extra bus deliveries: ${busDeliveries.length - 1}`);
  log.info('shell-diff matrix staged', { cases: cases.length });

  const results = [];
  for (const one of cases) { // eslint-disable-line no-await-in-loop
    results.push(await runCase(ctx, one)); // eslint-disable-line no-await-in-loop
  }

  const body = results.map((r) => JSON.stringify(r)).join('\n') + '\n';
  await fsWrite('app', RESULTS_NAME, new TextEncoder().encode(body));
  log.info('shell-diff results written', { file: RESULTS_NAME, cases: results.length });
  globalThis.__dshComplete(true, 'pass');
};

main().catch(fail);
