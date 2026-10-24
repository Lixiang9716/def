// dsh:logging-exempt (spine-boot module, the session-persistence template's
// class: the demand/take helpers never log — the mounted logger carries every
// canonical line the leg emits)
/**
 * session-multi-stress.js — the MULTI-SESSION INTERLEAVED STRESS leg's CLI
 * proof (`session.multi.stress`, test-hardening row 21): FOUR sessions on ONE
 * booted spine over ONE pinned profile container (DSH_SPIKE_TMPDIR), driven
 * through interleaved rounds with the mock stream PACED
 * (DSH_MOCK_CHUNK_DELAY_MS) so turn windows genuinely overlap — the exact
 * shape of the T-0210 burst (2026-10-10 final sweep: 4 concurrent sessions,
 * late settle frames mis-attributed), now asserted at the RUNTIME journal.
 * Two legs, two dsh-cli processes, one container; the assertion machinery
 * (the attribution firehose + the journal/projection/durability
 * re-derivation) lives in scenario/session-multi-stress-legs.js, the shared
 * constants in scenario/session-multi-stress-ids.js.
 *
 *   leg "drive" (process 1): the boot session (alpha) plus THREE created
 *     sessions (beta, gamma via agents.create — the same spine factory path
 *     the write surface uses). Round 1 bursts alpha/beta/gamma concurrently;
 *     round 2a bursts alpha and beta and DELTA IS CREATED MID-FLIGHT — while
 *     their round-2 turns are provably still open (turn-2 starts on the
 *     journals, boundaries already at 2); round 2b runs gamma's scripted
 *     TOOL turn SOLO on the now-idle wire (the mock's sequence is consumed
 *     in wire-arrival order and an idle wire is the only boundary that pins
 *     a position, so the tool_call_success slot provably lands on gamma's
 *     request — a schema-valid todo_write); round 3 bursts all four — the
 *     peak-open counter proves the 4-way overlap from the journals.
 *
 *   leg "recover" (process 2, same container): alpha RESUMES from its stored
 *     artifact through the config-driven start (the persistence row's
 *     restoreOrCreateConfigured path), then beta, gamma and delta each resume
 *     EXPLICITLY through ctx.agents.resume — four independent recoveries from
 *     four independent artifacts. Each resumed journal must carry exactly its
 *     own drive-side shape (turns 1..K, the scripted answers, gamma's one
 *     tool round and nobody else's) and then CONTINUE: one recovery turn per
 *     session lands turn K+1, settled, with turnBoundary.lastTurn == K+1.
 *
 * The scenario's demand() chain is the assertion set; the runner
 * (ci/run-session-multi-stress-e2e.sh) verifies the concatenated log
 * one-to-one against test/e2e/scenarios/session-multi-stress.json, audits the
 * container disk between the processes, and counts the mock's served requests
 * (the stress must be clean streaming: a hidden retry shifts the script).
 */
import { createLogger } from 'logger.js';
import { fsScope } from 'gateway.js';
import { bootUpstream } from 'upstream/boot.js';
import {
  BOOT_SESSION, CREATED_SESSIONS, DRIVE_TURNS,
  INSERTED_SESSION, SESSION_IDS, TOOL_NAME, TOOL_SESSION,
} from 'scenario/session-multi-stress-ids.js';
import {
  assertJournalShape, assertRestoredSeed, createSession, demandBackend,
  demandDurable, demandTurnBoundary, installFirehose, launchEnv,
  startTurn, waitJournalRecord, waitJournalTurns, waitSession,
} from 'scenario/session-multi-stress-legs.js';

const SCENARIO = 'session.multi.stress';

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

/** Boot the gated profile (the session-persistence template's exact shape:
 * the persistence row + the agent-error listener). */
const bootPhase = async (env) => {
  log.debug('boot phase begin');
  const resolved = await fsScope.resolve('scope://app/');
  const root = resolved?.path;
  demand(typeof root === 'string' && root.startsWith('/'),
    `profile container not resolved: ${JSON.stringify(resolved)}`);
  const statuses = [];
  const { ctx } = await bootUpstream({
    scenario: SCENARIO,
    agentId: 'stress',
    sessionId: BOOT_SESSION,
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
      kind: 'mock',
      model: 'mock-1',
    },
    // THE GATE under test: every session created while this row is mounted
    // persists through the vendored JSONL backend (the loop's createStoredSession).
    sessionPersistence: {},
    listeners: {
      'agent/error': (info) => statuses.push(`error:${JSON.stringify(info)?.slice(0, 200)}`),
      'agent/status': (status) => statuses.push(typeof status === 'string' ? status : status?.status),
    },
  });
  emit('stress/booted', { leg: env.DSH_STRESS_LEG, containerRoot: root });
  return { ctx, statuses, root };
};

