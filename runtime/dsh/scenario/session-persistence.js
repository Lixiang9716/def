// dsh:logging-exempt (spine-boot module, the upstream-session template's
// class: the demand/take helpers never log — the mounted logger carries every
// canonical line the probes emit)
/**
 * session-persistence.js — the resume leg's CLI proof (`session.persistence`):
 * the vendored @deepseek-ai/dsh-session-persistence-jsonl backend mounted by
 * the GATED boot row (options.sessionPersistence — default off, so every
 * ungated leg boots byte-identically), with ONE REAL agent-loop turn per
 * dsh-cli PROCESS and the SAME pinned profile container (DSH_SPIKE_TMPDIR):
 *
 *   leg "create" (process 1): the backend mounts under `sessionPersistence`
 *   (service key fixed by the vendored SessionPersistence base), the loop's
 *   config-driven start CREATES the configured session, the turn appends the
 *   journal (each append resolves durably — the artifact reaches the
 *   container disk under <cwd>/dsh/sessions), and the scenario asserts the
 *   stored state through the backend's own stat face.
 *
 *   leg "resume" (process 2, same container): the same boot config finds the
 *   stored artifact and the loop's restoreOrCreateConfigured path RESUMES it
 *   (the SessionPersistenceNotFoundError fall-through to create never fires)
 *   — the restored seed carries process 1's turn (turn 1 + its assistant
 *   message), the second mock turn CONTINUES the journal (turn 2; the
 *   turnBoundary projection crosses the restart), and no "cannot resume"
 *   error ever surfaces.
 *
 * The scenario's demand() chain is the assertion set; the runner
 * (ci/run-session-persistence-e2e.sh) verifies the REAL-disk artifact
 * between the processes, refuses any "cannot resume" line, and records the
 * proof in its receipt.json (the CI manifest wiring for this leg is the
 * coordinator's follow-up — the leg runs via the runner, not yet in the
 * gate DAG). The node:fs shims' write-through mirror is the durability
 * contract this scenario proves end to end.
 */
import { createLogger } from 'logger.js';
import { fsScope } from 'gateway.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { bootUpstream } from 'upstream/boot.js';

const SCENARIO = 'session.persistence';
const AGENT_ID = 'main';
const SESSION_ID = 's-persist-0001';
const EXPECTED_TEXT = 'Hello from upstream'; // the mock server's successText (ci/mock-llm-server.mjs)
const TURN_TEXT = { create: 'Say hello', resume: 'Say hello again' };

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
  const env = JSON.parse(raw);
  log.debug('launch env', { keys: Object.keys(env) });
  return env;
};

/** Boot the gated profile (the upstream-session shape + the persistence row:
 * default root <cwd>/dsh/sessions inside the pinned container, upstream's
 * default compression). Returns { ctx, statuses }. */
const bootPhase = async (env) => {
  log.debug('boot phase begin', {});
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
      kind: 'mock',
      model: 'mock-1',
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

/** One REAL turn through the loop; resolves when idle. */
const runTurn = async (agent, text) => {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }));
  await agent.whenIdle();
};

/** The assistant messages' text (the mock's successText is the marker). */
const assistantTexts = (session) => session.snapshotEvents()
  .filter((record) => record.type === 'assistant/message')
  .map((record) => (record.data?.message?.content ?? [])
    .filter((block) => block.type === 'text').map((block) => block.text).join(''));

/** Leg "create": boot → assert the backend → one mock turn → the stored
 * state is queryable through the backend's stat face (durable per append). */
