// dsh:logging-exempt (boot module; logging happens through the mounted logger)
/**
 * session-persist-restart-core.js — the SHARED runtime half behind the three
 * device restart legs (session-persist.restart family; the parameterized
 * sibling of session-web-live.js, which stays the b3 read-back leg): the
 * vendored @deepseek-ai/dsh-session-persistence-jsonl backend mounted by the
 * GATED boot row (options.sessionPersistence — this seat IS the persistence
 * leg, exactly the CLI scenario's `sessionPersistence: {}` at
 * scenario/session-persistence.js:98), ONE REAL agent-loop turn per process,
 * and the process boundary is the runner's FORCE KILL + relaunch:
 *
 *   launch 1 (create leg): the backend mounts under `sessionPersistence`
 *   before the agent loop, the loop's config-driven start CREATES the
 *   configured session, one scripted turn journals it, backend.flush()
 *   materializes it and backend.stat() answers a non-empty artifact — then
 *   the seat completes and the RUNNER kills the process (force-stop /
 *   simctl terminate / aa force-stop; nothing here exits politely).
 *
 *   launch 2 (resume leg): the SAME container, the SAME gated boot — the
 *   loop's restoreOrCreateConfigured path RESUMES the stored artifact (the
 *   SessionPersistenceNotFoundError fall-through to create never fires), the
 *   seat pins the restored journal (turn 1 present, tail at the persisted
 *   boundary), pins session/list carrying the old session through the
 *   mounted read surface (the real makeListSessions handler the page's rpc
 *   would hit), and the second turn CONTINUES the journal across the
 *   restart (turn 2; turnBoundary.lastTurn == 2 — the CLI leg's
 *   cross-process ground truth).
 *
 * Self-staging: the leg reads the boot state (restored seed empty or not) —
 * no host-side stage flag. A kill BEFORE the first turn lands degrades to a
 * clean create leg on the next launch, never a false resume.
 *
 * The per-host entries (session-persist-restart.js / android-… / harmony-…)
 * differ only in scenario id, session identity, and the logcat ~4KB line
 * budget (Android emits runtime.booted's entryCount, the others the full
 * list — the session-live family's split, kept).
 *
 * bus (all dispatches onto the one serial runtime queue):
 *   host → runtime : runtime.config {mockLlmUrl, apiKey, containerRoot},
 *                    web.plugins, api.request, mux.open, mux.cancel
 *   runtime → host : web.boot, api.claim, mux.claim, api.respond,
 *                    mux.item | mux.error | mux.end
 */
import { createLogger } from 'logger.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { bootUpstream } from 'upstream/boot.js';
import { CLAIMED_ENDPOINTS, createWebBootRuntime } from 'upstream/web-boot.js';

const EXPECTED_TEXT = 'Hello from upstream'; // the scripted endpoint's successText
const TURN_1_TEXT = 'Say hello';
const TURN_2_TEXT = 'Say hello again';
/** The journal shapes the CLI leg proved cross-process (logs-persist-*.txt,
 * receipt events {create:11, resume:11}, restored seed 12, total 21): turn 1
 * lands 11 events in memory, the materialized seed replays 12 (the persist
 * boundary appends one), and the resumed second turn appends 9. Device runs
 * (2026-10-11) measured the same shapes on both hosts. */
const TURN_1_EVENT_COUNT = 11;
const RESTORED_EVENT_COUNT = 12;

/** Bus deliveries may arrive before the awaiting half exists (the drive
 * injects right after eval), so the subscription is module-scope, buffers,
 * and wakes pending `take()` waiters — never a poll. Once `dispatch` is
 * installed, deliveries go straight to it. */
