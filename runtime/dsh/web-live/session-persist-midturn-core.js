// dsh:logging-exempt (boot module; logging happens through the mounted logger)
/**
 * session-persist-midturn-core.js — the MID-TURN KILL leg's runtime half
 * (the restart family's third boundary), the sibling of
 * session-persist-restart-core.js: the vendored
 * @deepseek-ai/dsh-session-persistence-jsonl backend mounted by the GATED
 * boot row (options.sessionPersistence), ONE process per leg, and the
 * RUNNER owns the kill boundary —
 *
 *   launch 1 (kill leg): the configured session creates, the turn STARTS,
 *   and the leg parks at the FIRST streamed content delta
 *   (midturn/first.delta) — but only after it forced the journal's
 *   materialization MID-STREAM (backend.flush + backend.stat non-empty →
 *   midturn/durable). The runner kills the process on THAT marker; the
 *   parked promise is the leg's completion posture. The turn never
 *   completes: no assistant message, no turn/end in launch 1's journal.
 *
 *   launch 2 (resume leg): the SAME container, the SAME gated boot — the
 *   vendored agent-loop's resume path appends the interrupted-turn closers
 *   (dsh-session's interruptedTurnClosers: a synthesized step/end + a
 *   `turn/end` with reason.kind "interrupted"; pending tool calls would get
 *   their unknown-outcome tool/results) so the restored journal ends at a
 *   REAL boundary, never a half turn — then the recovery turn CONTINUES it
 *   (turn 2; turnBoundary.lastTurn == 2).
 *
 * The scripted model paces the stream so the window is real: the Android
 * carrier's MockLlmRoute SLOW_TURN drip (~220ms/slice). The CLI sibling
 * (scenario/session-persist-midturn.js + ci/run-session-persist-midturn-e2e.sh)
 * drives the same shape against the node mock's slow_success.
 *
 * bus (all dispatches onto the one serial runtime queue):
 *   host → runtime : runtime.config {mockLlmUrl, apiKey, containerRoot},
 *                    web.plugins (buffered, never dispatched — this seat
 *                    has no page and no read-surface probe)
 *   runtime → host : (none — the logger carries every canonical line)
 */
import { createLogger } from 'logger.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { bootUpstream } from 'upstream/boot.js';

const EXPECTED_TEXT = 'Hello from upstream'; // the scripted endpoint's successText
/** The kill turn's prompt carries the carrier's SLOW_TURN marker (the drip
 * selector — MockLlmRoute serves the success body in ~8 slices ~220ms
 * apart); the CLI sibling paces the same wire with slow_success. */
const TURN_KILL_TEXT = 'SLOW_TURN Say hello slowly';
const TURN_RESUME_TEXT = 'Recover after the kill';
/* The restored seed's measured shape (the CLI leg's ground truth,
 * upstream-identical on device: 8 persisted mid-turn records + 2
 * interrupted-turn closers + 1 seed marker = 11; the recovery turn appends
 * 9) is pinned by the checker manifest, NOT demanded here — the persisted
 * set is kill-window-dependent by design, and the leg's runtime demands the
 * INVARIANTS (open turn + exactly the interrupted closer + no assistant
 * message) instead of a count that only one timing history can produce. */

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

/** The assistant/message records' text blocks joined (the scripted text is
 * the marker). Helper keeps the leg functions under the size gate. */
const assistantTexts = (records) => records
  .filter((record) => record.type === 'assistant/message')
  .map((record) => blockText(record));
const blockText = (record) => (record.data?.message?.content ?? [])
  .filter((block) => block.type === 'text').map((block) => block.text).join('');

export const runSessionPersistMidturn = async ({
  scenario, sessionId, logTag,
}) => {
  const log = createLogger(logTag);
  const rt = {
    scenario, sessionId,
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
  const { busOnMessage, take } = makeBus();
  globalThis.__dshBusOnMessage = busOnMessage;
  rt.take = take;
  try {
    await bootAndRun(rt);
  } catch (error) {
    rt.fail(error);
  }
};

/** The gated boot: the restart family's exact block (so the boot records
 * stay comparable) — the profile container from runtime.config, the carrier's
 * scripted llm route, THE GATE under test: `sessionPersistence: {}`, mounted
 * BEFORE the agent loop. The onSse hook is the kill leg's tripwire landing
 * (hooks.firstDelta resolves at the FIRST streamed content delta). */
const bootPhase = async (rt, cfg, hooks) => {
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
      onSse: (info) => {
        rt.emit('llm/sse', info);
        if (typeof info?.delta === 'string') hooks.firstDelta?.(info);
      },
    },
    // THE GATE under test (the CLI scenario's row): mount the vendored
    // JSONL backend.
    sessionPersistence: {},
    listeners: {
      'agent/error': (info) => statuses.push(`error:${JSON.stringify(info)?.slice(0, 200)}`),
      'agent/status': (status) => statuses.push(
        typeof status === 'string' ? status : status?.status),
    },
  });
  return { ctx, statuses };
};

/** Wait (bounded, microtask-granular) for the configured identity + backend,
 * pinning the service key the vendored base fixes. */
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

/** The durability pin: the backend's stat face answers a non-empty artifact
 * (the materialized face — a pending in-memory session carries no sizeBytes). */
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

/** The whole staged run: boot → kill leg (launch 1, restored seed empty) or
 * resume leg (launch 2) — the boot state decides, never a host flag. */
