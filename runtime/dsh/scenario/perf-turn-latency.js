// dsh:logging-exempt (spine-boot module, the perf-baseline template's class:
// the demand helper never logs — the mounted logger carries every canonical
// line the leg emits)
/**
 * perf.turn-latency — the turn-latency MEASUREMENT leg (the device-light
 * pass, turn leg): ONE mock session turn over the boot spine — the path the
 * on-device seats (session-live / restart families) actually drive — with
 * the turn segmented the way a user feels it:
 *
 *   promptToFirstDeltaMs   followup → the FIRST streamed content delta (the
 *                          time-to-first-token face)
 *   firstDeltaToSettleMs   first delta → whenIdle (the streaming tail: the
 *                          scripted wire's remaining deltas + finish + the
 *                          loop's journal/projection work)
 *   turnMs                 followup → settled (the whole turn)
 *
 * The segmentation is the point: perf.baseline's sessionTurnMs is ONE number
 * over the page's write-surface wire, so a regression hiding in the
 * time-to-first-token phase averages out; this leg names each phase. The
 * boot face and the scripted route mirror perf-baseline (mobile profile over
 * the mock) so the numbers stay comparable; the turn rides the spine, not
 * the write surface — the device seats' shape — and the receipt says so.
 *
 * Every number is emitted into THIS scenario's event stream (D8 — no side
 * channel) and extracted by the runner into the receipt. Numbers are
 * machine-local and jittery BY NATURE: the one-to-one manifest pins the
 * events and their stable fields only (the delta count is the scripted
 * wire's shape: 19 chars / 5-char chunks = 4), never a measured value.
 *
 * The device sibling (hosts/android/ci/run-perf-turn-latency.sh +
 * web-live/android-perf-turn-latency.js) measures the SAME segments on the
 * Android seat; this CLI leg is the simulation half that stays runnable
 * without hardware.
 */
import { createLogger } from 'logger.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { bootUpstream } from 'upstream/boot.js';

const SCENARIO = 'perf.turn-latency';
const SESSION_ID = 's-perf-turn-0001';
const EXPECTED_TEXT = 'Hello from upstream'; // the mock's successText
const TURN_PROMPT = 'Say hello';

const log = createLogger(SCENARIO);
const emit = (event, fields = {}) => log.info('e2e', { scenario: SCENARIO, event, ...fields });
const fail = (reason) => {
  log.debug('scenario failed', { reason });
  emit('perf.turn.failed', { reason });
  globalThis.__dshComplete(false, reason);
};
const demand = (cond, reason) => {
  if (cond) return;
  fail(reason);
  throw new Error(reason);
};

/** The cold-boot clock's origin is the first eval line (perf-baseline's
 * convention): the bootMs here covers the same face, measured again on this
 * leg's own run so the receipt is self-contained. */
const T0 = Date.now();

const launchEnv = () => {
  const raw = globalThis.__dshLaunchEnv?.();
  demand(typeof raw === 'string', 'launch env snapshot missing (CLI must pass --env)');
  return JSON.parse(raw);
};

/** Boot the mobile profile over the mock route — NO persistence row (this
 * leg measures, it does not re-prove the persistence family). The onSse hook
 * is the segmentation probe: it timestamps the first content delta and
 * counts every record, re-emitting each as the scenario's llm/sse line so
 * the manifest pins the wire shape one-to-one (the restart family's pin). */
const bootPhase = async (env) => {
  log.debug('boot phase begin');
  let firstDeltaAt = -1;
  let deltas = 0;
  const { ctx } = await bootUpstream({
    scenario: SCENARIO, agentId: 'perf-turn', sessionId: SESSION_ID,
    cwd: '/perf-ws', onEvent: emit,
    container: { cwd: '/perf-ws', tmpdir: '/perf-ws/.tmp', home: '/perf-ws/home',
      env: {}, argv: ['dsh', '--profile', 'mobile'] },
    llm: { baseURL: env.DSH_MOCK_LLM_URL, apiKey: env.DSH_MOCK_LLM_KEY,
      provider: 'mock', kind: 'mock', model: 'mock-1',
      onSse: (info) => {
        emit('llm/sse', info);
        if (typeof info?.delta === 'string') {
          deltas += 1;
          if (firstDeltaAt < 0) firstDeltaAt = Date.now();
        }
      } },
  });
  let guard = 0;
  while (ctx.agents.get(SESSION_ID) === undefined && guard++ < 10000) {
    await Promise.resolve();
  }
  demand(ctx.agents.get(SESSION_ID) !== undefined, 'the boot agent never appeared');
  emit('perf.turn.boot', { bootMs: Date.now() - T0, profile: 'mobile', provider: 'mock' });
  return { ctx, probe: () => ({ at: firstDeltaAt, deltas }) };
};

/** The measured turn: followup → first delta → settle, each boundary
 * timestamped by the same clock (Date.now, the runtime's only clock). */
const turnPhase = async (rt) => {
  log.debug('turn phase begin');
  const agent = rt.ctx.agents.get(SESSION_ID);
  const promptAt = Date.now();
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: TURN_PROMPT }],
    source: { kind: 'user' },
  }));
  await agent.whenIdle();
  const settledAt = Date.now();
  const { at, deltas } = rt.probe();
  demand(at > 0, 'the turn never streamed a content delta');
  demand(deltas === 4, `the scripted wire streamed ${deltas} deltas, expected 4`);
  const events = rt.ctx.sessions.get(SESSION_ID).snapshotEvents();
  const assistant = events.find((record) => record.type === 'assistant/message');
  demand(assistant !== undefined, 'no assistant/message in the session log');
  const text = assistant.data?.message?.content
    ?.filter((block) => block.type === 'text').map((block) => block.text).join('') ?? '';
  demand(text === EXPECTED_TEXT, `the turn answered "${text}"`);
  emit('assistant/text/asserted', { text: EXPECTED_TEXT });
  emit('perf.turn.latency', {
    promptToFirstDeltaMs: at - promptAt,
    firstDeltaToSettleMs: settledAt - at,
    turnMs: settledAt - promptAt,
    deltas,
    firstDelta: 'Hello',
    textLen: text.length,
  });
};

const main = async () => {
  log.debug('main begin');
  demand(typeof globalThis.__dshGatewayNegotiate === 'function'
    && globalThis.__dshGatewayNegotiate('gateway@1'), 'gateway negotiation failed');
  const env = launchEnv();
  demand(typeof env.DSH_MOCK_LLM_URL === 'string' && env.DSH_MOCK_LLM_URL.startsWith('http://127.0.0.1:'),
    `mock LLM endpoint missing from the launch env: ${JSON.stringify(env.DSH_MOCK_LLM_URL)}`);
  emit('perf.turn.begin', { host: 'macos-cli', profile: 'mobile' });
  const rt = await bootPhase(env);
  await turnPhase(rt);
  emit('perf.turn.completed', { status: 'pass', wallMs: Date.now() - T0 });
  globalThis.__dshComplete(true, 'ok');
};

await main().catch((err) => fail(`uncaught: ${err?.message ?? err}`));
