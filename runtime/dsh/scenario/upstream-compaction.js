/**
 * upstream compaction scenario `upstream.compaction` — the LONG-SESSION
 * compaction proof (2026-10-11 deep item): the GATED boot row
 * (`options.compaction` → upstream/boot-compaction.js) mounts the host-plane
 * token meter plus the VENDORED compaction-basic engine over the real spine,
 * and one real two-turn mock conversation trips the AUTO step-pressure
 * compaction between the second turn's `turn/start` and its first step.
 *
 * Flow: bootUpstream composes the mobile profile with the compaction row
 * (engine config: auto + a tuned threshold so exactly one compaction lands
 * below it) → turn 1 routes one real request (the session's requestHeader is
 * the routed target compaction reads; its long user payload carries the token
 * mass the shrink check prices the checkpoint against) → turn 2's pre-step
 * pressure check measures totalTokens >= thresholdTokens and compacts the
 * turn-1 span: the engine appends `compaction/start`, summarizes the replayed
 * prefix through ctx.llm.stream (the mock answers the same successText),
 * appends `compaction/summary`, replaces the span with the framed checkpoint
 * user message, and closes with `compaction/end` — then the turn proceeds.
 * The scenario walks ctx.sessions' authoritative log, asserts the compaction
 * record set and the freed pressure, and emits every record one-to-one for
 * test/e2e/scenarios/upstream-compaction.json.
 */
import { createLogger } from 'logger.js';
import { fsScope } from 'gateway.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { bootUpstream } from 'upstream/boot.js';

const SCENARIO = 'upstream.compaction';
const AGENT_ID = 'main';
const SESSION_ID = 's-m2-upstream-compaction-0001';
const EXPECTED_TEXT = 'Hello from upstream'; // the mock server's successText (ci/mock-llm-server.mjs)
// The turn-one payload: the deterministic token mass the shrink check prices
// the framed checkpoint against (the summary must estimate smaller).
const TURN_ONE_TEXT = 'compaction seed paragraph for the long-session proof. '.repeat(96);
const TURN_TWO_TEXT = 'Continue the proof.';
// The route's compaction capacity (boot llm option) and the tuned engine
// config: thresholdTokens = floor(8192 * 0.75) = 6144 sits between the
// post-compaction total (~5560 meter-estimated) and the pre-compaction total
// (6764 meter-estimated) of this exact conversation — both readings are
// deterministic and pinned by the manifest — so exactly ONE compaction runs
// and lands below the threshold.
const CONTEXT_WINDOW = 8192;
const ENGINE_CONFIG = {
  auto: true,
  thresholdRatio: 0.75,
  retainTokens: 0,
  compactionRetries: 0,
};

const log = createLogger('dsh.scenario');
const emit = (event, fields = {}) => log.info('e2e', { scenario: SCENARIO, event, ...fields });
const fail = (reason) => {
  const error = reason instanceof Error ? reason : null;
  const message = error ? error.message : String(reason);
  const withStack = error?.stack
    ? `${message} | ${error.stack.split('\n').slice(0, 4).join(' / ')}`
    : message;
  log.debug('scenario failed', { reason: withStack });
  emit('scenario.failed', { reason: withStack });
  globalThis.__dshComplete(false, withStack);
};
const demand = (cond, reason) => {
  if (cond) return;
  log.debug('demand failed', { reason });
  fail(reason);
  throw new Error(reason);
};

/** The launch env snapshot (--env KEY=VALUE on the CLI) — the mock endpoint
 * facts ride the same channel upstream process.env would. */
const launchEnv = () => {
  const raw = globalThis.__dshLaunchEnv?.();
  demand(typeof raw === 'string', 'launch env snapshot missing (CLI must pass --env)');
  const env = JSON.parse(raw);
  log.debug('launch env', { keys: Object.keys(env) });
  return env;
};

/** Minimal deterministic fields per upstream session-log record type
 * (record payloads live under `data`): the upstream-session projector plus
 * the compaction vocabulary. */
const SESSION_EVENT_FIELDS = {
  'turn/start': (data) => ({ turn: data.turn }),
  'step/start': (data) => ({ turn: data.turn, step: data.step }),
  'step/end': (data) => ({ turn: data.turn, step: data.step }),
  'system/message': (data, seq) => ({ seq, plugin: data.message?.source?.plugin }),
  'user/message': (data, seq) => ({
    seq,
    source: data.source?.kind,
    plugin: data.source?.plugin ?? null,
  }),
  'assistant/message': (data, seq) => ({
    seq,
    blocks: data.message?.content?.map((block) => block.type),
    text: data.message?.content?.filter((b) => b.type === 'text').map((b) => b.text).join(''),
    provider: data.message?.source?.provider,
    model: data.message?.source?.model,
  }),
  'compaction/start': (data, seq) => ({ seq, compactionId: data.compactionId, turn: data.turn }),
  'compaction/summary': (data, seq) => ({
    seq,
    compactionId: data.compactionId,
    summaryText: data.summary?.filter((b) => b.type === 'text').map((b) => b.text).join('') ?? '',
    shadowedRange: data.shadowedRange,
    shadowedSeqs: data.shadowedSeqs?.length ?? 0,
    shadowedTokenCount: data.shadowedTokenCount,
    provider: data.provider,
    model: data.model,
  }),
  'compaction/end': (data, seq) => ({ seq, compactionId: data.compactionId, turn: data.turn, errored: data.error !== undefined }),
};
const fallbackFields = (data, seq) => ({ seq });
const sessionEventFields = (record) =>
  (SESSION_EVENT_FIELDS[record.type] ?? fallbackFields)(record.data ?? {}, record.seq);