const createLeg = async (ctx) => {
  log.debug('create leg begin', {});
  const { agent, session, backend } = await waitConfigured(ctx);
  demand(session.snapshotEvents().length === 0, 'a fresh configured session carried events at boot');
  emit('persistence/created', { sessionId: SESSION_ID, phase: 'boot' });

  await runTurn(agent, TURN_TEXT.create);
  const texts = assistantTexts(session);
  demand(texts.includes(EXPECTED_TEXT), `assistant text is ${JSON.stringify(texts)}`);
  // Routed live events batch into the handle on a deadline; the process is
  // about to exit, so force materialization through the backend's own
  // flush face (the SessionHandle.flush contract, all handles at once).
  await backend.flush();
  const stored = await backend.stat(SESSION_ID);
  demand(stored !== undefined, 'backend.stat found no stored session after the turn');
  demand(Number(stored.sizeBytes) > 0, `stored artifact is empty (${stored.sizeBytes} bytes)`);
  emit('persistence/artifact', { sessionId: SESSION_ID, sizeBytes: Number(stored.sizeBytes), events: session.snapshotEvents().length });
  emit('persistence/summary', { leg: 'create', pass: true, events: session.snapshotEvents().length });
  return session;
};

/** Leg "resume": the SAME boot config on the SAME container — the stored
 * artifact seeds the session BEFORE any turn, the second turn continues the
 * journal, and the turnBoundary projection crosses the restart. */
const resumeLeg = async (ctx) => {
  log.debug('resume leg begin', {});
  const { agent, session } = await waitConfigured(ctx);
  const restored = session.snapshotEvents();
  demand(restored.length > 0, 'the resumed session carried no seed — resume did not happen');
  demand(restored.some((record) => record.type === 'turn/start'), 'the restored seed carries no turn boundary');
  demand(assistantTexts({ snapshotEvents: () => restored }).includes(EXPECTED_TEXT),
    "the restored seed lost process 1's assistant message");
  emit('persistence/restored', { sessionId: SESSION_ID, events: restored.length });

  await runTurn(agent, TURN_TEXT.resume);
  const texts = assistantTexts(session);
  demand(texts.filter((text) => text === EXPECTED_TEXT).length === 2,
    `expected both turns' assistant messages, got ${JSON.stringify(texts)}`);
  const turns = session.snapshotEvents()
    .filter((record) => record.type === 'turn/start').map((record) => record.data?.turn);
  demand(turns.includes(1) && turns.includes(2), `journal turns are ${JSON.stringify(turns)} — not continued`);
  const turnBoundary = ctx.sessionProjections.stateOf(session, 'turnBoundary');
  demand(turnBoundary !== undefined && turnBoundary.lastTurn === 2,
    `turnBoundary.lastTurn is ${turnBoundary?.lastTurn}`);
  await ctx.get('sessionPersistence').flush();
  emit('persistence/journal/continued', { restoredEvents: restored.length, totalEvents: session.snapshotEvents().length, lastTurn: turnBoundary.lastTurn });
  emit('persistence/summary', { leg: 'resume', pass: true, events: session.snapshotEvents().length });
};

const main = async () => {
  log.debug('main begin', {});
  const env = launchEnv();
  demand(typeof env.DSH_MOCK_LLM_URL === 'string' && env.DSH_MOCK_LLM_URL.startsWith('http://127.0.0.1:'),
    `mock LLM endpoint missing from the launch env: ${JSON.stringify(env.DSH_MOCK_LLM_URL)}`);
  const leg = env.DSH_SESSIONS_LEG;
  demand(leg === 'create' || leg === 'resume', `DSH_SESSIONS_LEG must be create|resume, got ${JSON.stringify(leg)}`);
  const { ctx, statuses } = await bootPhase(env);
  if (leg === 'create') await createLeg(ctx);
  else await resumeLeg(ctx);
  const errors = statuses.filter((status) => String(status).startsWith('error:'));
  demand(errors.length === 0, `agent errors surfaced: ${errors.join(' | ')}`);
  for (const status of statuses) emit('agent/status', { status: String(status) });
  emit('upstream/completed', { status: 'pass', leg, backend: 'vendored session-persistence-jsonl' });
  globalThis.__dshComplete(true, `session.persistence ${leg} leg: pass`);
};

main().catch(fail);
