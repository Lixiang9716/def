/**
 * LLM chaos scenario `llm.chaos.<profile>` — the transport-guard legs over a
 * HOSTILE mock wire (test-hardening row 1, doc/test-coverage.md). One real
 * upstream agent-loop turn (the same vendored spine as upstream.session) is
 * driven against ci/mock-llm-server.mjs with DSH_MOCK_CHAOS=<profile>, and
 * the guard layer's DESIGNED reaction is asserted — the profiles only arm
 * vendored mock behaviors, never touch the transport:
 *
 *   no-headers     the wire dies before any response head (connection_reset):
 *                  a FAST TRANSPORT failure → the retry-pacing seam paces the
 *                  first retry at 15000ms (the llm/retry journal pins
 *                  delayMs), and the TURN-LEVEL backstop (turn-watchdog,
 *                  scenario-armed at its module contract with a 1.5s budget —
 *                  the boot-mounted ring 2 keeps its production 300s default)
 *                  must cancel the wedged turn BEFORE the paced retry ever
 *                  executes (wire request count stays 1, no llm/retry-started)
 *   truncation     the stream closes cleanly WITHOUT [DONE] (stream_eof) →
 *                  the parser's STREAM_CLOSED, non-retryable: the turn errors
 *                  honestly and NO retry is scheduled
 *   malformed-sse  a non-JSON `data:` payload (malformed_json) →
 *                  MALFORMED_RESPONSE, non-retryable, honest turn error
 *   oversized      ONE 2 MiB SSE delta (a `success` script with a 2 MiB
 *                  single-delta text) → the byte bridge and parser carry it
 *                  and the turn completes with the full text (length-pinned)
 *
 * (slow-drip — the read-idle TIMEOUT leg — runs node-side in
 * ci/llm-chaos-read-idle.mjs: the CLI smoke backend drains the response body
 * synchronously inside the httpFetch call, so a mid-body stall can never
 * interleave with the guard's timer on this host; see the runner.)
 *
 * Expected events are pinned one-to-one per profile in
 * test/e2e/scenarios/llm-chaos-<profile>.json.
 */
import { createLogger } from 'logger.js';
import { fsScope } from 'gateway.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { bootUpstream } from 'upstream/boot.js';
import { isSemanticStreamFrame, makeTurnWatchdog } from 'upstream/turn-watchdog.js';

const AGENT_ID = 'main';
const SESSION_ID = 's-llm-chaos-0001';
const INPUT_TEXT = 'Say hello';
// The oversized profile's scripted text length must match ci/mock-llm-server.mjs.
const OVERSIZED_LENGTH = 2 * 1024 * 1024;

const CLI_PROFILES = new Set(['no-headers', 'truncation', 'malformed-sse', 'oversized']);

// The scenario id and the witness budget resolve from the launch env (the
// quickjs runtime has no ambient process): set at main() start, before any
// emission; until then the id names the failure honestly.
let scenario = 'llm.chaos';
let witnessBudgetMs = 1500;
let profile = '(unset)';

const log = createLogger('dsh.scenario');
const emit = (event, fields = {}) => log.info('e2e', { scenario, event, ...fields });
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

/** The launch env snapshot (--env KEY=VALUE on the CLI) — the profile, the
 * mock endpoint facts, and the witness budget all ride the same channel. */
const launchEnv = () => {
  const raw = globalThis.__dshLaunchEnv?.();
  demand(typeof raw === 'string', 'launch env snapshot missing (CLI must pass --env)');
  const env = JSON.parse(raw);
  log.debug('launch env', { keys: Object.keys(env) });
  return env;
};

/** Deterministic fields per session-log record type; anything that can carry
 * hostile-sized or port-dependent text stays out (codes, counts, lengths). */