/** Boot + capture boot-time lifecycle flags (the log lines themselves are
 * emitted post-turn in a fixed order so the expected log is stable). */
const bootPhase = async (captures, env) => {
  log.debug('boot phase begin', {});
  const resolved = await fsScope.resolve('scope://app/');
  const root = resolved?.path;
  demand(typeof root === 'string' && root.startsWith('/'), `profile container not resolved: ${JSON.stringify(resolved)}`);
  const { ctx } = await bootUpstream({
    scenario: SCENARIO,
    agentId: AGENT_ID,
    sessionId: SESSION_ID,
    cwd: root, // absolute POSIX: the profile container root (upstream validates)
    onEvent: emit,
    compaction: { config: ENGINE_CONFIG },
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
      contextWindow: CONTEXT_WINDOW,
      onWire: (info) => { captures.wires.push(info); },
      onSse: (info) => { captures.sse.push(info); },
    },
    listeners: {
      'agent/created': (id) => { captures.agentCreated = typeof id === 'string' ? id : AGENT_ID; },
      'agent/status': (status) => { captures.agentStatuses.push(typeof status === 'string' ? status : status?.status); },
      'agent/error': (info) => { captures.agentStatuses.push(`error:${JSON.stringify(info)?.slice(0, 200)}`); },
    },
  });
  captures.compactionMounted = ctx.get('compaction') !== undefined;
  captures.meterMounted = ctx.get('tokenMeter') !== undefined;
  log.debug('boot phase done', {});
  return ctx;
};

/** Wait (bounded, fail loud) for the configured agent. */
const awaitAgent = async (ctx) => {
  log.debug('await agent begin', { sessionId: SESSION_ID });
  let guard = 0;
  while ((ctx.agents.get(SESSION_ID) === undefined || ctx.sessions.get(SESSION_ID) === undefined)
    && guard++ < 10000) {
    await Promise.resolve();
  }
  demand(ctx.agents.get(SESSION_ID) !== undefined, `agent "${SESSION_ID}" never appeared in the registry`);
  demand(ctx.sessions.get(SESSION_ID) !== undefined, `session "${SESSION_ID}" never appeared in the store`);
  return ctx.agents.get(SESSION_ID);
};

/** Drive one user turn through the agent loop and wait for idle. */
const driveTurn = async (agent, text) => {
  log.debug('drive turn begin', { chars: text.length });
  agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }));
  await agent.whenIdle();
};

/** Walk the authoritative session log; emit every record in order for the
 * checker's one-to-one match. */
const emitSessionLog = (session) => {
  log.debug('emit session log begin', {});
  const events = session.snapshotEvents();
  for (const record of events) {
    emit(record.type, sessionEventFields(record));
  }
  const types = events.map((record) => record.type);
  emit('session/log/asserted', { count: types.length, types });
  return events;
};

/** Assert the compaction record set: exactly one start/summary/end trio for
 * turn 2, the summary riding the conversation route over the turn-1 span, and
 * the framed checkpoint replacing it. Returns the assertion evidence. */
const assertCompactionRecords = (events) => {
  log.debug('assert compaction records begin', { count: events.length });
  const starts = events.filter((record) => record.type === 'compaction/start');
  const summaries = events.filter((record) => record.type === 'compaction/summary');
  const ends = events.filter((record) => record.type === 'compaction/end');
  demand(starts.length === 1, `expected exactly one compaction/start, got ${starts.length}`);
  demand(summaries.length === 1, `expected exactly one compaction/summary, got ${summaries.length}`);
  demand(ends.length === 1, `expected exactly one compaction/end, got ${ends.length}`);
  demand(starts[0].data.turn === 2, `compaction/start fired in turn ${starts[0].data.turn}, expected 2`);
  demand(ends[0].data.error === undefined, 'compaction/end recorded an error');
  const summary = summaries[0].data;
  const summaryText = summary.summary?.filter((b) => b.type === 'text').map((b) => b.text).join('') ?? '';
  demand(summaryText === EXPECTED_TEXT, `summary text is "${summaryText}"`);
  demand(summary.provider === 'mock' && summary.model === 'mock-1', 'summary did not ride the conversation route');
  const startSeq = starts[0].seq;
  demand(summary.shadowedRange.start < startSeq && summary.shadowedRange.end < startSeq, 'shadowed range is not before the compaction');
  demand(summary.shadowedTokenCount > 0, 'shadowed token count is empty');
  const checkpoint = events.find((record) => record.type === 'user/message'
    && record.data?.source?.kind === 'plugin' && record.data?.source?.plugin === 'compact');
  demand(checkpoint !== undefined, 'no framed checkpoint user message in the session log');
  demand(checkpoint.seq > summaries[0].seq, 'checkpoint did not land after its summary record');
  return { compactionId: starts[0].data.compactionId, shadowedRange: summary.shadowedRange, shadowedTokenCount: summary.shadowedTokenCount, checkpointSeq: checkpoint.seq };
};

