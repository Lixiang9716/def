// dsh:logging-exempt (dev script: the log stream is the product)
/**
 * Scenario `llm.piai-user-endpoint` — the CLI proof for the fetch→gateway
 * BRIDGE and the named-exception gate behind it (upstream/fetch-gateway-
 * bridge.js + the userEndpoint demand in llm-piai-mount.js):
 *
 *   - the NEGATIVE phase (deterministic, NO network): mounting a route whose
 *     baseURL dials past loopback WITHOUT declaring `userEndpoint: true`
 *     fails loud AT MOUNT, naming the route and the declaration it must
 *     carry — the guard llm-transport.js keeps at its own construction gate,
 *     now on the pi-ai side;
 *   - the POSITIVE phase (needs egress): the same route WITH the declaration
 *     mounts, the bridge installs (the `llm/piai-bridge` honesty event —
 *     hostnames only), and a REAL dial to the well-known endpoint comes back
 *     as a structured HTTP refusal — a 401/403 Response whose body is the
 *     provider's parsed error JSON, NEVER the loud fetch TypeError (the
 *     'no network surface' rejection is the didn't-cross-the-seam marker;
 *     a provider status is the crossed-it proof). The dial's TARGET is the
 *     runner's localhost forwarder companion (a loopback TCP proxy to the
 *     real endpoint): the CLI host's httpFetch serves loopback sockets only,
 *     so the forwarder is how the userEndpoint dial reaches the public
 *     internet on this host; on a device host the same scenario dials the
 *     real URL directly (httpFetch egress is proven there).
 *   - the BYOK phase (the feature's MAIN journey): a boot WITHOUT
 *     piaiProviders, then the page's own save (keychain → rebindLlmRoute)
 *     with an ANTHROPIC credential whose baseURL is the DECLARED non-loopback
 *     endpoint — the byok rebind seam must mount the plugin AND install the
 *     same bridge — then ONE REAL pi-ai turn, refused structurally by the
 *     provider (the probe key is not a credential); never the loud fetch
 *     TypeError.
 *   - the SKIP plane (honest posture, the llm.live-stream descriptor-leg
 *     precedent): when the runner's egress probe fails, the scenario emits
 *     the pinned skip events and the receipt records skipped-honest — an
 *     unreachable network is never faked into a pass. The NEGATIVE phase is
 *     deterministic and runs in BOTH planes (a no-egress CI still proves
 *     the gate).
 *
 * Every expected event is declared one-to-one in
 * test/e2e/scenarios/llm-piai-user-endpoint.json (positive plane) or
 * test/e2e/scenarios/llm-piai-user-endpoint-skip.json (skip plane).
 */
import { createLogger } from 'logger.js';
import { bootUpstream } from 'upstream/boot.js';
import { createWriteSurface } from 'upstream/web-write.js';
import { bootRouteOf, registerBootRouteFactory } from 'upstream/llm-route.js';
import { fetchGatewayBridgeInstalled } from 'upstream/fetch-gateway-bridge.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

const SCENARIO = 'llm.piai-user-endpoint';
const AGENT_ID = 'main';
const SESSION_ID = 's-llm-piai-user-endpoint-0001';
const ROUTE = 'anthropic';
const MODEL_ID = 'claude-sonnet-4-5';
const REAL_BASE = 'https://api.anthropic.com';
// The gateway route is never dialed: port 9 (discard) satisfies the boot's
// serving-route demand without implying a live endpoint.
const UNDIALED_BASE = 'http://127.0.0.1:9';
const ROOT = '/llm-piai-user-endpoint';

const log = createLogger('llm.piai.user.endpoint');
const emit = (event, fields = {}) => log.info('e2e', { scenario: SCENARIO, event, ...fields });
const fail = (reason) => {
  log.debug('scenario failed', { reason: String(reason).slice(0, 300) });
  emit('scenario.failed', { reason: String(reason).slice(0, 300) });
  globalThis.__dshComplete(false, String(reason).slice(0, 300));
};
const demand = (ok, why) => { if (!ok) fail(why); };

const launchEnv = () => {
  const raw = globalThis.__dshLaunchEnv?.();
  demand(typeof raw === 'string', 'launch env snapshot missing (CLI must pass --env)');
  return JSON.parse(raw);
};

