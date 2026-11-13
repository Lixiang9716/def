// dsh:logging-exempt (scenario; the seat's emit is the logger face)
/**
 * scenario/mcp-plugin.js — the dsh-mcp plugin's E2E leg (plan §4.2): the
 * REAL mobile profile boots through boot.js (the plugin mounts from the
 * def bundle), reads the mock server from the DSH_MCP_SERVERS launch env,
 * connects over the vendored streamable-HTTP transport on the REAL gateway
 * httpFetch, registers mcp_demo_echo / mcp_demo_add into ctx.tools, and
 * drives both through the REAL ToolRuntime dispatch — plus the error
 * forwarding leg (the server's -32602 arrives as the tool's structured
 * refusal). One structured event per contract point, one-to-one with
 * test/e2e/scenarios/mcp-plugin.json; verdict via __dshComplete.
 *
 * The LLM route is never dialed (the create-card precedent): port 9
 * satisfies the boot's serving-route demand.
 */
import { createLogger } from 'logger.js';
import { fsScope, keychainSet, keychainGet } from 'gateway.js';
import { bootUpstream } from 'upstream/boot.js';

const SCENARIO = 'mcp.plugin';
const AGENT_ID = 'main';
const SESSION_ID = 's-mcp-plugin-0001';
const URL_ENV = 'DSH_MCP_URL';
const SERVERS_ENV = 'DSH_MCP_SERVERS';
const SERVER_NAME = 'demo';
const ECHO_TEXT = 'hello from the dsh-mcp plugin';
const ADD_ARGS = { a: 19, b: 23 };
const ADD_TEXT = '42';
const UNDIALED_BASE = 'http://127.0.0.1:9';
const UNDIALED_KEY = 'mock-key-0001';
// The keychain leg (the credentials face): a ref the config names, set and
// round-tripped through the REAL gateway keychain before the boot — the
// plugin's resolveCredential reads exactly this shape.
const CREDENTIAL_REF = 'mcp/demo/credential';
const CREDENTIAL_VALUE = 'mock-credential-0001';

const log = createLogger('mcp.plugin.dsh');
const emit = (event, fields = {}) => log.info('e2e', { scenario: SCENARIO, event, ...fields });
const fail = (reason) => {
  const error = reason instanceof Error ? reason : null;
  const message = error ? error.message : String(reason);
  const withStack = error?.stack
    ? `${message} | ${error.stack.split('\n').slice(0, 4).join(' / ')}`
    : message;
  log.debug('scenario failed', { reason: withStack });
  emit('scenario.failed', { reason: withStack });
  globalThis.__dshComplete(false, withStack);
};
const demand = (cond, reason) => {
  if (cond) return;
  log.debug('demand failed', { reason });
  fail(reason);
  throw new Error(reason);
};

/** The launch env snapshot (--env KEY=VALUE on the CLI): the mock endpoint
 * the runner announced, plus the server roster the plugin reads. The env
 * face composes the roster here — the __dshMcpServers global face is the
 * host-side twin, exercised by the carriers. */