const makeBus = () => {
  const queue = [];
  let wake = null;
  let dispatch = null;
  const busOnMessage = (line) => {
    const msg = JSON.parse(line);
    if (dispatch !== null) return dispatch(msg);
    queue.push(msg);
    wake?.();
  };
  const post = (msg) => globalThis.__dshBusPost?.(JSON.stringify(msg));
  const take = async (type) => {
    for (;;) {
      const at = queue.findIndex((msg) => msg.type === type);
      if (at >= 0) return queue.splice(at, 1)[0];
      await new Promise((resolve) => { wake = resolve; });
      wake = null;
    }
  };
  const install = (handler) => {
    dispatch = handler;
    for (const msg of queue.splice(0)) handler(msg);
  };
  return { busOnMessage, post, take, install };
};

/** The assistant/message records' text blocks joined (the scripted text is
 * the marker). Helper keeps the leg functions under the size gate. */
const assistantTexts = (records) => records
  .filter((record) => record.type === 'assistant/message')
  .map((record) => blockText(record));
const blockText = (record) => (record.data?.message?.content ?? [])
  .filter((block) => block.type === 'text').map((block) => block.text).join('');

export const runSessionPersistRestart = async ({
  scenario, sessionId, logTag, bootedEntries = 'list',
}) => {
  const log = createLogger(logTag);
  const rt = {
    scenario, sessionId, bootedEntries,
    emit: (event, fields = {}) => log.info('e2e', { scenario, event, ...fields }),
  };
  rt.fail = (reason) => {
    const error = reason instanceof Error ? reason : null;
    const message = error ? error.message : String(reason);
    log.debug('scenario failed', { reason: message });
    rt.emit('scenario.failed', { reason: message });
    globalThis.__dshComplete(false, message);
  };
  rt.demand = (cond, reason) => {
    if (cond) return;
    rt.fail(reason);
    throw new Error(reason);
  };
  const { busOnMessage, post, take, install } = makeBus();
  globalThis.__dshBusOnMessage = busOnMessage;
  rt.post = post;
  rt.take = take;
  rt.install = install;
  try {
    await bootAndRun(rt);
  } catch (error) {
    rt.fail(error);
  }
};

/** The gated boot: the profile container is the host-granted root from the
 * runtime.config delivery; the llm route the carrier's scripted endpoint
 * (the session-live family's exact block, so the boot records stay
 * comparable); THE GATE under test: `sessionPersistence: {}` — DEFAULTS
 * (root <container>/dsh/sessions inside the granted scope, the vendored
 * default compression), mounted BEFORE the agent loop so the config-driven
 * start takes the restore/create wire. */
const bootPhase = async (rt, cfg) => {
  const root = cfg.containerRoot;
  rt.demand(typeof root === 'string' && root.startsWith('/'),
    `profile container not granted by the host: ${JSON.stringify(root)}`);
  rt.demand(typeof cfg.mockLlmUrl === 'string' && cfg.mockLlmUrl.startsWith('http://127.0.0.1:'),
    `runtime.config mock endpoint missing: ${JSON.stringify(cfg.mockLlmUrl)}`);
  const statuses = [];
  const { ctx } = await bootUpstream({
    scenario: rt.scenario,
    agentId: 'main',
    sessionId: rt.sessionId,
    cwd: root, // absolute POSIX: the profile container root (upstream validates)
    onEvent: rt.emit,
    container: {
      cwd: root,
      tmpdir: `${root}/tmp`,
      home: `${root}/home`,
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
      onWire: (info) => rt.emit('llm/request/built', info),
      onSse: (info) => rt.emit('llm/sse', info),
    },
    // THE GATE under test (the CLI scenario's row, scenario/
    // session-persistence.js:98): mount the vendored JSONL backend.
    sessionPersistence: {},
    listeners: {
      'agent/error': (info) => statuses.push(`error:${JSON.stringify(info)?.slice(0, 200)}`),
      'agent/status': (status) => statuses.push(
        typeof status === 'string' ? status : status?.status),
    },
  });
  return { ctx, statuses };
};

/** Wait (bounded, microtask-granular) for the configured identity + backend
 * (async past the mount), pinning the service key the vendored base fixes. */
