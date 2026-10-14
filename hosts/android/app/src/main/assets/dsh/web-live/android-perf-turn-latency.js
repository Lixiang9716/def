// dsh:logging-exempt (boot module; logging happens through the mounted logger)
/**
 * android-perf-turn-latency.js — the Android seat of the turn-latency
 * MEASUREMENT leg (scenario `android.perf.turn-latency`, the device-light
 * pass's turn leg): one REAL agent-loop turn over the spine — the path the
 * on-device seats (session-live / restart families) drive — with the turn
 * segmented the way a user feels it, every number emitted into THIS
 * scenario's event stream (D8 — no side channel; the runner extracts them
 * from the captured log into the receipt):
 *
 *   promptToFirstDeltaMs   followup → the FIRST streamed content delta
 *   firstDeltaToSettleMs   first delta → whenIdle
 *   turnMs                 followup → settled
 *
 * The CLI sibling (scenario/perf-turn-latency.js +
 * ci/run-perf-turn-latency.sh) measures the SAME segments on the CLI host;
 * the two receipts are the device-light pass's turn-leg record. Numbers are
 * machine-local and jittery BY NATURE: the manifest pins the events and
 * their stable fields only, never a measured value.
 *
 * NO persistence row: this leg measures, it does not re-prove the
 * persistence family. No page, no read-surface probe (the web.plugins
 * delivery stays buffered — the midturn sibling's posture).
 *
 * bus (all dispatches onto the one serial runtime queue):
 *   host → runtime : runtime.config {mockLlmUrl, apiKey, containerRoot},
 *                    web.plugins (buffered, never dispatched)
 *   runtime → host : (none — the logger carries every canonical line)
 */
import { createLogger } from 'logger.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { bootUpstream } from 'upstream/boot.js';

const SCENARIO = 'android.perf.turn-latency';
const SESSION_ID = 's-android-perf-turn-0001';
const EXPECTED_TEXT = 'Hello from upstream'; // the scripted endpoint's successText
const TURN_PROMPT = 'Say hello';

/** Bus deliveries arrive before the awaiting half exists (the drive injects
 * right after eval), so the subscription is module-scope and buffers. */
const makeBus = () => {
  const queue = [];
  let wake = null;
  const busOnMessage = (line) => {
    queue.push(JSON.parse(line));
    wake?.();
  };
  const take = async (type) => {
    for (;;) {
      const at = queue.findIndex((msg) => msg.type === type);
      if (at >= 0) return queue.splice(at, 1)[0];
      await new Promise((resolve) => { wake = resolve; });
      wake = null;
    }
  };
  return { busOnMessage, take };
};

/** Boot the mobile profile over the carrier's scripted route — NO
 * persistence row. The onSse hook feeds the segmentation probe: it
 * timestamps the first content delta and counts every record, re-emitting
 * each as the scenario's llm/sse line (the restart family's wire pin). */
