// dsh:logging-exempt (dev script: the log stream is the product)
/**
 * Scenario `byok.anthropic-wire` — the BYOK wire leg for the MULTI-PROTOCOL
 * flavor: an ANTHROPIC credential saved through the page's own onboarding
 * wire (web-write-onboarding's save → keychain → rebindLlmRoute) is served
 * by the pi-ai mount (the piaiProviders dict byokRoute builds), and ONE REAL
 * turn streams pi-ai's anthropic-messages wire layer end to end.
 *
 * Determinism: ONE quickjs process, NO network, NO node companion — the
 * scripted anthropic-protocol SSE server is the in-process `http`-shim
 * loopback (the llm-piai-probe pattern), demanding the wire facts a real
 * Anthropic endpoint would (POST /v1/messages, x-api-key, anthropic-version,
 * stream:true) and answering the protocol's event family (message_start →
 * content_block_* → message_delta → message_stop).
 *
 * The credential-resolved key rides the launch environment under the BYOK
 * ref name (ANTHROPIC_API_KEY — llm-piai-mount's apiKeyEnv seam, the
 * no-credentials-service mobile shape); the KEYCHAIN bytes and the launch
 * env carry the SAME canary the runner injected. The server records
 * key PRESENCE (a boolean), never the value; the runner greps the RAW log
 * for the canary after first proving its matcher fires (the byok-leak
 * discipline).
 *
 * Proven, one event per contract point:
 *   - byok/save.ok — the save leg persisted + rebound live (mode byok);
 *   - byok/route.resolved.piai — the resolved route names its piaiProviders
 *     dict (api/apiKeyEnv/model/contextWindow/userEndpoint — ref-only, the
 *     dict itself is asserted to carry no key material);
 *   - byok/mount.piai — the rebind seam's mount landed: the plugin serves
 *     the 'anthropic' route (the boot-mount llm/piai event's byok-path
 *     counterpart — a save has no boot onEvent, so the mount evidence is
 *     the registry + the plugin's settings section);
 *   - byok/wire — the library's REAL anthropic wire request (path, the
 *     credential PRESENT at the wire, protocol version, stream flag);
 *   - byok/stream — the StreamChunk translation + assembled text + usage;
 *   - byok/rebind.second — a SECOND save (a fresh endpoint demanding a
 *     different key) takes the section-replace path — the rebind-over-mount
 *     round;
 *   - byok/auth-error.redacted — the 401 face rejects and the error message
 *     carries neither key value (the byok-leak precedent);
 *   - byok/cleanup — the clear leg restores the boot route LIVE: the
 *     keychain ref is gone, the plugin no longer serves the route.
 * Every expected event is declared one-to-one in
 * test/e2e/scenarios/byok-piai-anthropic.json.
 */
import { createLogger } from 'logger.js';
import { bootUpstream } from 'upstream/boot.js';
import { createWriteSurface } from 'upstream/web-write.js';
import { resolveLlmRoute, bootRouteOf, registerBootRouteFactory } from 'upstream/llm-route.js';
import { keychainGet } from 'gateway.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

const SCENARIO = 'byok.anthropic-wire';
const AGENT_ID = 'main';
const SESSION_ID = 's-byok-piai-anthropic-0001';
const MODEL_ID = 'claude-sonnet-4-5';
const EXPECTED_TEXT = 'Hello from pi-ai anthropic';
// The gateway route is never dialed: port 9 (discard) satisfies the boot's
// serving-route demand without implying a live endpoint.
const UNDIALED_BASE = 'http://127.0.0.1:9';
const ROOT = '/byok-piai-ws';

const log = createLogger('byok.piai.anthropic');
const emit = (event, fields = {}) => log.info('e2e', { scenario: SCENARIO, event, ...fields });
let verdict = false;
const fail = (reason) => {
  log.debug('scenario failed', { reason: String(reason).slice(0, 300) });
  if (!verdict) { verdict = true; globalThis.__dshComplete(false, String(reason).slice(0, 300)); }
  throw new Error(reason);
};
const demand = (ok, why) => { if (!ok) fail(why + ' @ ' + (new Error().stack ?? '').slice(0, 300)); };