const waitConfigured = async (rt, ctx) => {
  let guard = 0;
  while (!identityReady(ctx, rt.sessionId) && guard++ < 100000) {
    await Promise.resolve();
  }
  rt.demand(identityReady(ctx, rt.sessionId),
    `the configured identity never appeared for "${rt.sessionId}"`);
  const backend = ctx.get('sessionPersistence');
  rt.demand(backend !== undefined,
    'sessionPersistence service missing — the gated row did not mount');
  rt.emit('persistence/service', { name: backend.name, key: 'sessionPersistence' });
  rt.demand(backend.name === 'session-persistence-jsonl', `backend label is ${backend.name}`);
  return {
    agent: ctx.agents.get(rt.sessionId),
    session: ctx.sessions.get(rt.sessionId),
    backend,
  };
};
const identityReady = (ctx, sessionId) => ctx.agents.get(sessionId) !== undefined
  && ctx.sessions.get(sessionId) !== undefined;

/** One REAL upstream turn through the agent loop; resolves when idle. */
const runTurn = async (agent, text) => {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }));
  await agent.whenIdle();
};

/** The turn-1 assertion (the session-live family's shape): the REAL session
 * log the journal carries, the scripted text inside it. */
const assertTurn1 = (rt, session) => {
  const events = session.snapshotEvents();
  const types = events.map((record) => record.type);
  rt.emit('session.log', { count: types.length, types });
  rt.demand(types.length === TURN_1_EVENT_COUNT,
    `turn 1 landed ${types.length} events, expected ${TURN_1_EVENT_COUNT}`);
  const texts = assistantTexts(events);
  rt.demand(texts.includes(EXPECTED_TEXT), `assistant text is ${JSON.stringify(texts)}`);
  rt.emit('assistant/text/asserted', { text: EXPECTED_TEXT });
};

/** The runtime half for the OFFICIAL boot wire, mounted on the SPINE ctx
 * (the b3 shape): claims + api.request + journal streams all answer from
 * ctx.sessions. The host's web.plugins delivery drains here — the mounted
 * wire's records land at this deterministic point of the emit order. The
 * in-process api.request probe rides the SAME handler face the page's rpc
 * hits (makeListSessions), answered to the host AND to the local waiter. */
const installRuntimeHalf = (rt, ctx) => {
  const probeWaiters = new Map();
  const onHandler = (msg, outcome) => {
    outcome.run().then(
      (value) => settleProbe(rt, probeWaiters, msg.rpcId, { ok: true, value }, value),
      (error) => settleProbe(rt, probeWaiters, msg.rpcId, {
        ok: false,
        error: { code: 'gateway/unavailable',
          message: error instanceof Error ? error.message : String(error), details: {} },
      }, undefined, error),
    ).catch(rt.fail);
  };
  const runtime = createWebBootRuntime({ ctx, post: rt.post });
  const busHandler = (msg) => {
    const outcome = runtime.deliver(msg);
    if (outcome.kind === 'booted') emitBooted(rt, outcome);
    else if (outcome.kind === 'handler') onHandler(msg, outcome);
  };
  // `dispatch` installs BEFORE the buffer drains: a delivery racing the swap
  // goes direct or is still in the queue — never stranded, never doubled.
  globalThis.__dshRestartDeliver = busHandler;
  rt.install(busHandler);
  return (rpcId, endpoint) => new Promise((resolve, reject) => {
    probeWaiters.set(rpcId, { resolve, reject });
    globalThis.__dshRestartDeliver?.({
      type: 'api.request', rpcId, endpoint, payload: { args: {} },
    });
  });
};
const settleProbe = (rt, waiters, rpcId, result, value, error) => {
  rt.post({ type: 'api.respond', rpcId, result });
  const waiter = waiters.get(rpcId);
  if (waiter) {
    waiters.delete(rpcId);
    if (error) waiter.reject(error); else waiter.resolve(value);
  }
};
const emitBooted = (rt, outcome) => {
  // entryCount on the logcat-capped host, the full list elsewhere (the
  // session-live family's transport split).
  rt.emit('runtime.booted', rt.bootedEntries === 'count'
    ? { entryCount: outcome.entries.length,
      source: 'vendored @deepseek-ai/dsh-client-modules composed in-runtime' }
    : { entries: outcome.entries,
      source: 'vendored @deepseek-ai/dsh-client-modules composed in-runtime' });
  rt.emit('session.services.claimed', {
    endpoints: CLAIMED_ENDPOINTS,
    stream: 'session/journal',
    source: 'the on-device spine (ctx.sessions)',
  });
};

