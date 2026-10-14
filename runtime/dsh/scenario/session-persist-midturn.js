// dsh:logging-exempt (spine-boot module, the session-persistence template's
// class: the demand/take helpers never log — the mounted logger carries every
// canonical line the leg emits)
/**
 * session-persist-midturn.js — the MID-TURN KILL leg's CLI proof
 * (`session.persistence.midturn`): the vendored
 * @deepseek-ai/dsh-session-persistence-jsonl backend mounted by the GATED
 * boot row, ONE dsh-cli process per leg over ONE pinned profile container
 * (DSH_SPIKE_TMPDIR), and the RUNNER owns the kill boundary —
 *
 *   leg "kill" (process 1): the configured session creates, the turn starts,
 *   and the scenario parks at the FIRST streamed content delta
 *   (midturn/first.delta). The mock stream is paced
 *   (DSH_MOCK_CHUNK_DELAY_MS) so the turn is PROVABLY still open when the
 *   runner kills the process (SIGKILL — nothing polite). The leg never
 *   completes; the kill IS its completion. If the kill lands late (the turn
 *   settled on disk first), the runner's disk audit fails loud naming it —
 *   the window is the mock's pacing, sized to the runner's poll.
 *
 *   leg "resume" (process 2, same container): the same boot config RESUMES
 *   the stored artifact — the restored seed carries turn 1's OPEN journal
 *   (turn/start, the request records; no turn/end, no assistant message:
 *   the turn never finished) — and the recovery turn CONTINUES the journal.
 *   The integrity claim is the backend's own replay: a torn physical tail is
 *   truncated-and-warned by the vendored recovery, a half record never
 *   replays, and a `corrupt session log` line anywhere is the leg's red.
 *
 * The scenario's demand() chain is the assertion set; the runner
 * (ci/run-session-persist-midturn-e2e.sh) verifies the log one-to-one
 * against test/e2e/scenarios/session-persistence-midturn.json and records the
 * receipt. The device sibling (the restart family's Android seat +
 * hosts/android/ci/run-session-persist-midturn.sh) drives the same shape on
 * the carrier's SLOW_TURN drip.
 */
import { createLogger } from 'logger.js';
import { fsScope } from 'gateway.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { bootUpstream } from 'upstream/boot.js';

const SCENARIO = 'session.persistence.midturn';
const AGENT_ID = 'main';
const SESSION_ID = 's-persist-midturn-0001';
const EXPECTED_TEXT = 'Hello from upstream'; // the mock server's successText
const TURN_TEXT = { kill: 'Say hello slowly', resume: 'Recover after the kill' };

const log = createLogger('dsh.scenario');
const emit = (event, fields = {}) => log.info('e2e', { scenario: SCENARIO, event, ...fields });
const fail = (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  log.debug('scenario failed', { reason: message });
  emit('scenario.failed', { reason: message });
  globalThis.__dshComplete(false, message);
};
const demand = (cond, reason) => {
  if (cond) return;
  fail(reason);
  throw new Error(reason);
};

/** The launch env snapshot (--env KEY=VALUE on the CLI). */
const launchEnv = () => {
  const raw = globalThis.__dshLaunchEnv?.();
  demand(typeof raw === 'string', 'launch env snapshot missing (CLI must pass --env)');
  return JSON.parse(raw);
};

/** Boot the gated profile (the session-persistence template's exact shape:
 * the persistence row + the agent-error listener). The onSse hook is the
 * kill leg's tripwire: it resolves the waiter at the FIRST streamed content
 * delta — the moment the turn is provably mid-stream. */
const bootPhase = async (env, hooks) => {
  log.debug('boot phase begin');
  const resolved = await fsScope.resolve('scope://app/');
  const root = resolved?.path;
  demand(typeof root === 'string' && root.startsWith('/'), `profile container not resolved: ${JSON.stringify(resolved)}`);
  const statuses = [];
  const { ctx } = await bootUpstream({
    scenario: SCENARIO,
    agentId: AGENT_ID,
    sessionId: SESSION_ID,
    cwd: root,
    onEvent: emit,
    container: {
      cwd: root,
      tmpdir: `${root}/tmp`,
      home: `${root}/home`,
      env,
      argv: ['dsh', '--profile', 'mobile'],
    },
    llm: {
      baseURL: env.DSH_MOCK_LLM_URL,
      apiKey: env.DSH_MOCK_LLM_KEY,
      provider: 'mock',
      model: 'mock-1',
      onSse: (info) => {
        emit('llm/sse', info);
        if (typeof info?.delta === 'string') hooks.firstDelta?.(info);
      },
    },
    // THE GATE under test: mount the vendored JSONL backend (before the
    // agent loop, so the config-driven start takes the restore/create wire).
    sessionPersistence: {},
    listeners: {
      'agent/error': (info) => statuses.push(`error:${JSON.stringify(info)?.slice(0, 200)}`),
      'agent/status': (status) => statuses.push(typeof status === 'string' ? status : status?.status),
    },
  });
  emit('persistence/booted', { leg: env.DSH_SESSIONS_LEG, containerRoot: root });
  return { ctx, statuses };
};