/** Assert both turns answered with the mock's text (turn 2 post-compaction). */
const assertTurnTexts = (events) => {
  log.debug('assert turn texts begin', {});
  const assistant = events.filter((record) => record.type === 'assistant/message');
  demand(assistant.length === 2, `expected two assistant turns, got ${assistant.length}`);
  for (const record of assistant) {
    const text = record.data?.message?.content?.filter((b) => b.type === 'text').map((b) => b.text).join('') ?? '';
    demand(text === EXPECTED_TEXT, `assistant text is "${text}"`);
  }
};

/** Assert the pressure actually fell below the threshold (compaction freed
 * the context) and that the gate row mounted. */
const assertPressureFreed = (ctx, session, captures) => {
  log.debug('assert pressure freed begin', { compactionMounted: captures.compactionMounted, meterMounted: captures.meterMounted });
  demand(captures.compactionMounted === true, 'the compaction service did not mount (boot row off?)');
  demand(captures.meterMounted === true, 'the token meter did not mount (boot row off?)');
  const measurement = ctx.tokenMeter.measure(session);
  const thresholdTokens = Math.floor(CONTEXT_WINDOW * ENGINE_CONFIG.thresholdRatio);
  demand(measurement.totalTokens < thresholdTokens,
    `post-compaction pressure ${measurement.totalTokens} is not below the threshold ${thresholdTokens}`);
  emit('compaction/pressure/asserted', {
    totalTokens: measurement.totalTokens,
    thresholdTokens,
    contextWindow: CONTEXT_WINDOW,
    surfaceNodes: session.surface.nodes.length,
  });
  const turnBoundary = ctx.sessionProjections.stateOf(session, 'turnBoundary');
  demand(turnBoundary !== undefined, 'turnBoundary projection missing');
  demand(turnBoundary.lastTurn === 2, `turnBoundary.lastTurn is ${turnBoundary.lastTurn}`);
  emit('projection/turn-boundary', { lastTurn: turnBoundary.lastTurn });
};

const main = async () => {
  log.debug('main begin', {});
  const env = launchEnv();
  demand(typeof env.DSH_MOCK_LLM_URL === 'string' && env.DSH_MOCK_LLM_URL.startsWith('http://127.0.0.1:'),
    `mock LLM endpoint missing from the launch env: ${JSON.stringify(env.DSH_MOCK_LLM_URL)}`);
  const captures = { agentCreated: null, agentStatuses: [], wires: [], sse: [], compactionMounted: false, meterMounted: false };
  const ctx = await bootPhase(captures, env);

  emit('session/created', { sessionId: SESSION_ID });
  emit('agent/created', { id: captures.agentCreated ?? AGENT_ID, sessionId: SESSION_ID });

  const agent = await awaitAgent(ctx);
  await driveTurn(agent, TURN_ONE_TEXT);
  // The pre-compaction pressure reading (the same meter the engine's
  // auto trigger reads between turn 2's turn/start and its first step).
  const session1 = ctx.sessions.get(SESSION_ID);
  emit('compaction/pressure/before', { totalTokens: ctx.tokenMeter.measure(session1).totalTokens });
  await driveTurn(agent, TURN_TWO_TEXT);

  const session = ctx.sessions.get(SESSION_ID);
  const events = emitSessionLog(session);
  const evidence = assertCompactionRecords(events);
  assertTurnTexts(events);
  emit('compaction/records/asserted', evidence);
  assertPressureFreed(ctx, session, captures);

  for (const status of captures.agentStatuses) {
    emit('agent/status', { status: typeof status === 'string' ? status : String(status) });
  }
  emit('upstream/completed', {
    status: 'pass',
    upstream: '0.1.6-alpha.2',
    compaction: 'vendored dsh-compaction-basic over the host-plane dsh-token-meter (gated boot row)',
  });
  globalThis.__dshComplete(true, 'pass');
};

main().catch(fail);