/** The boot options for one piaiProviders row (the only variable is the row
 * itself: the endpoint and whether it declares the user endpoint). */
const bootOptions = (providersRow, onEvent) => ({
  scenario: SCENARIO, agentId: AGENT_ID, sessionId: SESSION_ID,
  cwd: ROOT, onEvent,
  container: { cwd: ROOT, tmpdir: `${ROOT}/.tmp`, home: `${ROOT}/home`,
    env: {}, argv: ['dsh', '--profile', 'mobile'] },
  llm: {
    baseURL: UNDIALED_BASE, apiKey: 'bridge-probe-undialed', provider: 'mock', kind: 'mock', model: 'mock-1',
    piaiProviders: { [ROUTE]: providersRow },
  },
});

const piaiRow = (baseURL, userEndpoint) => ({
  displayName: 'Anthropic (user endpoint)',
  api: 'anthropic-messages',
  baseURL,
  models: [{ id: MODEL_ID, name: 'claude sonnet', contextWindow: 200000 }],
  ...(userEndpoint ? { userEndpoint: true } : {}),
});

const main = async () => {
  const env = launchEnv();
  // The NEGATIVE phase is deterministic (no network): it runs in BOTH planes,
  // so a no-egress CI still proves the gate.
  await negativePhase();
  const forwarder = env.DSH_PIAI_FORWARDER_URL;
  if (env.DSH_PIAI_EGRESS !== 'available' || typeof forwarder !== 'string'
    || !/^http:\/\/localhost:\d+$/.test(forwarder)) {
    // The SKIP plane: the runner probed egress and found none. Honest
    // posture, pinned by llm-piai-user-endpoint-skip.json — never a faked 401.
    emit('bridge/skip.honest', { reason: 'egress-unreachable' });
    emit('bridge.flow/completed', { status: 'skipped-honest' });
    globalThis.__dshComplete(true, 'skipped-honest: egress unreachable');
    return;
  }

  await positivePhase(forwarder);
  await byokPhase(forwarder, env.ANTHROPIC_API_KEY);
};

/** The NEGATIVE phase (deterministic, no dial happens): mounting a
 * non-loopback route WITHOUT the declaration fails loud AT MOUNT, naming
 * the route and `userEndpoint: true` — llm-transport's construction-gate
 * discipline on the pi-ai side. */
const negativePhase = async () => {
  try {
    await bootUpstream(bootOptions(piaiRow(REAL_BASE, false), () => {}));
    fail('the undeclared non-loopback route mounted — the gate is missing');
  } catch (error) {
    const message = String(error?.message ?? error);
    demand(message.includes(ROUTE) && message.includes('userEndpoint: true'),
      `the mount gate's rejection drifted: ${message.slice(0, 220)}`);
    emit('bridge/negative.fatal', { route: ROUTE, declared: false });
  }
};

/** The POSITIVE phase (the declared route; egress via the runner's
 * localhost forwarder): the mount emits its honesty events, and a REAL dial
 * through the bridged fetch comes back as a structured provider refusal —
 * the crossed-the-seam proof. */