/** Wait (bounded) for the configured identity, then the session + backend. */
const waitConfigured = async (ctx) => {
  log.debug('wait configured begin');
  let guard = 0;
  while ((ctx.agents.get(SESSION_ID) === undefined || ctx.sessions.get(SESSION_ID) === undefined)
    && guard++ < 10000) {
    await Promise.resolve();
  }
  demand(ctx.agents.get(SESSION_ID) !== undefined, `agent "${SESSION_ID}" never appeared in the registry`);
  demand(ctx.sessions.get(SESSION_ID) !== undefined, `session "${SESSION_ID}" never appeared in the store`);
  const backend = ctx.get('sessionPersistence');
  demand(backend !== undefined, 'sessionPersistence service missing — the gated row did not mount');
  emit('persistence/service', { name: backend.name, key: 'sessionPersistence' });
  demand(backend.name === 'session-persistence-jsonl', `backend label is ${backend.name}`);
  return { agent: ctx.agents.get(SESSION_ID), session: ctx.sessions.get(SESSION_ID), backend };
};

/** One turn START (followup only — the caller owns the waiting face). */
const startTurn = (agent, text) => {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }));
};

/** Leg "kill": boot → the turn starts → park at the first content delta.
 * The park is the design: this process's only exit is the runner's kill.
 * `hooks` is the bootPhase onSse tripwire's landing — the SAME object, or
 * the first delta resolves nothing (measured: a local hooks object left the
 * leg parked on a live stream until the deadline failed loud). */
const killLeg = async (ctx, hooks) => {
  log.debug('kill leg begin');
  let trip = null;
  hooks.firstDelta = (info) => {
    const resolve = trip;
    trip = null;
    resolve?.(info);
  };
  const { agent, backend } = await waitConfigured(ctx);
  demand(backend !== undefined, 'backend missing');
  // stat answers a PENDING record (header+revision, no sizeBytes) for the
  // freshly configured session; the MATERIALIZED artifact is the sizeBytes
  // face — absent before the kill turn (a stale container would fake resume).
  demand(Number((await backend.stat(SESSION_ID))?.sizeBytes ?? 0) === 0,
    'a materialized artifact exists before the kill turn (stale container)');
  emit('midturn/armed', { sessionId: SESSION_ID, prompt: TURN_TEXT.kill });
  startTurn(agent, TURN_TEXT.kill);
  const firstDelta = await Promise.race([
    new Promise((resolve) => { trip = resolve; }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('no content delta within 30s — the mock pacing is broken')), 30000)),
  ]);
  emit('midturn/first.delta', { delta: firstDelta?.delta, streamOpen: true });
  // Force the journal's materialization WHILE the turn is still open (the
  // stream keeps dripping in parallel): flush the handle batch, then demand
  // the backend's stat face answers a MATERIALIZED artifact. The kill marker
  // rides THAT condition — the runner kills on `midturn/durable`, never on a
  // clock — so the on-disk state at kill time is the leg's own claim.
  await backend.flush();
  const midTurnStat = await backend.stat(SESSION_ID);
  const midTurnBytes = Number(midTurnStat?.sizeBytes ?? 0);
  demand(midTurnBytes > 0, `the journal never materialized mid-turn (stat ${midTurnBytes} bytes)`);
  emit('midturn/durable', { sizeBytes: midTurnBytes, streamOpen: true });
  // The stream is open and the journal is durable; the RUNNER kills this
  // process now. Parking forever is the leg's completion posture — the
  // runner's deadline is the only watchman past this point.
  await new Promise(() => {});
};

/** The restored-seed pins: an OPEN turn that the recovery closed — exactly
 * one turn/end, carrying the interrupted-turn synthesis, and turn 1's
 * assistant message nowhere in it. Returns the closer's reason + the seed's
 * text count for the midturn/restored emit. */