/** The launch env: the canary rides the BYOK ref name the piai dict names. */
const launchEnv = () => {
  const raw = globalThis.__dshLaunchEnv?.();
  demand(typeof raw === 'string', 'launch env snapshot missing (CLI must pass --env)');
  const env = JSON.parse(raw);
  demand(typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.length >= 16,
    'ANTHROPIC_API_KEY missing from the launch env');
  return env;
};
const CANARY = launchEnv().ANTHROPIC_API_KEY;
const WRONG_KEY = 'byok-wrong-key-0000';

/** One settling gateway call — the poll's yield (the onboarding flow's
 * settleYield precedent: never a blind sleep). */
const settleYield = async () => { await keychainGet('dsh.byok-piai/poll'); };

/** One anthropic-protocol SSE frame. */
const anthropicFrame = (payload) =>
  `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`;

/** The scripted anthropic-messages server: demands the wire facts (path,
 * x-api-key equality, anthropic-version, stream) and answers the protocol's
 * event family. Requests are recorded as plain deterministic fields — the
 * key as a PRESENCE boolean, never the value. A refused request gets the
 * protocol's 401 error shape. */
const startAnthropicMock = async (demandedKey) => {
  log.debug('anthropic mock starting', {});
  // Dynamic import of the BARE 'http' spelling (the llm-piai-probe pattern:
  // the bridges register the in-process loopback face under that name).
  const { default: http } = await import('http');
  const wire = { requests: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let params = {};
      try { params = JSON.parse(body); } catch { /* the 401 face below */ }
      const keyPresent = req.headers['x-api-key'] === demandedKey;
      wire.requests.push({
        path: req.url, model: params.model, stream: params.stream,
        keyPresent, version: req.headers['anthropic-version'] ?? null,
      });
      if (req.url !== '/v1/messages' || params.stream !== true || !keyPresent
        || req.headers['anthropic-version'] !== '2023-06-01') {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          type: 'error',
          error: { type: 'authentication_error', message: 'invalid x-api-key' },
        }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(anthropicFrame({
        type: 'message_start',
        message: { id: 'msg_byok_piai_1', model: MODEL_ID, usage: { input_tokens: 11, output_tokens: 0 } },
      }));
      res.write(anthropicFrame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
      for (const piece of ['Hello', ' from', ' pi-ai anthropic']) {
        res.write(anthropicFrame({
          type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece },
        }));
      }
      res.write(anthropicFrame({ type: 'content_block_stop', index: 0 }));
      res.write(anthropicFrame({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 4 },
      }));
      res.write(anthropicFrame({ type: 'message_stop' }));
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, wire, baseURL: `http://127.0.0.1:${server.address().port}` };
};

/** Boot with ONLY the undialed gateway route (the first-launch shape: no
 * piaiProviders — the SAVE is what mounts the pi-ai family). */
const boot = async () => {
  const { ctx } = await bootUpstream({
    scenario: SCENARIO, agentId: AGENT_ID, sessionId: SESSION_ID,
    cwd: ROOT, onEvent: () => {},
    container: { cwd: ROOT, tmpdir: `${ROOT}/.tmp`, home: `${ROOT}/home`,
      env: { ANTHROPIC_API_KEY: CANARY }, argv: ['dsh', '--profile', 'mobile'] },
    llm: { baseURL: UNDIALED_BASE, apiKey: CANARY, kind: 'mock', provider: 'mock', model: 'mock-1' },
  });
  let guard = 0;
  while ((ctx.agents.get(SESSION_ID) === undefined) && guard++ < 10000) await Promise.resolve();
  demand(ctx.agents.get(SESSION_ID) !== undefined, 'the boot agent never appeared');
  return ctx;
};

/** The surface's frame plumbing (the onboarding flow's shape): one capturing
 * post, polled with settle-yield waits. */
const makeFrameHub = () => {
  const frames = [];
  return { frames, post: (frame) => { frames.push(frame); } };
};


let serverA = null;
const chunks = [];
const userTurn = () => createUserMessage({
  content: [{ type: 'text', text: 'Say hi' }], source: { kind: 'user' },
});