const bootPhase = async (log, emit, cfg, probe) => {
  log.debug('boot phase begin');
  demand(typeof cfg.containerRoot === 'string' && cfg.containerRoot.startsWith('/'),
    `profile container not granted by the host: ${JSON.stringify(cfg.containerRoot)}`);
  demand(typeof cfg.mockLlmUrl === 'string' && cfg.mockLlmUrl.startsWith('http://127.0.0.1:'),
    `runtime.config mock endpoint missing: ${JSON.stringify(cfg.mockLlmUrl)}`);
  const T0 = Date.now();
  const { ctx } = await bootUpstream({
    scenario: SCENARIO,
    agentId: 'perf-turn',
    sessionId: SESSION_ID,
    cwd: cfg.containerRoot, // absolute POSIX: the profile container root
    onEvent: emit,
    container: {
      cwd: cfg.containerRoot,
      tmpdir: `${cfg.containerRoot}/tmp`,
      home: `${cfg.containerRoot}/home`,
      env: { DSH_MOCK_LLM_URL: cfg.mockLlmUrl, DSH_MOCK_LLM_KEY: cfg.apiKey },
      argv: ['dsh', '--profile', 'mobile'],
    },
    llm: {
      baseURL: cfg.mockLlmUrl,
      apiKey: cfg.apiKey,
      provider: 'mock',
      model: 'mock-1',
      adapterName: 'scripted loopback chat-completions (carrier mock-llm endpoint)',
      transportLabel: 'gateway httpFetch → carrier scripted chat-completions '
        + '(E2E determinism boundary, mirrors the CLI mock server)',
      onWire: (info) => emit('llm/request/built', info),
      onSse: (info) => {
        emit('llm/sse', info);
        if (typeof info?.delta === 'string') {
          probe.deltas += 1;
          if (probe.firstDeltaAt < 0) probe.firstDeltaAt = Date.now();
        }
      },
    },
  });
  let guard = 0;
  while (ctx.agents.get(SESSION_ID) === undefined && guard++ < 100000) {
    await Promise.resolve();
  }
  demand(ctx.agents.get(SESSION_ID) !== undefined, 'the boot agent never appeared');
  emit('perf.turn.boot', { bootMs: Date.now() - T0, profile: 'mobile', provider: 'mock' });
  return ctx;
};

/** The measured turn: followup → first delta → settle, each boundary
 * timestamped by the same clock (Date.now, the runtime's only clock). */
const turnPhase = (log, emit, ctx, probe) => {
  log.debug('turn phase begin');
  const agent = ctx.agents.get(SESSION_ID);
  const promptAt = Date.now();
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: TURN_PROMPT }],
    source: { kind: 'user' },
  }));
  return agent.whenIdle().then(() => {
    const settledAt = Date.now();
    demand(probe.firstDeltaAt > 0, 'the turn never streamed a content delta');
    demand(probe.deltas === 4, `the scripted wire streamed ${probe.deltas} deltas, expected 4`);
    const events = ctx.sessions.get(SESSION_ID).snapshotEvents();
    const assistant = events.find((record) => record.type === 'assistant/message');
    demand(assistant !== undefined, 'no assistant/message in the session log');
    const text = assistant.data?.message?.content
      ?.filter((block) => block.type === 'text').map((block) => block.text).join('') ?? '';
    demand(text === EXPECTED_TEXT, `the turn answered "${text}"`);
    emit('assistant/text/asserted', { text: EXPECTED_TEXT });
    emit('perf.turn.latency', {
      promptToFirstDeltaMs: probe.firstDeltaAt - promptAt,
      firstDeltaToSettleMs: settledAt - probe.firstDeltaAt,
      turnMs: settledAt - promptAt,
      deltas: probe.deltas,
      firstDelta: 'Hello',
      textLen: text.length,
    });
  });
};

let emitFail = null;
const demand = (cond, reason) => {
  if (cond) return;
  emitFail?.('scenario.failed', { reason });
  globalThis.__dshComplete(false, reason);
  throw new Error(reason);
};

const runTurnLatency = async () => {
  const log = createLogger('android.perf.turn');
  const emit = (event, fields = {}) => log.info('e2e', { scenario: SCENARIO, event, ...fields });
  emitFail = emit;
  const { busOnMessage, take } = makeBus();
  globalThis.__dshBusOnMessage = busOnMessage;
  const probe = { firstDeltaAt: -1, deltas: 0 };
  const cfg = await take('runtime.config');
  const ctx = await bootPhase(log, emit, cfg, probe);
  await turnPhase(log, emit, ctx, probe);
  emit('perf.turn.completed', { status: 'pass' });
  globalThis.__dshComplete(true, `${SCENARIO}: pass — turn segments measured`);
};

runTurnLatency().catch((error) => globalThis.__dshComplete(false,
  `${SCENARIO} boot: ${error?.message ?? error}`));
