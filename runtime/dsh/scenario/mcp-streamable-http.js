/**
 * Scenario `mcp.streamable-http` — the CLI proof that the VENDORED
 * @modelcontextprotocol/client@2.0.0 drives a real Streamable HTTP MCP
 * server from inside quickjs over the gateway `httpFetch` primitive:
 * connect (initialize + notifications/initialized) → listTools → callTool
 * ×2 → close, against the node-side mock (runtime/dsh/ci/mock-mcp-server.mjs)
 * on real loopback TCP.
 *
 * The transport is upstream/mcp-http-transport.js: the vendored
 * StreamableHTTPClientTransport VERBATIM, composed over the gateway fetch
 * (D5: zero new primitive; D6: zero upstream edit; D8: the response body
 * streams chunk by chunk). The client library itself is never touched — the
 * only seam is the `fetch` the transport is handed.
 *
 * Determinism: ONE quickjs process; the mock is the only network peer and
 * the runner (ci/run-mcp-streamable-http-e2e.sh) owns its lifecycle. The
 * boot's own gateway LLM route is never dialed; port 9 only satisfies the
 * serving-route demand.
 *
 * Proven, one event per contract point (declared one-to-one in
 * test/e2e/scenarios/mcp-streamable-http.json):
 *   - mcp/transport-created — the bridge composed (kind + wire label);
 *   - mcp/wire ×N — EVERY request the transport dials, recorded by the
 *     bridge's onWire as {method, path, status, contentType, rpcMethod}: the JSON
 *     and the SSE response modes both cross the bridge, and the library's
 *     own standalone GET stream attempt (answered 405 by the mock, which the
 *     transport tolerates by design) is real behavior, recorded, not hidden;
 *   - mcp/connected — the legacy initialize handshake settled: serverInfo
 *     from the wire (protocolVersion rides along as the client's offer);
 *   - mcp/tools-listed — tools/list answered over the SSE response mode;
 *   - mcp/tool-called ×2 — tools/call echo + add over the JSON response mode;
 *   - mcp/closed — the client closed its transport (no DELETE: the vendored
 *     Client.close aborts, it does not terminate the session).
 */
import { createLogger } from 'logger.js';
import { fsScope } from 'gateway.js';
import { bootUpstream } from 'upstream/boot.js';
import { loadMcpSdk, createMcpHttpTransport } from 'upstream/mcp-http-transport.js';

const SCENARIO = 'mcp.streamable-http';
const AGENT_ID = 'main';
const SESSION_ID = 's-mcp-streamable-http-0001';
const URL_ENV = 'DSH_MCP_URL';
const CLIENT_INFO = { name: 'dsh-mobile-mcp-probe', version: '0.0.0' };
const EXPECTED_SERVER = { name: 'dsh-mock-mcp', version: '0.0.1' };
const EXPECTED_TOOLS = ['add', 'echo'];
const ECHO_TEXT = 'hello from dsh-mobile';
const ADD_ARGS = { a: 19, b: 23 };
const ADD_TEXT = '42';
// The gateway LLM route is never dialed in this probe: port 9 (discard)
// satisfies the boot's serving-route demand without implying a live endpoint.
const UNDIALED_BASE = 'http://127.0.0.1:9';
const UNDIALED_KEY = 'mock-key-0001';

const log = createLogger('mcp.streamable-http.dsh');
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

/** The launch env snapshot (--env KEY=VALUE on the CLI): the mock's endpoint
 * the runner announced. Absent = the runner did not wire it; fail loud. */
const launchEnv = () => {
  log.debug('launch env', {});
  const raw = globalThis.__dshLaunchEnv?.();
  demand(typeof raw === 'string', 'launch env snapshot missing (CLI must pass --env)');
  const env = JSON.parse(raw);
  const url = env[URL_ENV];
  demand(typeof url === 'string' && /^https?:\/\//.test(url), `${URL_ENV} missing from the launch env (expected the mock MCP endpoint)`);
  return env;
};

/** Boot the mobile profile with the undialed gateway route the boot demands;
 * the boot's own events ride the same emit (llm/runtime, upstream/*). */
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
    llm: { baseURL: UNDIALED_BASE, apiKey: UNDIALED_KEY, provider: 'mock', model: 'mock-1' },
  });
  return ctx;
};

/** The connect leg: compose the bridge, hand it to the vendored Client, run
 * the initialize handshake. Every wire request the bridge dials is one
 * mcp/wire event — the GET the library opens after `initialized` included. */
const connectPhase = async (sdk, url) => {
  log.debug('connect phase begin', { url });
  const transport = await createMcpHttpTransport({ url, onWire: (wire) => emit('mcp/wire', wire) });
  emit('mcp/transport-created', { kind: 'streamable-http', wire: 'gateway.httpFetch', url });
  const client = new sdk.Client(CLIENT_INFO);
  await client.connect(transport);
  const server = client.getServerVersion();
  demand(server?.name === EXPECTED_SERVER.name && server?.version === EXPECTED_SERVER.version,
    `serverInfo is ${JSON.stringify(server)}`);
  emit('mcp/connected', {
    serverName: server.name,
    serverVersion: server.version,
    protocolVersion: transport.protocolVersion,
    sessionId: transport.sessionId,
  });
  return client;
};

/** One tools/call: the first text content block is the whole answer. */
const callText = async (client, name, args) => {
  log.debug('call tool', { name });
  const result = await client.callTool({ name, arguments: args });
  demand(result?.isError !== true, `${name} answered isError: ${JSON.stringify(result)}`);
  const block = Array.isArray(result?.content) ? result.content[0] : undefined;
  demand(block?.type === 'text' && typeof block.text === 'string', `${name} content is ${JSON.stringify(result?.content)}`);
  return block.text;
};

/** The tools leg: tools/list over the SSE response mode, then the two
 * scripted calls over the JSON response mode. */
const toolsPhase = async (client) => {
  log.debug('tools phase begin', {});
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  demand(JSON.stringify(names) === JSON.stringify(EXPECTED_TOOLS), `listTools names are ${JSON.stringify(names)}`);
  emit('mcp/tools-listed', { count: names.length, names });

  const echoed = await callText(client, 'echo', { text: ECHO_TEXT });
  demand(echoed === ECHO_TEXT, `echo answered "${echoed}"`);
  emit('mcp/tool-called', { tool: 'echo', text: echoed });

  const sum = await callText(client, 'add', ADD_ARGS);
  demand(sum === ADD_TEXT, `add answered "${sum}"`);
  emit('mcp/tool-called', { tool: 'add', text: sum });
};

const main = async () => {
  log.debug('main begin', {});
  const env = launchEnv();
  await bootPhase(env);
  const sdk = await loadMcpSdk();
  demand(typeof sdk?.Client === 'function', 'the MCP sdk did not load a Client class');
  const client = await connectPhase(sdk, env[URL_ENV]);
  await toolsPhase(client);
  await client.close();
  emit('mcp/closed', {});
  emit('probe/completed', { status: 'pass' });
  globalThis.__dshComplete(true, 'pass');
};

main().catch(fail);