const CREDENTIAL = (baseURL) => ({
  provider: 'anthropic', baseURL, apiKey: CANARY, model: MODEL_ID,
});

/** Phases 1-3: save through the page's wire, the resolved dict, the mount
 * evidence (registry + the plugin's settings section). Returns the boot ctx
 * facts the later phases reuse. */
const saveAndMountPhase = async (api, ctx) => {
  await api['onboarding/save'](CREDENTIAL(serverA.baseURL));
  const status = await api['onboarding/status']({});
  demand(status.mode === 'byok' && status.provider === 'anthropic',
    `status after save is ${JSON.stringify(status)}`);
  demand(JSON.stringify(status).includes(CANARY) === false, 'the status leaked the key');
  emit('byok/save.ok', { mode: status.mode, provider: status.provider });

  const route = await resolveLlmRoute({ mockLlmUrl: UNDIALED_BASE, apiKey: CANARY });
  demand(route.kind === 'byok' && route.piai !== undefined,
    `the resolved route carries no piai dict: kind ${route.kind}`);
  demand(route.piai.apiKeyEnv === 'ANTHROPIC_API_KEY'
    && route.piai.api === 'anthropic-messages'
    && route.piai.userEndpoint === true
    && route.piai.models?.[0]?.id === MODEL_ID
    && route.piai.models?.[0]?.contextWindow === 200000,
    `the piai dict drifted: ${JSON.stringify(route.piai)}`);
  demand(JSON.stringify(route.piai).includes(CANARY) === false,
    'the piai dict embedded the credential value');
  emit('byok/route.resolved.piai', {
    api: route.piai.api, apiKeyEnv: route.piai.apiKeyEnv,
    model: route.piai.models[0].id, contextWindow: route.piai.models[0].contextWindow,
    userEndpoint: route.piai.userEndpoint,
  });

  const routes = ctx.llm.listProviders().map((info) => info.id).sort();
  demand(routes.indexOf('anthropic') >= 0, `anthropic missing from listProviders: ${JSON.stringify(routes)}`);
  const settings = ctx.get('settings');
  const section = settings?.get?.('llm-pi-ai');
  demand(section?.providers?.anthropic?.apiKeyEnv === 'ANTHROPIC_API_KEY',
    `the plugin section lost the ref: ${JSON.stringify(section?.providers?.anthropic)}`);
  emit('byok/mount.piai', {
    routes, apiKeyEnv: section.providers.anthropic.apiKeyEnv,
    api: section.providers.anthropic.api,
  });

  const directory = await api['llm/listConfigurableProviders']({});
  const row = (directory ?? []).find((entry) => entry.provider === 'anthropic');
  demand(row !== undefined && row.displayName === 'Anthropic',
    `no anthropic directory row: ${JSON.stringify((directory ?? []).map((e) => e.provider))}`);
  emit('byok/directory.piai', {
    provider: row.provider, displayName: row.displayName, settingsNs: row.settingsNs,
  });
};

/** Phase 4: ONE REAL turn — pi-ai's anthropic-messages wire layer end to
 * end (prepared call → SSE → StreamChunk translation → assembled text). */
const turnPhase = async (ctx) => {
  const prepared = await ctx.llm.prepareCall({ provider: 'anthropic', model: MODEL_ID });
  demand(prepared.config.provider === 'anthropic' && prepared.config.model === MODEL_ID,
    `prepared config is ${JSON.stringify(prepared.config)}`);
  const stream = prepared.stream({ ...prepared.config, messages: [userTurn()] });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const kinds = chunks.map((c) => c.type).join(',');
  const text = chunks.filter((c) => c.type === 'text-delta').map((c) => c.text).join('');
  demand(text === EXPECTED_TEXT, `assembled text is "${text}"`);
  const finish = chunks.find((c) => c.type === 'finish');
  const usage = chunks.find((c) => c.type === 'usage')?.usage;
  demand(serverA.wire.requests.length === 1, `the mock saw ${serverA.wire.requests.length} requests`);
  const seen = serverA.wire.requests[0];
  demand(seen.keyPresent === true && seen.stream === true
    && seen.path === '/v1/messages' && seen.version === '2023-06-01',
    `the wire facts drifted: ${JSON.stringify(seen)}`);
  emit('byok/wire', {
    path: seen.path, keyPresent: seen.keyPresent,
    version: seen.version, model: seen.model, stream: seen.stream,
  });
  emit('byok/stream', {
    kinds, text, finish: finish?.reason?.kind,
    inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens,
    totalTokens: usage?.totalTokens,
  });
};

