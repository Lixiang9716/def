// dsh:logging-exempt (dev script: the log stream is the product)
/**
 * soak.aging — test-hardening row 11: the SOAK/AGING leg. One spine, one
 * LONG-LIVED session, sustained mock rounds for DSH_SOAK_MINUTES (default
 * 90 — the owner ritual; validation runs scale the env down), sampled as
 * it ages:
 *   - the engine heap watermark, raw every heartbeat, GC-collected at the
 *     brackets (the leak-canary discipline: collected-vs-collected);
 *   - the aging session's journal: total events monotonic, the tail window
 *     contiguous every heartbeat, the WHOLE seq ladder contiguous at the
 *     close — a gap is a dropped record, not a reorder;
 *   - every round answered the mock's marker (a silent turn ages nothing).
 *
 * The heap verdict is PER-ROUND on purpose: an aging session's journal is
 * resident BY DESIGN (ctx.sessions are lifetime maps), so a fixed byte
 * tolerance would red on duration alone. Growth/round under the padded
 * per-round budget is the leak class; the falsification proof shape is the
 * leak-canary's (a retained array per round trips any such budget). The
 * host-process fd face belongs to the runner (JS cannot see it):
 * ci/run-soak-aging.sh samples it and gates the climb.
 */
import { createLogger } from 'logger.js';
import { bootUpstream } from 'upstream/boot.js';
import { createWriteSurface } from 'upstream/web-write.js';

const SCENARIO = 'soak.aging';
const log = createLogger(SCENARIO);
const emit = (event, fields = {}) => log.info('e2e', { scenario: SCENARIO, event, ...fields });
const fail = (reason) => {
  log.debug('scenario failed', { reason });
  emit('soak.aging.failed', { reason });
  globalThis.__dshComplete(false, reason);
};
const demand = (cond, reason) => {
  if (cond) return;
  log.debug('demand failed', { reason });
  fail(reason);
  throw new Error(reason);
};

const ROOT = '/soak-ws';
const HEARTBEAT_ROUNDS = 5;
const TAIL_WINDOW = 64;
/** MEASURED, then padded (never guessed): the validation runs measure the
 * collected-vs-collected growth per round of a healthy aging session (its
 * designed journal residency plus engine ratchet — tens of KB at warmup,
 * settling lower as rounds accumulate). The budget sits an order above any
 * steady-state natural reading and below the falsification class (a
 * retained ~1MB array per round, the leak-canary's proof shape, trips it
 * by 2x). */
const PER_ROUND_TOLERANCE_BYTES = 512 * 1024;

const rawEnv = globalThis.__dshLaunchEnv?.();
demand(typeof rawEnv === 'string', 'launch env snapshot missing (CLI must pass --env)');
const ENV = JSON.parse(rawEnv);
const MOCK_URL = ENV.DSH_MOCK_LLM_URL;
demand(typeof MOCK_URL === 'string' && MOCK_URL.startsWith('http://127.0.0.1:'),
  `mock LLM endpoint missing from the launch env: ${JSON.stringify(MOCK_URL)}`);
const SOAK_MINUTES = Number(ENV.DSH_SOAK_MINUTES ?? 90);
demand(Number.isFinite(SOAK_MINUTES) && SOAK_MINUTES > 0,
  `DSH_SOAK_MINUTES must be a positive number, got ${ENV.DSH_SOAK_MINUTES}`);
const SOAK_MS = SOAK_MINUTES * 60_000;

const heapReading = (collect) => {
  const probe = globalThis.__dshPerfProbe?.(collect ? 'gc' : 'heap');
  demand(probe && typeof probe.memoryUsedSize === 'number',
    '__dshPerfProbe unavailable — the host lacks the measurement hook');
  return probe.memoryUsedSize;
};

const boot = async () => {
  log.debug('boot begin');
  const { ctx } = await bootUpstream({
    scenario: SCENARIO, agentId: 'soak', sessionId: 's-soak-aging',
    cwd: ROOT, onEvent: () => {},
    container: { cwd: ROOT, tmpdir: `${ROOT}/.tmp`, home: `${ROOT}/home`,
      env: {}, argv: ['dsh', '--profile', 'mobile'] },
    systemPrompt: { personaPrefix: '' },
    llm: { baseURL: MOCK_URL, apiKey: ENV.DSH_MOCK_LLM_KEY, provider: 'mock', model: 'mock-1' },
  });
  let guard = 0;
  while ((ctx.agents.get('s-soak-aging') === undefined) && guard++ < 10000) {
    await Promise.resolve();
  }
  demand(ctx.agents.get('s-soak-aging') !== undefined, 'the boot agent never appeared');
  return ctx;
};

const journalSeqs = (events) => events.map((e) => e.seq).filter((n) => Number.isFinite(n));