const launchEnv = () => {
  log.debug('launch env', {});
  const raw = globalThis.__dshLaunchEnv?.();
  demand(typeof raw === 'string', 'launch env snapshot missing (CLI must pass --env)');
  const env = JSON.parse(raw);
  const url = env[URL_ENV];
  demand(typeof url === 'string' && /^https?:\/\//.test(url), `${URL_ENV} missing from the launch env (expected the mock MCP endpoint)`);
  const roster = env[SERVERS_ENV];
  demand(typeof roster === 'string' && roster.includes(url), `${SERVERS_ENV} missing from the launch env (expected the pipe-grammar server roster naming the mock)`);
  return env;
};

/** The credentials face: set → get → identical bytes through the REAL
 * gateway keychain (the CLI backend keeps it in a plaintext tmpdir BY
 * DESIGN — the assertion is the roundtrip, not at-rest secrecy). */
const credentialPhase = async () => {
  const secretBytes = globalThis.crypto.getRandomValues(new Uint8Array(CREDENTIAL_VALUE.length));
  for (let at = 0; at < CREDENTIAL_VALUE.length; at += 1) secretBytes[at] = CREDENTIAL_VALUE.charCodeAt(at);
  await keychainSet(CREDENTIAL_REF, secretBytes);
  const read = await keychainGet(CREDENTIAL_REF);
  log.debug('credential roundtrip', { kind: typeof read?.secret, len: read?.secret?.length });
  const bytes = read?.secret;
  const text = bytes && typeof bytes.length === 'number' ? String.fromCharCode(...bytes) : '';
  demand(text === CREDENTIAL_VALUE, `the keychain roundtrip answered ${JSON.stringify(text.slice(0, 40))}`);
  emit('mcp/credential.stored', { ref: CREDENTIAL_REF, bytes: CREDENTIAL_VALUE.length });
};

/** Boot the mobile profile: the plugin mounts from the def bundle and its
 * async apply connects + registers BEFORE bootUpstream settles (cordis
 * awaits the mount). The boot's own events ride the same emit. */
const bootPhase = async (env) => {
  log.debug('boot phase begin', {});
  const resolved = await fsScope.resolve('scope://app/');
  const root = resolved?.path;
  demand(typeof root === 'string' && root.startsWith('/'), `profile container not resolved: ${JSON.stringify(resolved)}`);
  const { ctx } = await bootUpstream({
    scenario: SCENARIO,
    agentId: AGENT_ID,
    sessionId: SESSION_ID,
    cwd: root,
    onEvent: emit,
    container: {
      cwd: root, tmpdir: `${root}/tmp`, home: `${root}/home`,
      env, argv: ['dsh', '--profile', 'mobile'],
    },
    llm: { baseURL: UNDIALED_BASE, apiKey: UNDIALED_KEY, kind: 'mock', provider: 'mock', model: 'mock-1' },
  });
  demand(ctx !== undefined && ctx.tools !== undefined, 'the boot returned no toolset');
  return ctx;
};

/** The registered-roster gate: both tools must be visible to the REAL
 * registry. If the async mount raced the boot's settle, poll with gateway
 * yields (rule 8 — never a blind sleep; a microtask spin starves the
 * looper), bounded by a deadline. */
const waitRegistered = async (ctx) => {
  const deadline = 30;
  for (let attempt = 0; attempt < deadline * 4; attempt += 1) {
    const visible = ctx.tools?.view?.(undefined)?.visible;
    const has = (name) => visible !== undefined && visible.has(name);
    if (has('mcp_demo_echo') && has('mcp_demo_add')) return;
    await fsScope.resolve('scope://app/');
  }
  demand(false, 'the dsh-mcp tools did not register within the deadline');
};

/** One tool call through the REAL ToolRuntime dispatch (the office.js
 * shape), returning the plugin's {ok, result} envelope. */
const call = async (ctx, name, args) => {
  log.debug('tool dispatch', { name });
  const outcome = await ctx.tools.execute({
    name,
    arguments: args,
    callId: `${SCENARIO}.${name}`,
    signal: new AbortController().signal,
  });
  demand(outcome?.value !== undefined && outcome?.value !== null && typeof outcome.value === 'object',
    `${name} returned no structured value: ${JSON.stringify(outcome).slice(0, 200)}`);
  return outcome.value;
};

const main = async () => {
  log.debug('main begin', {});
  emit('mcp/plugin.begin', {});
  const env = launchEnv();
  await credentialPhase();
  const ctx = await bootPhase(env);
  emit('mcp/plugin.spine-booted', { sessionId: SESSION_ID });
  await waitRegistered(ctx);
  emit('mcp/tools.registered', { count: 2, names: ['mcp_demo_echo', 'mcp_demo_add'] });

  const echoed = await call(ctx, 'mcp_demo_echo', { text: ECHO_TEXT });
  demand(echoed.ok === true, `echo outcome not ok: ${echoed.result.slice(0, 120)}`);
  const echoedText = JSON.parse(echoed.result).result;
  demand(echoedText === ECHO_TEXT, `echo answered ${JSON.stringify(echoedText)}`);
  emit('mcp/call.echo', { tool: 'mcp_demo_echo', text: echoedText });

  const summed = await call(ctx, 'mcp_demo_add', ADD_ARGS);
  const sumText = JSON.parse(summed.result).result;
  demand(sumText === ADD_TEXT, `add answered ${JSON.stringify(sumText)}`);
  emit('mcp/call.add', { tool: 'mcp_demo_add', text: sumText });

  // The error legs, two layers, both structured (never a throw):
  // (1) the toolset's own validation refuses a schema-violating call BEFORE
  // any dispatch — the row-23 INVALID_ARGS shape;
  const locallyRefused = await ctx.tools.execute({
    name: 'mcp_demo_add',
    arguments: { a: 'not-a-number', b: 1 },
    callId: `${SCENARIO}.mcp_demo_add.invalid`,
    signal: new AbortController().signal,
  });
  demand(locallyRefused?.isError === true, `the local refusal answered ok: ${JSON.stringify(locallyRefused).slice(0, 160)}`);
  demand(locallyRefused?.error?.info?.code === 'INVALID_ARGS',
    `the local refusal lost its code: ${JSON.stringify(locallyRefused?.error).slice(0, 160)}`);
  emit('mcp/call.local-refused', { tool: 'mcp_demo_add', code: 'INVALID_ARGS' });
  // (2) the server's own isError content answer forwards through callTool →
  // the plugin outcome — the server's reason rides intact.
  const serverRefused = await call(ctx, 'mcp_demo_add', { a: 0, b: 0 });
  demand(serverRefused.ok === false, `the server error leg answered ok: ${serverRefused.result.slice(0, 120)}`);
  const refusal = JSON.parse(serverRefused.result);
  demand(refusal.error === 'the mock refuses to add nothing',
    `the refusal lost the server's reason: ${JSON.stringify(refusal).slice(0, 160)}`);
  emit('mcp/call.server-error', { tool: 'mcp_demo_add', forwarded: true });

  emit('mcp/plugin.completed', { status: 'pass' });
  globalThis.__dshComplete(true, 'pass');
};

main().catch(fail);