/** The whole staged run: boot → create leg (launch 1) or resume leg
 * (launch 2) — the boot state decides, never a host flag. */
const bootAndRun = async (rt) => {
  const cfg = await rt.take('runtime.config');
  const { ctx, statuses } = await bootPhase(rt, cfg);
  const { agent, session, backend } = await waitConfigured(rt, ctx);
  const restored = session.snapshotEvents();
  rt.emit('restart/seed', { sessionId: rt.sessionId, restoredEvents: restored.length });
  rt.emit('agent/created', { id: 'main', sessionId: rt.sessionId });
  if (restored.length === 0) {
    await createLeg(rt, { ctx, agent, session, backend, statuses });
    return;
  }
  await resumeLeg(rt, { ctx, agent, session, backend, statuses, restored });
};

/** Launch 1: create → one scripted turn → flush + stat → durable. */
const createLeg = async (rt, env) => {
  rt.demand(env.session.snapshotEvents().length === 0,
    'the fresh configured session carried events at boot');
  rt.emit('restart/stage', { stage: 'create', sessionId: rt.sessionId });
  await runTurn(env.agent, TURN_1_TEXT);
  assertTurn1(rt, env.session);
  // Routed live events batch into the handle on a deadline; the RUNNER is
  // about to force-kill the process, so force materialization through the
  // backend's own flush face (the SessionHandle.flush contract).
  await env.backend.flush();
  await assertStored(rt, env.backend, 'turn1');
  installRuntimeHalf(rt, env.ctx);
  demandNoAgentErrors(rt, env.statuses);
  rt.emit('restart/artifact', { sessionId: rt.sessionId, phase: 'turn1', events: TURN_1_EVENT_COUNT });
  rt.emit('restart/leg.settled', { leg: 'create', pass: true, events: TURN_1_EVENT_COUNT });
  rt.emit('upstream/completed', { status: 'pass', leg: 'create', backend: 'vendored session-persistence-jsonl' });
  globalThis.__dshComplete(true, `${rt.scenario} create leg: pass — journal durable, ready for the force kill`);
};

/** Launch 2: the restored seed → journal/list pins → the continuing turn. */
const resumeLeg = async (rt, env) => {
  assertRestoredSeed(rt, env.restored);
  rt.emit('restart/stage', { stage: 'resume', sessionId: rt.sessionId });
  assertJournalTail(rt, env.restored);
  const listProbe = installRuntimeHalf(rt, env.ctx);
  await assertListed(rt, listProbe);
  await runTurn(env.agent, TURN_2_TEXT);
  const after = env.session.snapshotEvents();
  const appended = after.length - env.restored.length;
  rt.demand(appended > 0, 'turn 2 appended no session events');
  rt.emit('journal/live', {
    turn: 2, events: appended,
    note: 'appended after the restart resume (cross-process continuation)',
  });
  assertContinuation(rt, env, after);
  await env.backend.flush();
  await assertStored(rt, env.backend, 'turn2');
  demandNoAgentErrors(rt, env.statuses);
  rt.emit('restart/artifact', { sessionId: rt.sessionId, phase: 'turn2', events: after.length });
  rt.emit('restart/leg.settled', {
    leg: 'resume', pass: true,
    restoredEvents: env.restored.length, totalEvents: after.length, lastTurn: 2,
  });
  rt.emit('upstream/completed', { status: 'pass', leg: 'resume', backend: 'vendored session-persistence-jsonl' });
  globalThis.__dshComplete(true, `${rt.scenario} resume leg: pass — the journal survived the force kill and turn 2 continued it`);
};