/** Contiguity over any window: sorted seqs step by exactly 1. */
const demandContiguous = (seqs, what) => {
  if (seqs.length === 0) return;
  const sorted = [...seqs].sort((a, b) => a - b);
  demand(sorted[sorted.length - 1] - sorted[0] === sorted.length - 1,
    `${what}: seq window ${sorted[0]}..${sorted[sorted.length - 1]} spans `
    + `${sorted.length} records (a gap is a dropped record)`);
};

/** The aging loop: prompt→settle rounds until the wall-clock deadline,
 * heartbeat-sampling heap and journal as it goes. Returns the tallies. */
const runRounds = async (ctx, api, sessionId, deadline) => {
  const agent = () => ctx.agents.get(sessionId);
  let rounds = 0;
  let heartbeats = 0;
  let journalEvents = 0;
  while (Date.now() < deadline) {
    rounds += 1;
    await api['session/prompt']({ request: {
      sessionId, requestId: `soak-r${rounds}`, mode: 'queue',
      content: [{ type: 'text', text: 'ping' }],
    } });
    let guard = 0;
    while ((agent() === undefined || agent().busy) && guard++ < 100000) await Promise.resolve();
    const a = agent();
    demand(a !== undefined, `round ${rounds}: agent vanished`);
    await a.whenIdle();
    const events = ctx.sessions.get(sessionId).snapshotEvents();
    demand(events.length > journalEvents,
      `round ${rounds}: journal did not grow (${events.length} <= ${journalEvents})`);
    journalEvents = events.length;
    if (rounds % HEARTBEAT_ROUNDS === 0) {
      heartbeats += 1;
      const tail = journalSeqs(events).slice(-TAIL_WINDOW);
      demandContiguous(tail, `heartbeat ${heartbeats}`);
      emit('soak.aging.heartbeat', {
        at: heartbeats, rounds, journalEvents,
        heapRaw: heapReading(false),
      });
    }
  }
  return { rounds, heartbeats, journalEvents };
};

/** THE CLOSE: the whole seq ladder contiguous, then the collected-vs-
 * collected growth verdict per round; tripped budget completes false. */
const closeSoak = (ctx, sessionId, api, beforeGc, tallies) => {
  const finalEvents = ctx.sessions.get(sessionId).snapshotEvents();
  demandContiguous(journalSeqs(finalEvents), 'final journal');
  demand(finalEvents.length === tallies.journalEvents,
    'journal changed after the last round');
  const afterGc = heapReading(true);
  const growth = afterGc - beforeGc;
  const perRound = tallies.rounds > 0 ? growth / tallies.rounds : Infinity;
  const leaked = perRound > PER_ROUND_TOLERANCE_BYTES;
  emit('soak.aging.verdict', {
    status: leaked ? 'leak' : 'pass',
    minutes: SOAK_MINUTES,
    rounds: tallies.rounds,
    heartbeats: tallies.heartbeats,
    journalEvents: tallies.journalEvents,
    finalSeq: finalEvents[finalEvents.length - 1]?.seq ?? -1,
    beforeMemoryUsedSize: beforeGc,
    afterMemoryUsedSize: afterGc,
    growthBytes: growth,
    growthPerRoundBytes: Math.round(perRound),
    tolerancePerRoundBytes: PER_ROUND_TOLERANCE_BYTES,
  });
  api.dispose?.();
  if (leaked) {
    fail(`heap grew ${Math.round(perRound)} bytes/round over `
      + `${tallies.rounds} rounds (tolerance ${PER_ROUND_TOLERANCE_BYTES})`);
  }
  return !leaked;
};

const main = async () => {
  log.debug('main begin');
  demand(typeof globalThis.__dshGatewayNegotiate === 'function'
    && globalThis.__dshGatewayNegotiate('gateway@1'), 'gateway negotiation failed');
  const ctx = await boot();
  const surface = createWriteSurface(ctx, () => {}, {
    root: ROOT, provider: 'mock', model: 'mock-1', baseURL: MOCK_URL,
    routeKind: 'mock',
    spine: () => [], stagedPlugins: () => [], fullCoverage: true,
  });
  const { api } = surface;

  const created = await api['session/create']({ request: {} });
  const sessionId = created?.sessionId;
  demand(typeof sessionId === 'string' && sessionId.length > 0, 'no aging session minted');

  const beforeGc = heapReading(true);
  emit('soak.aging.begin', { minutes: SOAK_MINUTES, beforeMemoryUsedSize: beforeGc });
  const tallies = await runRounds(ctx, api, sessionId, Date.now() + SOAK_MS);
  if (!closeSoak(ctx, sessionId, api, beforeGc, tallies)) return;
  globalThis.__dshComplete(true, 'ok');
};

await main().catch((err) => fail(`uncaught: ${err?.message ?? err}`));