/** Phases 5-7: the SECOND save (a strict endpoint demanding a different key
 * — the rebind-over-mount round), the 401 face (neither key value may ride
 * the error message), and the clear leg's LIVE restore. */
const rebindAuthClearPhase = async (api, ctx, strict) => {
  await api['onboarding/save'](CREDENTIAL(strict.baseURL));
  const routesAfter = ctx.llm.listProviders().map((info) => info.id).sort();
  demand(routesAfter.indexOf('anthropic') >= 0, 'the second rebind dropped the route');
  emit('byok/rebind.second', { provider: 'anthropic', routes: routesAfter.length });

  let authError = null;
  const refused = [];
  try {
    const retryPrepared = await ctx.llm.prepareCall({ provider: 'anthropic', model: MODEL_ID });
    const retryStream = retryPrepared.stream({ ...retryPrepared.config, messages: [userTurn()] });
    for await (const chunk of retryStream) refused.push(chunk);
  } catch (error) {
    authError = error;
  }
  // The refusal surfaces as the stream's error finish (pi-ai emits the
  // provider's refusal on the chunk face) or as a thrown error — both are
  // the 401 face; neither may carry key material.
  const errorFinish = refused.find((c) => c.type === 'finish'
    && c.reason?.kind === 'error');
  if (authError === null) {
    demand(errorFinish !== undefined, `the 401 leg neither rejected nor refused: ${JSON.stringify(refused.map((c) => c.type))}`);
    authError = new Error(errorFinish.reason?.failure?.message ?? 'refused');
  }
  const message = String(authError.message ?? '');
  demand(!message.includes(CANARY) && !message.includes(WRONG_KEY),
    'the auth-error message echoed a credential value');
  emit('byok/auth-error.redacted', { keyInMessage: false, chars: message.length });

  await api['onboarding/clear']({});
  const statusAfter = await api['onboarding/status']({});
  demand(statusAfter.mode === 'mock', `status after clear is ${JSON.stringify(statusAfter)}`);
  const stored = await keychainGet('dsh.llm/byok-route');
  demand(stored === null, 'the clear left the keychain ref set');
  const routesFinal = ctx.llm.listProviders().map((info) => info.id).sort();
  demand(routesFinal.indexOf('anthropic') < 0, `the clear left the route: ${JSON.stringify(routesFinal)}`);
  emit('byok/cleanup', { mode: statusAfter.mode, providerGone: true });
};

const main = async () => {
  serverA = await startAnthropicMock(CANARY);
  const ctx = await boot();
  // The unbind seam's factory (composer-web-live registers the same shape).
  registerBootRouteFactory(ctx, () => bootRouteOf({ mockLlmUrl: UNDIALED_BASE, apiKey: CANARY }));
  const hub = makeFrameHub();
  const surface = createWriteSurface(ctx, hub.post, {
    root: ROOT, provider: 'mock', model: 'mock-1', baseURL: UNDIALED_BASE,
    routeKind: 'mock',
    spine: () => [], stagedPlugins: () => [], fullCoverage: true,
  });
  const { api, dispose } = surface;
  await saveAndMountPhase(api, ctx);
  await turnPhase(ctx);
  const strict = await startAnthropicMock(WRONG_KEY);
  await rebindAuthClearPhase(api, ctx, strict);
  await serverA.server.close();
  await strict.server.close();
  dispose?.();
  emit('byok.flow/completed', { status: 'pass' });
  if (!verdict) { verdict = true; globalThis.__dshComplete(true, 'byok anthropic wire verified'); }
};

main().catch(fail);