/** The restored seed: turn 1 is IN it (turn boundary + assistant message). */
const assertRestoredSeed = (rt, restored) => {
  rt.demand(restored.length === RESTORED_EVENT_COUNT,
    `the restored seed carried ${restored.length} events, expected ${RESTORED_EVENT_COUNT}`);
  rt.demand(restored.some((record) => record.type === 'turn/start'),
    'the restored seed carries no turn boundary');
  const texts = assistantTexts(restored);
  rt.demand(texts.includes(EXPECTED_TEXT),
    `the restored seed lost turn 1's assistant message (${JSON.stringify(texts)})`);
};

/** The journal tail pin: the restored log ENDS at the persisted boundary —
 * the force kill cost the journal nothing. The vendored seed replay
 * terminates with its own `session/end-seed` marker (measured on device
 * 2026-10-11: tail `session/end-seed`, seed 12 events — the CLI leg's
 * cross-process ground truth); a bare `turn/end` tail is the pre-seed
 * shape. Anything else is a truncated restore. */
const assertJournalTail = (rt, restored) => {
  const lastType = restored[restored.length - 1]?.type;
  rt.demand(lastType === 'session/end-seed' || lastType === 'turn/end',
    `the restored journal tail is ${lastType}`);
  rt.emit('session.journal.real', { baseline: restored.length, lastType, live: 0 });
};

/** The session/list pin, through the REAL read surface (makeListSessions):
 * the old session is IN the list after the restart, not blank. */
const assertListed = async (rt, listProbe) => {
  const listed = await listProbe('probe/session-list-1', 'session.list');
  const items = Array.isArray(listed?.items) ? listed.items : [];
  const mine = items.find((item) => item?.sessionId === rt.sessionId);
  rt.demand(mine !== undefined,
    `session/list lost the restored session (items: ${JSON.stringify(items).slice(0, 300)})`);
  rt.demand(mine.blank === false, 'the restored session lists as blank');
  rt.emit('session.list.real', {
    sessionId: rt.sessionId, sessions: items.length,
    running: mine.running === true, blank: mine.blank === true,
  });
};

/** The continuation pins: both turns' texts, turn/start 1 AND 2 in one
 * journal, the turnBoundary projection crossing the restart. */
const assertContinuation = (rt, env, after) => {
  const texts = assistantTexts(after);
  rt.demand(texts.filter((text) => text === EXPECTED_TEXT).length === 2,
    `expected both turns' assistant messages, got ${JSON.stringify(texts)}`);
  const turns = after
    .filter((record) => record.type === 'turn/start').map((record) => record.data?.turn);
  rt.demand(turns.includes(1) && turns.includes(2),
    `journal turns are ${JSON.stringify(turns)} — not continued`);
  const turnBoundary = env.ctx.sessionProjections.stateOf(env.session, 'turnBoundary');
  rt.demand(turnBoundary !== undefined && turnBoundary.lastTurn === 2,
    `turnBoundary.lastTurn is ${turnBoundary?.lastTurn}`);
  rt.emit('restart/turnBoundary', { lastTurn: turnBoundary.lastTurn });
};

/** The durability pin: the backend's stat face answers a non-empty artifact
 * (durable per append — the flush above only forces the batch). */
const assertStored = async (rt, backend, phase) => {
  const stored = await backend.stat(rt.sessionId);
  rt.demand(stored !== undefined, `backend.stat found no stored session after ${phase}`);
  rt.demand(Number(stored.sizeBytes) > 0,
    `stored artifact is empty (${stored.sizeBytes} bytes) after ${phase}`);
};
const demandNoAgentErrors = (rt, statuses) => {
  const errors = statuses.filter((s) => String(s).startsWith('error:'));
  rt.demand(errors.length === 0, `agent errors surfaced: ${errors.join(' | ')}`);
};