/** ROUND 1 — the first concurrent burst (3 open streams at once; the
 * firehose's peak-open counter proves the overlap from the journals). */
const driveRoundOne = async (drive) => {
  const { agents, ctx, stats, demandClean } = drive;
  log.debug('drive round 1 begin');
  emit('stress/round', { round: 1, started: [BOOT_SESSION, ...CREATED_SESSIONS] });
  startTurn(agents.alpha, 'alpha round 1');
  startTurn(agents.beta, 'beta round 1');
  startTurn(agents.gamma, 'gamma round 1');
  await Promise.all([agents.alpha, agents.beta, agents.gamma].map((a) => a.whenIdle()));
  demandClean();
  demandTurnBoundary(ctx, BOOT_SESSION, 1, demand);
  demandTurnBoundary(ctx, 's-stress-beta', 1, demand);
  demandTurnBoundary(ctx, TOOL_SESSION, 1, demand);
  demand(stats.peakOpen === 3,
    `round 1 peaked at ${stats.peakOpen} open turns, expected 3 — the streams did not actually overlap`);
  emit('stress/round.settled', { round: 1, sessions: 3, peakOpen: stats.peakOpen });
  stats.peakOpen = 0;
};

/** ROUND 2a — alpha and beta burst, and DELTA IS CREATED MID-FLIGHT: the
 * insertion happens while alpha's and beta's round-2 turns are PROVABLY
 * still open (their turn-2 starts are on the journals — the projection's
 * lastTurn rides turn/START, so it already reads 2), and delta's first turn
 * opens inside that window. */
const driveRoundTwoInsert = async (drive) => {
  const { agents, ctx, stats, demandClean } = drive;
  log.debug('drive round 2a begin');
  emit('stress/round', {
    round: 2,
    started: [BOOT_SESSION, 's-stress-beta'],
    inserted: INSERTED_SESSION,
  });
  startTurn(agents.alpha, 'alpha round 2');
  startTurn(agents.beta, 'beta round 2');
  await waitJournalTurns(ctx.sessions.get(BOOT_SESSION), 2, demand);
  await waitJournalTurns(ctx.sessions.get('s-stress-beta'), 2, demand);
  demandTurnBoundary(ctx, BOOT_SESSION, 2, demand);
  demandTurnBoundary(ctx, 's-stress-beta', 2, demand);
  agents.delta = await createSession(ctx, INSERTED_SESSION, drive.root, demand, emit);
  startTurn(agents.delta, 'delta round 1 (inserted mid-flight)');
  await Promise.all([agents.alpha, agents.beta, agents.delta].map((a) => a.whenIdle()));
  demandClean();
  demandTurnBoundary(ctx, BOOT_SESSION, 2, demand);
  demandTurnBoundary(ctx, 's-stress-beta', 2, demand);
  demandTurnBoundary(ctx, INSERTED_SESSION, 1, demand);
  demand(stats.peakOpen === 3,
    `round 2 peaked at ${stats.peakOpen} open turns, expected 3 — the insertion did not land mid-flight`);
  emit('stress/round.settled', {
    round: 2, sessions: 3, inserted: INSERTED_SESSION, peakOpen: stats.peakOpen,
  });
  stats.peakOpen = 0;
};

/** ROUND 2b — the scripted TOOL turn runs SOLO on the now-idle wire (the
 * mock's sequence is consumed in wire-arrival order, and the only boundary
 * that pins a position is an IDLE wire: gamma's round-2 request is provably
 * the 7th — the tool_call_success slot). A mis-attributed tool landing hands
 * the tool records to a different session and the firehose fails loud, in
 * the moment. */
