/**
 * Scenario `llm.piai-probe` — the CLI proof for the GATED multi-protocol LLM
 * row (the llm-pi-ai leg): the vendored @deepseek-ai/dsh-llm-pi-ai plugin
 * mounts over `options.llm.piaiProviders` and registers its PiAiAdapter (an
 * LlmAdapter subclass) for the 'piai-test' route BESIDE the boot's gateway
 * route, so one LlmRuntime registry serves both adapter families.
 *
 * Determinism: the whole run is ONE quickjs process with NO network. The
 * in-process `node:http` loopback (the upstream suite's in-test-server face)
 * hosts a scripted OpenAI chat-completions SSE server; the pi-ai
 * `openai-completions` wire layer dials `globalThis.fetch`, which dispatches
 * that server in-process (the runtime fetch has no other network face — the
 * gateway httpFetch seam is invisible to the library, and that is the honest
 * mobile transport statement this probe also proves). The boot's own gateway
 * route stays registered but never dialed; its loopback URL only satisfies
 * the serving-route demand.
 *
 * Proven through the public LlmRuntime faces, one event per contract point:
 *   - probe/piai-mounted — the gated mount registered the configured routes;
 *   - probe/list-providers — providerInfo: the registry describes
 *     'piai-test' with the adapter's display name beside the gateway route;
 *   - probe/list-models — adapter.listModels (the configured catalog);
 *   - probe/resolve-model — adapter.resolveModel (context capacity rides);
 *   - probe/prepare-call — adapter.prepareCall (the frozen prepared call +
 *     the route's captured retry policy);
 *   - probe/wire — the library's REAL wire request (path, stream flag, the
 *     model, the credential resolved through apiKeyEnv → the launch env);
 *   - probe/stream — the full StreamChunk translation (block-start →
 *     text-delta → block-end → usage → finish stop) assembled text.
 * Every expected event is declared one-to-one in
 * test/e2e/scenarios/llm-piai-probe.json.
 */
import { createLogger } from 'logger.js';
import { fsScope } from 'gateway.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { bootUpstream } from 'upstream/boot.js';

const SCENARIO = 'llm.piai-probe';
const AGENT_ID = 'main';
const SESSION_ID = 's-llm-piai-probe-0001';
const ROUTE = 'piai-test';
const MODEL_ID = 'piai-mock-1';
const KEY_ENV = 'DSH_PIAI_KEY';
const FIXTURE_KEY = 'mock-key-0001';
const EXPECTED_TEXT = 'Hello from pi-ai';
// The gateway route is never dialed in this probe: port 9 (discard) satisfies
// the boot's serving-route demand without implying a live endpoint.
const UNDIALED_BASE = 'http://127.0.0.1:9';

const log = createLogger('llm.piai-probe.dsh');
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

/** The launch env snapshot (--env KEY=VALUE on the CLI) — the credential
 * reference resolves through the profile container's env, the same channel
 * upstream launchEnvironmentOf reads when no credentials service mounts. */
const launchEnv = () => {
  const raw = globalThis.__dshLaunchEnv?.();
  demand(typeof raw === 'string', 'launch env snapshot missing (CLI must pass --env)');
  const env = JSON.parse(raw);
  demand(env[KEY_ENV] === FIXTURE_KEY, `${KEY_ENV} missing from the launch env`);
  log.debug('launch env', { keys: Object.keys(env) });
  return env;
};

/** One scripted SSE data frame (single-expression arrow: pure data). */
const sseFrame = (delta, finish, usage) => 'data: ' + JSON.stringify({
  id: 'chatcmpl-piai-1', model: MODEL_ID,
  choices: [{ index: 0, delta, finish_reason: finish ?? null }],
  ...(usage === undefined ? {} : { usage }),
}) + '\n\n';

/** The scripted chat-completions server: demands the bearer (wire evidence
 * the apiKeyEnv credential reached the library), then streams content
 * deltas, the terminal finish/usage chunk, and [DONE]. Requests are recorded
 * as plain deterministic fields for the probe/wire evidence. */
const startPiaiMock = async () => {
  log.debug('piai mock starting', {});
  // Dynamic import of the BARE 'http' spelling: the bridges register the
  // in-process loopback face under that name at boot (npm-bridges-c's
  // "bare 'http' rides the same face as node:http" row), and a dynamic
  // specifier resolves through the runtime-defined registry after boot's
  // static graph has landed — the otel exporter's own pattern.
  const { default: http } = await import('http');
  const wire = { requests: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const params = JSON.parse(body);
      const bearer = req.headers.authorization === `Bearer ${FIXTURE_KEY}`;
      wire.requests.push({ path: req.url, model: params.model, stream: params.stream, bearer });
      if (req.url !== '/v1/chat/completions' || params.stream !== true || !bearer) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'probe mock refuses this request' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const piece of ['Hello', ' from', ' pi-ai']) res.write(sseFrame({ content: piece }));
      res.write(sseFrame({}, 'stop', { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 }));
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, wire, baseURL: `http://127.0.0.1:${server.address().port}/v1` };
};