const positivePhase = async (forwarder) => {
  const { ctx } = await bootUpstream(bootOptions(piaiRow(forwarder, true), emit));
  demand(ctx !== undefined, 'the declared boot failed');
  // (the boot emitted llm/piai-bridge {installed, hosts} + llm/piai — the
  // bridge install is the mount's own honesty statement, pinned verbatim.)
  const response = await fetch(`${forwarder}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': 'bridge-probe-key-not-a-real-credential',
    },
    body: JSON.stringify({
      model: MODEL_ID, max_tokens: 8, stream: false,
      messages: [{ role: 'user', content: 'ping' }],
    }),
  });
  const status = response.status;
  // The provider's refusal shape varies by edge (401 authentication_error
  // for a rejected key, 403 forbidden at the abuse/geolocation edge) — the
  // assertion is the CATEGORY: a structured 4xx provider refusal with a
  // parsed error body, never the loud fetch TypeError.
  demand(Number.isInteger(status) && status >= 400 && status <= 499,
    `the dial was not refused with a provider status: ${String(status)}`);
  // The body may not be JSON (an intercepting proxy's HTML page) — parsed
  // defensively, demanded honestly.
  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); } catch { body = undefined; }
  const providerErrorType = body?.error?.type ?? body?.type;
  demand(typeof providerErrorType === 'string' && providerErrorType.length > 0,
    `the refusal body is not the provider's error shape: ${raw.slice(0, 200)}`);
  emit('bridge/dial.refused', { status, providerErrorType });
};

/** The BYOK phase — the feature's main journey on the SAVE path: a boot
 * with NO piaiProviders, the page's own onboarding save (keychain →
 * rebindLlmRoute → the byok piai dict → rebindPiAiProviders), which must
 * mount the plugin AND install the fetch bridge for the declared
 * non-loopback endpoint, then ONE REAL pi-ai turn — structurally refused by
 * the provider (the probe key is not a credential), never the loud
 * TypeError. */
const byokPhase = async (forwarder, servedKey) => {
  demand(typeof servedKey === 'string' && servedKey.length > 0,
    'ANTHROPIC_API_KEY missing from the launch env (the byok leg needs the probe credential)');
  const { ctx } = await bootUpstream({
    scenario: SCENARIO, agentId: AGENT_ID, sessionId: `${SESSION_ID}-byok`,
    cwd: ROOT, onEvent: () => {},
    container: { cwd: ROOT, tmpdir: `${ROOT}/.tmp`, home: `${ROOT}/home`,
      env: { ANTHROPIC_API_KEY: servedKey }, argv: ['dsh', '--profile', 'mobile'] },
    llm: { baseURL: UNDIALED_BASE, apiKey: servedKey, kind: 'mock', provider: 'mock', model: 'mock-1' },
  });
  // The unbind seam's factory (the composer seat registers the same shape).
  registerBootRouteFactory(ctx, () => bootRouteOf({ mockLlmUrl: UNDIALED_BASE, apiKey: servedKey }));
  const surface = createWriteSurface(ctx, () => {}, {
    root: ROOT, provider: 'mock', kind: 'mock', model: 'mock-1', baseURL: UNDIALED_BASE,
    routeKind: 'mock',
    spine: () => [], stagedPlugins: () => [], fullCoverage: true,
  });
  const { api } = surface;
  await api['onboarding/save']({
    provider: 'anthropic', baseURL: forwarder, apiKey: servedKey, model: MODEL_ID,
  });
  const status = await api['onboarding/status']({});
  demand(status.mode === 'byok' && status.provider === 'anthropic',
    `status after the byok save is ${JSON.stringify(status)}`);
  demand(fetchGatewayBridgeInstalled() === true,
    'the byok rebind did not install the fetch bridge for the declared non-loopback endpoint');
  emit('bridge/byok.saved', { mode: status.mode, provider: status.provider });
  await byokTurnPhase(ctx, servedKey);
  await api['onboarding/clear']({});
  emit('bridge.flow/completed', { status: 'pass' });
  globalThis.__dshComplete(true, 'bridge verified');
};

/** The byok phase's turn half: ONE REAL pi-ai stream through the bridged
 * fetch; the provider's structured refusal is the honest outcome and must
 * never be the loud fetch TypeError nor carry the probe key. */
const byokTurnPhase = async (ctx, servedKey) => {
  const prepared = await ctx.llm.prepareCall({ provider: 'anthropic', model: MODEL_ID });
  const chunks = [];
  let turnError = null;
  try {
    const stream = prepared.stream({ ...prepared.config, messages: [createUserMessage({
      content: [{ type: 'text', text: 'Say hi' }], source: { kind: 'user' },
    })] });
    for await (const chunk of stream) chunks.push(chunk);
  } catch (error) {
    turnError = error;
  }
  const errorFinish = chunks.find((c) => c.type === 'finish' && c.reason?.kind === 'error');
  const message = String(turnError?.message ?? errorFinish?.reason?.failure?.message ?? '');
  demand(message.length > 0, 'the byok turn neither streamed nor refused with a message');
  demand(message.includes('no network surface') === false,
    `the byok dial hit the loud fetch TypeError — the bridge did not carry it: ${message.slice(0, 160)}`);
  demand(message.includes(servedKey) === false, 'the refusal echoed the probe key');
  emit('bridge/byok.refused', { keyAccepted: false, transportStructured: true });
};

main().catch(fail);