const driveRoundTwoTool = async (drive) => {
  const { agents, ctx, demandClean } = drive;
  log.debug('drive round 2b begin');
  emit('stress/round', { round: 2, phase: 'tool', soloToolTurn: TOOL_SESSION });
  startTurn(agents.gamma, 'gamma round 2 (tool)');
  await waitJournalRecord(ctx.sessions.get(TOOL_SESSION), 'tool/call', demand);
  emit('stress/tool.call.observed', {
    sessionId: TOOL_SESSION,
    turn: 2,
    name: TOOL_NAME,
  });
  // MID-FLIGHT ISOLATION (second face): the tool's landing must not have
  // moved the siblings' projections from their own settled counts.
  demandTurnBoundary(ctx, BOOT_SESSION, 2, demand);
  demandTurnBoundary(ctx, 's-stress-beta', 2, demand);
  demandTurnBoundary(ctx, INSERTED_SESSION, 1, demand);
  await agents.gamma.whenIdle();
  demandClean();
  demandTurnBoundary(ctx, TOOL_SESSION, 2, demand);
  emit('stress/round.settled', { round: 2, phase: 'tool', sessions: 1, peakOpen: 1 });
};

/** ROUND 3 — the full four-session burst: the peak-open proof that the
 * interleaving is real at 4-way width. */
const driveRoundThree = async (drive) => {
  const { ctx, stats, demandClean } = drive;
  log.debug('drive round 3 begin');
  emit('stress/round', { round: 3, started: SESSION_IDS });
  for (const id of SESSION_IDS) startTurn(ctx.agents.get(id), `${id} round 3`);
  await Promise.all(SESSION_IDS.map((id) => ctx.agents.get(id).whenIdle()));
  demandClean();
  demand(stats.peakOpen === 4, `round 3 peaked at ${stats.peakOpen} open turns, expected 4`);
  emit('stress/round.settled', { round: 3, sessions: 4, peakOpen: stats.peakOpen });
};

/** The drive CLOSE — the end-state re-derivation + the durability pin. */
const driveClose = async (drive) => {
  const { ctx, backend, state, trip, statuses } = drive;
  log.debug('drive close begin');
  demand(trip.reason === null, `the attribution firehose tripped: ${trip.reason}`);
  const listedIds = await demandDurable(backend, SESSION_IDS, demand);
  emit('stress/durable', { sessions: listedIds.length, artifacts: listedIds });
  for (const id of SESSION_IDS) {
    const shape = assertJournalShape(ctx.sessions.get(id), DRIVE_TURNS[id], demand);
    const lastTurn = demandTurnBoundary(ctx, id, DRIVE_TURNS[id], demand);
    const stored = await backend.stat(id);
    emit('stress/session.summary', {
      sessionId: id,
      turns: shape.assistantCount,
      toolRounds: shape.toolRounds,
      events: shape.events,
      lastTurn,
      sizeBytes: Number(stored?.sizeBytes ?? 0),
    });
  }
  const settled = [...state.values()].reduce((sum, st) => sum + st.closed.length, 0);
  const expectedSettles = SESSION_IDS.reduce((sum, id) => sum + DRIVE_TURNS[id], 0);
  demand(settled === expectedSettles,
    `the firehose settled ${settled} turns, expected ${expectedSettles}`);
  const errors = statuses.filter((status) => String(status).startsWith('error:'));
  demand(errors.length === 0, `agent errors surfaced: ${errors.join(' | ')}`);
  emit('upstream/completed', {
    status: 'pass',
    leg: 'drive',
    sessions: SESSION_IDS.length,
    turns: settled,
    backend: 'vendored session-persistence-jsonl',
  });
  globalThis.__dshComplete(true,
    `${SCENARIO} drive leg: pass — ${SESSION_IDS.length} interleaved sessions, ${settled} turns, every frame in its own turn`);
};

/** LEG "drive": the interleaved burst. */
const driveLeg = async (ctx, root, statuses) => {
  log.debug('drive leg begin');
  const backend = demandBackend(ctx);
  const { state, stats, trip } = installFirehose(ctx, demand, emit);
  // Re-demand the firehose's trip at every barrier: a listener throw is
  // contained by the session-store, so the main flow carries the failure.
  const demandClean = () => demand(trip.reason === null,
    `the attribution firehose tripped: ${trip.reason}`);
  const alpha = (await waitSession(ctx, BOOT_SESSION)).agent;
  // The three round-1 sessions: alpha (configured at boot) + beta/gamma
  // created through the spine factory. All three prompt in ONE synchronous
  // block — the paced streams keep every turn window open while its
  // siblings run (the overlap the firehose's peak counter proves).
  const beta = await createSession(ctx, 's-stress-beta', root, demand, emit);
  const gamma = await createSession(ctx, TOOL_SESSION, root, demand, emit);
  const drive = {
    ctx, root, backend, state, stats, trip, demandClean, statuses,
    agents: { alpha, beta, gamma, delta: undefined },
  };
  await driveRoundOne(drive);
  await driveRoundTwoInsert(drive);
  await driveRoundTwoTool(drive);
  await driveRoundThree(drive);
  await driveClose(drive);
};