const SESSION_EVENT_FIELDS = {
  'turn/start': (data) => ({ turn: data.turn }),
  'step/start': (data) => ({ turn: data.turn, step: data.step }),
  'step/end': (data) => ({ turn: data.turn, step: data.step }),
  'system/message': (data, seq) => ({ seq, plugin: data.message?.source?.plugin }),
  'user/message': (data, seq) => ({ seq, source: data.message?.source?.kind }),
  'request/header': (data, seq) => ({ seq, reason: data.reason }),
  'request/context': (data, seq) => ({ seq, provider: data.provider, model: data.model }),
  'assistant/attempt': (data, seq) => ({ seq, turn: data.turn, step: data.step }),
  'llm/retry': (data, seq) => ({
    seq,
    retry: data.retry,
    maxRetries: data.maxRetries,
    delayMs: data.delayMs, // loop-c2: the seam's pace, adopted verbatim (15000 for strike 0)
    code: data.failure?.code,
    provider: data.provider,
  }),
  'assistant/message': (data, seq) => {
    const text = data.message?.content?.filter((b) => b.type === 'text').map((b) => b.text).join('') ?? '';
    const sized = text.length > 64;
    return {
      seq,
      blocks: data.message?.content?.map((block) => block.type),
      // oversized deltas: pin the LENGTH, never the text itself
      ...(sized ? { textLength: text.length, textHead: text.slice(0, 8) } : { text }),
      provider: data.message?.source?.provider,
      model: data.message?.source?.model,
    };
  },
  'turn/end': (data) => ({
    turn: data.turn,
    reason: data.reason?.kind ?? null,
    // an error turn carries the provider-neutral code; an aborted one the
    // cancel cause (the turn-watchdog's `{kind:'watchdog'}`)
    errorCode: data.reason?.error?.code ?? null,
    cancelKind: data.reason?.reason?.kind ?? null,
  }),
};
const fallbackFields = (data, seq) => ({ seq });
const sessionEventFields = (record) =>
  (SESSION_EVENT_FIELDS[record.type] ?? fallbackFields)(record.data ?? {}, record.seq);

/** SSE evidence, oversized-safe: a hostile-sized delta pins length+head. */
const sseEvent = (info) => {
  log.debug('sse evidence shape', { keys: Object.keys(info) });
  if (typeof info.delta === 'string' && info.delta.length > 64) {
    return { deltaLength: info.delta.length, deltaHead: info.delta.slice(0, 8) };
  }
  return info;
};

const bootPhase = async (captures, env) => {
  log.debug('boot phase begin', {});
  const resolved = await fsScope.resolve('scope://app/');
  const root = resolved?.path;
  demand(typeof root === 'string' && root.startsWith('/'), `profile container not resolved: ${JSON.stringify(resolved)}`);
  const { ctx } = await bootUpstream({
    scenario,
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
      onWire: (info) => {
        captures.wire.push(info);
        emit('llm/request/built', { ...info, attempt: captures.wire.length });
      },
      onSse: (info) => { captures.sse.push(sseEvent(info)); emit('llm/sse', sseEvent(info)); },
    },
    listeners: {
      'agent/status': (status) => { captures.agentStatuses.push(typeof status === 'string' ? status : status?.status); },
    },
  });
  log.debug('boot phase done', {});
  return ctx;
};

/** The turn-level backstop, armed at the turn-watchdog module's own contract
 * (the same progress feeds its apply() subscribes) with a CI-scale budget.
 * This is the REAL guard module over the real hostile wire — the boot-mounted
 * ring 2 keeps its production 300s default untouched. */
const armWatchdogWitness = (ctx, captures) => {
  log.debug('arming the turn-watchdog witness', { budgetMs: witnessBudgetMs });
  const watchdog = makeTurnWatchdog({
    budgetMs: witnessBudgetMs,
    listRunning: () => ctx.agents.list(),
    onCancel: (agent) => {
      captures.watchdogFired = true;
      emit('chaos/watchdog/fired', { budgetMs: witnessBudgetMs, agent: agent?.id ?? '(unknown)' });
    },
  });
  const feeds = [
    ['session/event', () => true],
    ['agent/status', () => true],
    ['agent/assistant-stream', isSemanticStreamFrame],
  ];
  for (const [event, semantic] of feeds) {
    ctx.on(event, (payload) => {
      if (!semantic(payload)) return;
      watchdog.markProgress();
    });
  }
  return watchdog;
};

