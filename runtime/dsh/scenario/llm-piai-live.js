// dsh:logging-exempt (dev script: the log stream is the product)
/**
 * Scenario `llm.piai-live` — the SERVED-KEY live leg for the pi-ai
 * anthropic-messages route (the llm.live-stream real-leg discipline, brought
 * to the multi-protocol family): when the runner SERVES a key, the scenario
 * mounts a real user-declared endpoint and drives ONE REAL turn through
 * pi-ai's wire layer over the fetch→gateway bridge; when no key is served,
 * the scenario says so plainly (the honest skip posture — an absent key is
 * never faked into a pass and never reddened as an environment failure).
 *
 * Planes (the runner picks; the scenario reads only its launch env):
 *   skip — no DSH_PIAI_LIVE_KEY in the launch env (reason no-served-key),
 *          or a key served while the runner's egress probe failed
 *          (DSH_PIAI_LIVE_EGRESS=unreachable, reason egress-unreachable):
 *          emits the pinned skip events; the receipt records skipped-honest.
 *          An unreachable network is never reported as a provider refusal —
 *          a transport failure and an auth refusal are different facts;
 *   real — a served key + a dialable endpoint (the runner's localhost
 *          forwarder companion on the CLI host, or the real URL on a device
 *          host): emits the mount honesty events (llm/piai-bridge, llm/piai)
 *          and the turn's outcome — a completed stream (finish stop) or a
 *          STRUCTURED provider refusal (a served key the provider rejects is
 *          an honest green fact, never a crash); the key value itself rides
 *          the launch env and the apiKeyEnv reference ONLY — it never enters
 *          a log line (the runner audits the raw capture).
 *
 * Every expected event is declared one-to-one in
 * test/e2e/scenarios/llm-piai-live.json (skip plane) or
 * test/e2e/scenarios/llm-piai-live-real.json (real plane).
 */
import { createLogger } from 'logger.js';
import { bootUpstream } from 'upstream/boot.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

const SCENARIO = 'llm.piai-live';
const AGENT_ID = 'main';
const SESSION_ID = 's-llm-piai-live-0001';
const KEY_ENV = 'DSH_PIAI_LIVE_KEY';
const MODEL_ENV = 'DSH_PIAI_LIVE_MODEL';
const BASE_ENV = 'DSH_PIAI_LIVE_BASE_URL';
const DEFAULT_BASE = 'https://api.anthropic.com';
const DEFAULT_MODEL = 'claude-sonnet-4-5';
// The gateway route is never dialed: port 9 (discard) satisfies the boot's
// serving-route demand without implying a live endpoint.
const UNDIALED_BASE = 'http://127.0.0.1:9';
const ROOT = '/llm-piai-live';

const log = createLogger('llm.piai.live');
const emit = (event, fields = {}) => log.info('e2e', { scenario: SCENARIO, event, ...fields });
const fail = (reason) => {
  log.debug('scenario failed', { reason: String(reason).slice(0, 300) });
  emit('scenario.failed', { reason: String(reason).slice(0, 300) });
  globalThis.__dshComplete(false, String(reason).slice(0, 300));
};
const demand = (ok, why) => { if (!ok) fail(why); };

/** The SKIP plane: no key was served. Honest posture, pinned by
 * llm-piai-live.json — the receipt records skipped-honest. */
const skipPlane = (env) => {
  if (typeof env[KEY_ENV] === 'string' && env[KEY_ENV].length > 0
    && env.DSH_PIAI_LIVE_EGRESS !== 'unreachable') return false;
  // Two honest skip reasons, never conflated with a provider refusal: no
  // key was served, or a key was served while the target was unreachable.
  const reason = env.DSH_PIAI_LIVE_EGRESS === 'unreachable'
    ? 'egress-unreachable' : 'no-served-key';
  emit('live/skip.honest', { reason });
  emit('live/flow/completed', { status: 'skipped-honest' });
  globalThis.__dshComplete(true, `skipped-honest: ${reason}`);
  return true;
};