/** The recover leg's seeds: alpha through the config-driven start, the other
 * three EXPLICITLY through the registry's resume path — each loads its OWN
 * artifact; a cross-wired read would seed the wrong journal and the shape
 * demand fails loud. */
const recoverSeeds = async (ctx) => {
  log.debug('recover seeds begin');
  await waitSession(ctx, BOOT_SESSION);
  assertRestoredSeed(ctx.sessions.get(BOOT_SESSION), DRIVE_TURNS, demand, emit);
  demandTurnBoundary(ctx, BOOT_SESSION, DRIVE_TURNS[BOOT_SESSION], demand);
  for (const id of ['s-stress-beta', TOOL_SESSION, INSERTED_SESSION]) {
    await ctx.agents.resume({
      resumeSessionId: id,
      agentOptions: { provider: 'mock', model: 'mock-1' },
    });
    await waitSession(ctx, id);
    assertRestoredSeed(ctx.sessions.get(id), DRIVE_TURNS, demand, emit);
    demandTurnBoundary(ctx, id, DRIVE_TURNS[id], demand);
  }
};

/** The continuation: one recovery turn per session, sequentially (the
 * resumed journals continue at turn K+1 — each session's own next turn). */
const recoverContinuations = async (ctx, backend) => {
  log.debug('recover continuations begin');
  for (const id of SESSION_IDS) {
    const agent = ctx.agents.get(id);
    const session = ctx.sessions.get(id);
    const before = session.snapshotEvents().length;
    startTurn(agent, `${id} recovery turn`);
    await agent.whenIdle();
    const nextTurn = DRIVE_TURNS[id] + 1;
    demandTurnBoundary(ctx, id, nextTurn, demand);
    const after = session.snapshotEvents();
    demand(after.length > before, `${id}: the recovery turn appended no journal records`);
    const newEnds = after.filter((e) => e.type === 'turn/end' && e.data?.turn === nextTurn);
    demand(newEnds.length === 1 && newEnds[0]?.data?.reason?.kind === 'completed',
      `${id}: turn ${nextTurn} did not close completed`);
    emit('stress/continued', { sessionId: id, turn: nextTurn, totalEvents: after.length });
  }
  await demandDurable(backend, SESSION_IDS, demand);
};

/** LEG "recover": four independent recoveries from four independent
 * artifacts, each continued by its own recovery turn. */
const recoverLeg = async (ctx, statuses) => {
  log.debug('recover leg begin');
  const backend = demandBackend(ctx); // the gated row is what makes every resume possible
  await recoverSeeds(ctx);
  await recoverContinuations(ctx, backend);
  const errors = statuses.filter((status) => String(status).startsWith('error:'));
  demand(errors.length === 0, `agent errors surfaced: ${errors.join(' | ')}`);
  emit('upstream/completed', {
    status: 'pass',
    leg: 'recover',
    sessions: SESSION_IDS.length,
    backend: 'vendored session-persistence-jsonl',
  });
  globalThis.__dshComplete(true,
    `${SCENARIO} recover leg: pass — all ${SESSION_IDS.length} sessions resumed from their own artifacts and continued`);
};

const main = async () => {
  log.debug('main begin');
  const env = launchEnv();
  demand(typeof env.DSH_MOCK_LLM_URL === 'string' && env.DSH_MOCK_LLM_URL.startsWith('http://127.0.0.1:'),
    `mock LLM endpoint missing from the launch env: ${JSON.stringify(env.DSH_MOCK_LLM_URL)}`);
  const leg = env.DSH_STRESS_LEG;
  demand(leg === 'drive' || leg === 'recover', `DSH_STRESS_LEG must be drive|recover, got ${JSON.stringify(leg)}`);
  const { ctx, statuses, root } = await bootPhase(env);
  if (leg === 'drive') await driveLeg(ctx, root, statuses);
  else await recoverLeg(ctx, statuses);
};

main().catch(fail);