const bootAndRun = async (rt) => {
  const hooks = {};
  const cfg = await rt.take('runtime.config');
  const { ctx, statuses } = await bootPhase(rt, cfg, hooks);
  const { agent, session, backend } = await waitConfigured(rt, ctx);
  const restored = session.snapshotEvents();
  rt.emit('restart/seed', { sessionId: rt.sessionId, restoredEvents: restored.length });
  rt.emit('agent/created', { id: 'main', sessionId: rt.sessionId });
  if (restored.length === 0) {
    await killLeg(rt, { agent, backend, hooks });
    return;
  }
  await resumeLeg(rt, { ctx, agent, session, backend, statuses, restored });
};

/** Launch 1 (kill leg): the turn starts, the journal materializes
 * MID-STREAM, the leg emits the kill marker and parks. The RUNNER's
 * force-stop is this leg's only exit. */
const killLeg = async (rt, env) => {
  rt.demand(Number((await env.backend.stat(rt.sessionId))?.sizeBytes ?? 0) === 0,
    'a materialized artifact exists before the kill turn (stale container)');
  rt.emit('restart/stage', { stage: 'create', sessionId: rt.sessionId });
  let trip = null;
  env.hooks.firstDelta = (info) => {
    const resolve = trip;
    trip = null;
    resolve?.(info);
  };
  rt.emit('midturn/armed', { sessionId: rt.sessionId, prompt: TURN_KILL_TEXT });
  env.agent.followup(createUserMessage({
    content: [{ type: 'text', text: TURN_KILL_TEXT }],
    source: { kind: 'user' },
  }));
  const firstDelta = await Promise.race([
    new Promise((resolve) => { trip = resolve; }),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('no content delta within 30s — the scripted drip is broken')), 30000)),
  ]);
  rt.emit('midturn/first.delta', { delta: firstDelta?.delta, streamOpen: true });
  // Force the journal's materialization WHILE the turn is still open (the
  // drip keeps streaming in parallel); the kill marker rides THAT condition.
  await env.backend.flush();
  const midTurnBytes = Number((await env.backend.stat(rt.sessionId))?.sizeBytes ?? 0);
  rt.demand(midTurnBytes > 0, `the journal never materialized mid-turn (stat ${midTurnBytes} bytes)`);
  rt.emit('midturn/durable', { sizeBytes: midTurnBytes, streamOpen: true });
  await new Promise(() => {}); // parked; the force-stop IS the completion
};

/** Launch 2 (resume leg): the restored seed (turn 1's OPEN journal + the
 * recovery closers) → the recovery turn continues the journal. */
const resumeLeg = async (rt, env) => {
  rt.emit('restart/stage', { stage: 'resume', sessionId: rt.sessionId });
  const types = env.restored.map((record) => record.type);
  rt.demand(types.includes('turn/start'),
    'the restored seed carries no turn boundary — the kill landed before the turn opened');
  const turnEnds = env.restored.filter((record) => record.type === 'turn/end');
  rt.demand(turnEnds.length === 1,
    `the restored seed carries ${turnEnds.length} turn/end records, expected exactly the recovery closer`);
  rt.demand(turnEnds[0]?.data?.reason?.kind === 'interrupted',
    `the turn/end closer is ${JSON.stringify(turnEnds[0]?.data?.reason)} — not the interrupted-turn synthesis`);
  rt.demand(assistantTexts(env.restored).length === 0,
    "the restored seed carries turn 1's assistant message — the kill landed after the stream settled (window missed)");
  rt.emit('midturn/restored', {
    events: env.restored.length,
    tail: types[types.length - 1],
    closerReason: turnEnds[0]?.data?.reason?.kind,
    assistantMessages: 0,
  });
  await runTurn(env.agent, TURN_RESUME_TEXT);
  const after = env.session.snapshotEvents();
  const appended = after.length - env.restored.length;
  rt.demand(appended > 0, 'the recovery turn appended no session events');
  rt.demand(assistantTexts(after).filter((text) => text === EXPECTED_TEXT).length === 1,
    `expected exactly the recovery turn's answer, got ${JSON.stringify(assistantTexts(after))}`);
  const turns = after
    .filter((record) => record.type === 'turn/start').map((record) => record.data?.turn);
  rt.demand(turns.includes(1) && turns.includes(2),
    `journal turns are ${JSON.stringify(turns)} — not continued`);
  const turnBoundary = env.ctx.sessionProjections.stateOf(env.session, 'turnBoundary');
  rt.demand(turnBoundary !== undefined && turnBoundary.lastTurn === 2,
    `turnBoundary.lastTurn is ${turnBoundary?.lastTurn}`);
  rt.emit('midturn/continued', {
    restoredEvents: env.restored.length, appended,
    totalEvents: after.length, lastTurn: turnBoundary.lastTurn,
  });
  await env.backend.flush();
  await assertStored(rt, env.backend, 'the recovery turn');
  demandNoAgentErrors(rt, env.statuses);
  rt.emit('midturn/artifact', { sessionId: rt.sessionId, events: after.length });
  rt.emit('restart/leg.settled', {
    leg: 'resume', pass: true,
    restoredEvents: env.restored.length, totalEvents: after.length, lastTurn: 2,
  });
  rt.emit('upstream/completed', { status: 'pass', leg: 'resume', backend: 'vendored session-persistence-jsonl' });
  globalThis.__dshComplete(true, `${rt.scenario} resume leg: pass — the journal survived a mid-stream kill`);
};