/** Boot with the GATED piaiProviders dict (the leg under test) plus the
 * undialed gateway route the boot demands; capture the mount's evidence. */
const bootPhase = async (env, baseURL, captures) => {
  log.debug('boot phase begin', { baseURL });
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
    llm: {
      baseURL: UNDIALED_BASE, apiKey: FIXTURE_KEY, provider: 'mock', kind: 'mock', model: 'mock-1',
      piaiProviders: {
        [ROUTE]: {
          displayName: 'pi-ai test route',
          apiKeyEnv: KEY_ENV,
          api: 'openai-completions',
          baseURL,
          models: [{ id: MODEL_ID, name: 'pi-ai mock model', contextWindow: 8192, maxTokens: 256 }],
        },
      },
    },
  });
  return ctx;
};

/** The LlmAdapter contract face, one probe event per method — every assert
 * goes through the PUBLIC LlmRuntime faces, never a private registry reach. */
const contractPhase = async (ctx) => {
  log.debug('contract phase begin', {});
  const providers = ctx.llm.listProviders();
  const ids = providers.map((info) => info.id).sort();
  demand(ids.indexOf(ROUTE) >= 0, `piai-test missing from listProviders: ${JSON.stringify(ids)}`);
  demand(ids.indexOf('mock') >= 0, 'the gateway route vanished from listProviders');
  const piaiInfo = providers.find((info) => info.id === ROUTE);
  demand(piaiInfo.name === 'pi-ai test route', `providerInfo name is ${JSON.stringify(piaiInfo)}`);
  emit('probe/list-providers', { routes: ids, piaiName: piaiInfo.name });

  const models = await ctx.llm.listModels(ROUTE);
  demand(models.length === 1 && models[0].id === MODEL_ID, `listModels is ${JSON.stringify(models)}`);
  emit('probe/list-models', { provider: ROUTE, models: models.map((m) => m.id) });

  const resolved = await ctx.llm.resolveModelInfo(ROUTE, MODEL_ID);
  demand(resolved.context?.contextWindow === 8192, `resolveModel context is ${JSON.stringify(resolved.context)}`);
  demand(resolved.name === 'pi-ai mock model', `resolveModel name is ${JSON.stringify(resolved.name)}`);
  emit('probe/resolve-model', {
    provider: resolved.provider, id: resolved.id, name: resolved.name,
    contextWindow: resolved.context?.contextWindow,
  });

  const prepared = await ctx.llm.prepareCall({ provider: ROUTE, model: MODEL_ID });
  demand(prepared.config.provider === ROUTE && prepared.config.model === MODEL_ID,
    `prepared config is ${JSON.stringify(prepared.config)}`);
  demand(prepared.retryPolicy !== undefined, 'the route retry policy is missing from the prepared call');
  emit('probe/prepare-call', {
    provider: prepared.config.provider, model: prepared.config.model,
    retryPolicyMode: prepared.retryPolicy.mode ?? 'default',
    dispatched: typeof prepared.stream === 'function',
  });
  return prepared;
};

/** The stream leg: one prepared dispatch through pi-ai's REAL openai-
 * completions wire layer to the in-process scripted server. Asserts the
 * StreamChunk translation and the wire evidence the mock recorded. */
const streamPhase = async (ctx, prepared, wire) => {
  log.debug('stream phase begin', {});
  const chunks = [];
  const stream = prepared.stream({ ...prepared.config, messages: [createUserMessage({
    content: [{ type: 'text', text: 'Say hi' }], source: { kind: 'user' },
  })] });
  for await (const chunk of stream) chunks.push(chunk);
  const kinds = chunks.map((c) => c.type).join(',');
  const text = chunks.filter((c) => c.type === 'text-delta').map((c) => c.text).join('');
  demand(text === EXPECTED_TEXT, `assembled text is "${text}"`);
  const finish = chunks.find((c) => c.type === 'finish');
  demand(finish?.reason?.kind === 'stop', `finish reason is ${JSON.stringify(finish?.reason)}`);
  const usage = chunks.find((c) => c.type === 'usage')?.usage;
  demand(wire.requests.length === 1, `the mock saw ${wire.requests.length} requests`);
  emit('probe/wire', { ...wire.requests[0] });
  emit('probe/stream', {
    kinds, text,
    finish: finish.reason.kind,
    inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens,
    totalTokens: usage?.totalTokens,
  });
};

const main = async () => {
  log.debug('main begin', {});
  const env = launchEnv();
  const mock = await startPiaiMock();
  const captures = {};
  const ctx = await bootPhase(env, mock.baseURL, captures);
  emit('probe/piai-mounted', { routes: [ROUTE], baseURL: mock.baseURL });
  const prepared = await contractPhase(ctx);
  await streamPhase(ctx, prepared, mock.wire);
  await mock.server.close();
  emit('probe/completed', { status: 'pass', adapter: 'vendored dsh-llm-pi-ai PiAiAdapter' });
  globalThis.__dshComplete(true, 'pass');
};

main().catch(fail);