const turnPhase = async (ctx) => {
  log.debug('turn phase begin', {});
  let guard = 0;
  while ((ctx.agents.get(SESSION_ID) === undefined || ctx.sessions.get(SESSION_ID) === undefined)
    && guard++ < 10000) {
    await Promise.resolve();
  }
  demand(ctx.agents.get(SESSION_ID) !== undefined, `agent "${SESSION_ID}" never appeared in the registry`);
  demand(ctx.sessions.get(SESSION_ID) !== undefined, `session "${SESSION_ID}" never appeared in the store`);

  const agent = ctx.agents.get(SESSION_ID);
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: INPUT_TEXT }],
    source: { kind: 'user' },
  }));
  await agent.whenIdle();
  log.debug('turn phase done', {});
  return ctx.sessions.get(SESSION_ID);
};

/** The per-profile guard assertions — each leg's DESIGNED reaction, one
 * branch per profile (kept its own function at the size gate). */
const assertProfileGuards = (reason, retries, retryStarted, assistant, text, captures) => {
  log.debug('asserting the profile guards', { profile, retries: retries.length });
  if (profile === 'no-headers') {
    // Guard 1 (retry pacing): the fast TRANSPORT failure is paced — the first
    // retry rides the seam's 15s slot, adopted verbatim into the journal.
    demand(retries.length === 1, `expected exactly one llm/retry, got ${retries.length}`);
    const retry = retries[0].data ?? {};
    demand(retry.retry === 1, `llm/retry ordinal is ${retry.retry}`);
    demand(retry.maxRetries === 5, `llm/retry maxRetries is ${retry.maxRetries}`);
    demand(retry.delayMs === 15000, `llm/retry delayMs is ${retry.delayMs} (want the seam's 15000 pace)`);
    demand(retry.failure?.code === 'TRANSPORT', `llm/retry code is ${retry.failure?.code}`);
    // Guard 2 (turn-level backstop): the witness cancelled the wedged turn
    // BEFORE the paced wait expired — no second request, no retry started.
    demand(retryStarted === false, 'llm/retry-started landed — the backstop did not cut the paced wait');
    demand(reason.kind === 'aborted', `turn/end reason is ${reason.kind} (want aborted)`);
    demand(reason.reason?.kind === 'watchdog', `cancel cause is ${reason.reason?.kind} (want watchdog)`);
    demand(captures.watchdogFired === true, 'the turn-watchdog witness never fired');
    demand(assistant === undefined, 'an assistant message landed on a watchdog-cancelled turn');
    emit('chaos/pacing/asserted', { delayMs: 15000, code: 'TRANSPORT', retry: 1, maxRetries: 5 });
    emit('chaos/watchdog/asserted', { budgetMs: witnessBudgetMs, cancelKind: reason.reason?.kind, wireRequests: captures.wire.length });
  } else if (profile === 'truncation') {
    // The parser's close contract: a stream that ends without [DONE] is
    // STREAM_CLOSED, non-retryable — one wire request, honest turn error.
    demand(reason.kind === 'error', `turn/end reason is ${reason.kind} (want error)`);
    demand(reason.error?.code === 'STREAM_CLOSED', `turn error code is ${reason.error?.code} (want STREAM_CLOSED)`);
    demand(retries.length === 0, `STREAM_CLOSED scheduled ${retries.length} retries (non-retryable)`);
    demand(captures.wire.length === 1, `wire requests: ${captures.wire.length} (want 1)`);
    demand(assistant === undefined, 'an assistant message landed on a truncated stream');
    emit('chaos/truncation/asserted', { code: 'STREAM_CLOSED', retried: false, wireRequests: captures.wire.length });
  } else if (profile === 'malformed-sse') {
    demand(reason.kind === 'error', `turn/end reason is ${reason.kind} (want error)`);
    demand(reason.error?.code === 'MALFORMED_RESPONSE', `turn error code is ${reason.error?.code} (want MALFORMED_RESPONSE)`);
    demand(retries.length === 0, `MALFORMED_RESPONSE scheduled ${retries.length} retries (non-retryable)`);
    demand(captures.wire.length === 1, `wire requests: ${captures.wire.length} (want 1)`);
    demand(assistant === undefined, 'an assistant message landed on a malformed stream');
    emit('chaos/malformed/asserted', { code: 'MALFORMED_RESPONSE', retried: false, wireRequests: captures.wire.length });
  } else if (profile === 'oversized') {
    demand(reason.kind === 'completed', `turn/end reason is ${reason.kind} (want completed)`);
    demand(text.length === OVERSIZED_LENGTH, `assistant text is ${text.length} chars (want the scripted ${OVERSIZED_LENGTH})`);
    demand(captures.wire.length === 1, `wire requests: ${captures.wire.length} (want 1)`);
    emit('chaos/oversized/asserted', { textLength: text.length, wireRequests: captures.wire.length });
  }
};