const assertRestoredOpenTurn = (restored) => {
  const types = restored.map((record) => record.type);
  demand(restored.length > 0, 'the resumed session carried no seed — the kill turn journaled nothing');
  demand(types.includes('turn/start'), 'the restored seed carries no turn boundary — the kill landed before the turn opened');
  const turnEnds = restored.filter((record) => record.type === 'turn/end');
  demand(turnEnds.length === 1, `the restored seed carries ${turnEnds.length} turn/end records, expected exactly the recovery closer`);
  demand(turnEnds[0]?.data?.reason?.kind === 'interrupted',
    `the turn/end closer is ${JSON.stringify(turnEnds[0]?.data?.reason)} — not the interrupted-turn synthesis`);
  const restoredTexts = restored
    .filter((record) => record.type === 'assistant/message')
    .map((record) => (record.data?.message?.content ?? [])
      .filter((block) => block.type === 'text').map((block) => block.text).join(''));
  demand(!restoredTexts.includes(EXPECTED_TEXT),
    'the restored seed carries turn 1\'s assistant message — the kill landed after the stream settled (window missed)');
  return { types, closerReason: turnEnds[0]?.data?.reason?.kind, assistantCount: restoredTexts.length };
};

/** The continuation pins: the recovery turn's answer (exactly one — turn 1
 * never produced one), both turn boundaries in one journal, the
 * turnBoundary projection crossing the kill. */
const assertContinuation = (ctx, session, restored, after) => {
  const texts = after
    .filter((record) => record.type === 'assistant/message')
    .map((record) => (record.data?.message?.content ?? [])
      .filter((block) => block.type === 'text').map((block) => block.text).join(''));
  demand(texts.filter((text) => text === EXPECTED_TEXT).length === 1,
    `expected exactly the recovery turn's answer, got ${JSON.stringify(texts)}`);
  const turns = after
    .filter((record) => record.type === 'turn/start').map((record) => record.data?.turn);
  demand(turns.includes(1) && turns.includes(2), `journal turns are ${JSON.stringify(turns)} — not continued`);
  const turnBoundary = ctx.sessionProjections.stateOf(session, 'turnBoundary');
  demand(turnBoundary !== undefined && turnBoundary.lastTurn === 2,
    `turnBoundary.lastTurn is ${turnBoundary?.lastTurn}`);
  return { appended: after.length - restored.length, lastTurn: turnBoundary.lastTurn };
};

/** Leg "resume": the SAME boot config on the SAME container — the stored
 * artifact (turn 1's OPEN journal + the recovery closers) seeds the session,
 * then the recovery turn CONTINUES the journal (turn 2). */
const resumeLeg = async (ctx) => {
  log.debug('resume leg begin');
  const { agent, session, backend } = await waitConfigured(ctx);
  const restored = session.snapshotEvents();
  const seed = assertRestoredOpenTurn(restored);
  emit('midturn/restored', {
    events: restored.length,
    tail: seed.types[seed.types.length - 1],
    closerReason: seed.closerReason,
    assistantMessages: seed.assistantCount,
  });
  startTurn(agent, TURN_TEXT.resume);
  await agent.whenIdle();
  const after = session.snapshotEvents();
  const { appended, lastTurn } = assertContinuation(ctx, session, restored, after);
  demand(appended > 0, 'the recovery turn appended no session events');
  emit('midturn/continued', {
    restoredEvents: restored.length,
    appended,
    totalEvents: after.length,
    lastTurn,
  });
  await backend.flush();
  const stored = await backend.stat(SESSION_ID);
  demand(stored !== undefined, 'backend.stat found no stored session after the recovery turn');
  demand(Number(stored.sizeBytes) > 0, `stored artifact is empty (${stored.sizeBytes} bytes)`);
  emit('midturn/artifact', { sizeBytes: Number(stored.sizeBytes), events: after.length });
};

const main = async () => {
  log.debug('main begin');
  const env = launchEnv();
  demand(typeof env.DSH_MOCK_LLM_URL === 'string' && env.DSH_MOCK_LLM_URL.startsWith('http://127.0.0.1:'),
    `mock LLM endpoint missing from the launch env: ${JSON.stringify(env.DSH_MOCK_LLM_URL)}`);
  const leg = env.DSH_SESSIONS_LEG;
  demand(leg === 'kill' || leg === 'resume', `DSH_SESSIONS_LEG must be kill|resume, got ${JSON.stringify(leg)}`);
  const hooks = {};
  const { ctx, statuses } = await bootPhase(env, hooks);
  if (leg === 'kill') await killLeg(ctx, hooks);
  else {
    await resumeLeg(ctx);
    const errors = statuses.filter((status) => String(status).startsWith('error:'));
    demand(errors.length === 0, `agent errors surfaced: ${errors.join(' | ')}`);
    emit('upstream/completed', { status: 'pass', leg: 'resume', backend: 'vendored session-persistence-jsonl' });
    globalThis.__dshComplete(true, `${SCENARIO} resume leg: pass — the journal survived a mid-stream kill`);
  }
};

main().catch(fail);