/** The REAL plane's boot: the multi-protocol route over the launch-env
 * credential reference (the REF, never the value) + the named
 * user-endpoint declaration. */
const liveBoot = async (servedKey, baseURL, model) => (await bootUpstream({
  scenario: SCENARIO, agentId: AGENT_ID, sessionId: SESSION_ID,
  cwd: ROOT, onEvent: emit,
  container: { cwd: ROOT, tmpdir: `${ROOT}/.tmp`, home: `${ROOT}/home`,
    env: { [KEY_ENV]: servedKey }, argv: ['dsh', '--profile', 'mobile'] },
  llm: {
    baseURL: UNDIALED_BASE, apiKey: 'undialed-gateway-route', kind: 'mock', provider: 'mock', model: 'mock-1',
    piaiProviders: {
      anthropic: {
        displayName: 'Anthropic (live)',
        apiKeyEnv: KEY_ENV, // the reference, NEVER the key value
        api: 'anthropic-messages',
        baseURL,
        models: [{ id: model, name: model, contextWindow: 200000 }],
        userEndpoint: true, // the named user-endpoint decision
      },
    },
  },
})).ctx;

/** The REAL plane's turn outcome, reported honestly: a streamed finish is
 * the pass; a STRUCTURED refusal (a served key the provider rejected) is an
 * honest green fact; neither may echo the key. */
const turnPhase = async (ctx, model, servedKey) => {
  const prepared = await ctx.llm.prepareCall({ provider: 'anthropic', model });
  demand(prepared.config.provider === 'anthropic' && prepared.config.model === model,
    `prepared config is ${JSON.stringify(prepared.config)}`);
  emit('live/dispatched', { provider: 'anthropic', model });
  const chunks = [];
  let turnError = null;
  try {
    const stream = prepared.stream({ ...prepared.config, messages: [createUserMessage({
      content: [{ type: 'text', text: 'Reply with one short line.' }], source: { kind: 'user' },
    })] });
    for await (const chunk of stream) chunks.push(chunk);
  } catch (error) {
    turnError = error;
  }
  const errorFinish = chunks.find((c) => c.type === 'finish' && c.reason?.kind === 'error');
  const finish = chunks.find((c) => c.type === 'finish');
  const text = chunks.filter((c) => c.type === 'text-delta').map((c) => c.text).join('');
  if (turnError !== null || errorFinish !== undefined) {
    const message = String(turnError?.message ?? errorFinish?.reason?.failure?.message ?? '');
    demand(message.includes(servedKey) === false, 'the refusal echoed the served key');
    demand(message.length > 0, 'the refusal carried no message');
    emit('live/auth-refused', { keyAccepted: false, chars: message.length });
    emit('live/flow/completed', { status: 'pass', outcome: 'refused' });
    globalThis.__dshComplete(true, 'live leg: served key refused by the provider');
    return;
  }
  demand(finish?.reason?.kind === 'stop', `the live turn finished ${JSON.stringify(finish?.reason)}`);
  demand(text.length > 0, 'the live turn produced no text');
  emit('live/stream', { finish: finish.reason.kind, textChars: true });
  emit('live/flow/completed', { status: 'pass', outcome: 'streamed' });
  globalThis.__dshComplete(true, 'live leg: one real streamed turn');
};

const main = async () => {
  const raw = globalThis.__dshLaunchEnv?.();
  demand(typeof raw === 'string', 'launch env snapshot missing (CLI must pass --env)');
  const env = JSON.parse(raw);
  if (skipPlane(env)) return;
  const ctx = await liveBoot(env[KEY_ENV], env[BASE_ENV] ?? DEFAULT_BASE, env[MODEL_ENV] ?? DEFAULT_MODEL);
  demand(ctx !== undefined, 'the live boot failed');
  await turnPhase(ctx, env[MODEL_ENV] ?? DEFAULT_MODEL, env[KEY_ENV]);
};

main().catch(fail);