/** The journal walk + the per-profile guard assertions. */
const assertPhase = (ctx, session, captures) => {
  log.debug('assert phase begin', {});
  const events = session.snapshotEvents();
  for (const record of events) {
    emit(record.type, sessionEventFields(record));
  }
  const types = events.map((record) => record.type);
  emit('session/log/asserted', { count: types.length, types });

  const turnEnd = events.find((record) => record.type === 'turn/end');
  demand(turnEnd !== undefined, 'no turn/end in the session log');
  const reason = turnEnd.data?.reason ?? {};
  const retries = events.filter((record) => record.type === 'llm/retry');
  const retryStarted = events.some((record) => record.type === 'llm/retry-started');
  const assistant = events.find((record) => record.type === 'assistant/message');
  const text = assistant?.data?.message?.content
    ?.filter((block) => block.type === 'text').map((block) => block.text).join('') ?? '';

  assertProfileGuards(reason, retries, retryStarted, assistant, text, captures);

  for (const status of captures.agentStatuses) {
    emit('agent/status', { status: typeof status === 'string' ? status : String(status) });
  }

  const turnBoundary = ctx.sessionProjections.stateOf(session, 'turnBoundary');
  demand(turnBoundary !== undefined, 'turnBoundary projection missing');
  emit('projection/turn-boundary', { lastTurn: turnBoundary.lastTurn });
};

const main = async () => {
  log.debug('main begin', {});
  const env = launchEnv();
  profile = env.DSH_CHAOS_PROFILE ?? '';
  if (!CLI_PROFILES.has(profile)) {
    // fail loud before any boot: the CLI legs carry exactly these four profiles
    fail(`unknown DSH_CHAOS_PROFILE ${JSON.stringify(profile)} (want one of ${[...CLI_PROFILES].join('|')})`);
    return;
  }
  scenario = `llm.chaos.${profile}`;
  // The witness budget: shorter than the seam's first pace slot (15000ms), so
  // the backstop provably fires INSIDE the paced wait.
  witnessBudgetMs = Number(env.DSH_CHAOS_WATCHDOG_MS ?? 1500);
  demand(typeof env.DSH_MOCK_LLM_URL === 'string' && env.DSH_MOCK_LLM_URL.startsWith('http://127.0.0.1:'),
    `mock LLM endpoint missing from the launch env: ${JSON.stringify(env.DSH_MOCK_LLM_URL)}`);
  const captures = { agentStatuses: [], wire: [], sse: [], watchdogFired: false };
  const ctx = await bootPhase(captures, env);

  emit('session/created', { sessionId: SESSION_ID });
  emit('agent/created', { id: AGENT_ID, sessionId: SESSION_ID });
  emit('chaos/profile', {
    profile,
    source: 'ci/mock-llm-server.mjs DSH_MOCK_CHAOS preset (vendored dsh-llm-mock-server behaviors)',
  });

  const watchdog = armWatchdogWitness(ctx, captures);
  const session = await turnPhase(ctx);
  watchdog.dispose();
  assertPhase(ctx, session, captures);

  emit('chaos/completed', {
    status: 'pass',
    profile,
    guards: {
      'no-headers': 'retry pacing (15000 pace adopted) + turn-watchdog backstop',
      'truncation': 'parser close contract (STREAM_CLOSED, non-retryable)',
      'malformed-sse': 'parser payload contract (MALFORMED_RESPONSE, non-retryable)',
      'oversized': 'byte-bridge survival (2 MiB single delta completes)',
    }[profile],
    upstream: '0.1.6-alpha.2',
  });
  globalThis.__dshComplete(true, 'pass');
};

main().catch(fail);
