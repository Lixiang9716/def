// dsh:logging-exempt (spine-boot module, the session-persistence template's
// class: the demand/take helpers never log — the mounted logger carries
// every canonical line the probes emit)
/**
 * resource-starvation.js — test-hardening row 16: the RESOURCE-STARVATION
 * leg (`resource.starvation`), two faces under one scenario id, selected by
 * DSH_STARVATION_LEG:
 *
 *   leg "journal" — the DISK-FULL face, three dsh-cli processes over ONE
 *     pinned container on a TINY volume the runner owns (hdiutil mount):
 *       pre     — gated persistence mounts, one mock turn journals, the
 *                 backend's stat face proves the durable state (append is
 *                 durable per write in the jsonl backend);
 *       full    — the volume is now FULL: the boot restore still READS,
 *                 the second mock turn completes (the LLM wire does not
 *                 touch the journal), and the journal write failure must
 *                 be NAMED somewhere — the flushed-error signal, or the
 *                 agent/error listener, or the stat face — never silence;
 *       recover — space freed: the restore shows EXACTLY the durable
 *                 prefix (turn 2's records, whose durability failed, are
 *                 not in the journal — durability honesty), the third turn
 *                 flushes clean, stat proves the new durable state.
 *     The runner cross-checks the restored counts between the legs and
 *     asserts the on-disk journal stays line-complete (no partial record).
 *
 *   leg "heap" — the LOW-MEMORY face through the host's DSH_HEAP_LIMIT_MB
 *     knob (test infrastructure, process env, like the stack knob): an
 *     allocation loop outgrows the cap and quickjs must turn it into a
 *     CATCHABLE, named exception — a process kill is the failure this leg
 *     exists to rule out — and the host still answers a small operation
 *     afterwards.
 */
import { createLogger } from 'logger.js';
import { fsScope } from 'gateway.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { bootUpstream } from 'upstream/boot.js';

const SCENARIO = 'resource.starvation';
const AGENT_ID = 'main';
const SESSION_ID = 's-starve-0001';
const EXPECTED_TEXT = 'Hello from upstream'; // the mock server's successText

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

const launchEnv = () => {
  const raw = globalThis.__dshLaunchEnv?.();
  demand(typeof raw === 'string', 'launch env snapshot missing (CLI must pass --env)');
  return JSON.parse(raw);
};

/** Boot the gated profile with the persistence row (the journal legs). */
const bootJournal = async (env) => {
  const resolved = await fsScope.resolve('scope://app/');
  const root = resolved?.path;
  demand(typeof root === 'string' && root.startsWith('/'),
    `profile container not resolved: ${JSON.stringify(resolved)}`);
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
    // compression 'none' on purpose: the disk-full face's line-completeness
    // gate reads the journal bytes directly — the zstd default would make
    // that read a compression question, not a journal-integrity question.
    // diskTotalBytes arms the watermark guard with the seat-owned volume's
    // real capacity (the runner creates the ramdisk and knows its size).
    sessionPersistence: {
      compression: 'none',
      // DSH_REALFS=1 arms the gated real-fs journal publisher (the #571
      // root cure): each turn/end republishes the journal through
      // fsPublishAtomic, so a full volume rejects with a NAMED error at the
      // true write boundary instead of the mirror's swallowed ENOSPC.
      ...(env.DSH_REALFS === '1' ? { realFs: true } : {}),
      ...(env.DSH_DISK_TOTAL_BYTES ? { diskTotalBytes: Number(env.DSH_DISK_TOTAL_BYTES) } : {}),
    },
    listeners: {
      'agent/error': (info) => statuses.push(`error:${JSON.stringify(info)?.slice(0, 200)}`),
      'agent/status': (status) => statuses.push(typeof status === 'string' ? status : status?.status),
    },
  });
  return { ctx, statuses };
};

const waitConfigured = async (ctx) => {
  let guard = 0;
  while ((ctx.agents.get(SESSION_ID) === undefined || ctx.sessions.get(SESSION_ID) === undefined)
    && guard++ < 10000) {
    await Promise.resolve();
  }
  demand(ctx.agents.get(SESSION_ID) !== undefined, 'the agent never appeared in the registry');
  demand(ctx.sessions.get(SESSION_ID) !== undefined, 'the session never appeared in the store');
  const backend = ctx.get('sessionPersistence');
  demand(backend !== undefined, 'sessionPersistence service missing — the gated row did not mount');
  return { agent: ctx.agents.get(SESSION_ID), session: ctx.sessions.get(SESSION_ID), backend };
};

const runTurn = async (agent, text) => {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }));
  await agent.whenIdle();
};

const eventCount = (session) => session.snapshotEvents().length;

const assistantTexts = (session) => session.snapshotEvents()
  .filter((record) => record.type === 'assistant/message')
  .map((record) => (record.data?.message?.content ?? [])
    .filter((block) => block.type === 'text').map((block) => block.text).join(''));

/** The journal's byte size read from DISK: <profileCwd>/dsh/sessions/
 * <encoded-cwd>/<session>/session.v3.jsonl. The REAL journal only — the
 * atomic-write temp files come and go during failed flushes and would
 * mask the freeze. */
const journalSized = async () => {
  const fsPromises = await import('node:fs/promises');
  const base = `${globalThis.__dshProfileCwd}/dsh/sessions`;
  const encoded = (await fsPromises.readdir(base))[0];
  const dir = `${base}/${encoded}/${SESSION_ID}`;
  const st = await fsPromises.stat(`${dir}/session.v3.jsonl`).catch(() => null);
  return st ? st.size : 0;
};

/** The ballast loop: real turns (4 KB ballast each — large request bodies
 * kill the CLI host's httpFetch silently at ~32 KB, a separate finding)
 * until the volume refuses a write (ENOSPC caught = the named disk-full
 * boundary) or the turn budget expires (full === null — the silent-loss
 * class; the caller pins its verdict). Growth events ride every 25th
 * turn. */
const growBallast = async (agent, backend, minBytes, journalSized, tripped) => {
  let full = null;
  let turns = 1;
  let lastBytes = 0;
  let lastChangeTurn = 0;
  while (turns < 4000 && !tripped()) {
    try {
      await runTurn(agent, `ballast turn ${turns} ${'x'.repeat(4096)}`);
      await backend.flush();
    } catch (err) {
      full = err instanceof Error ? err.message : String(err);
      emit('journal.starve.full', { turns, reason: String(full).slice(0, 160) });
      break;
    }
    turns += 1;
    if (turns % 25 === 0) {
      const bytes = await journalSized();
      if (bytes !== lastBytes) { lastBytes = bytes; lastChangeTurn = turns; }
      emit('journal.starve.growth', { turns, journalBytes: bytes });
      if (lastChangeTurn > 0 && turns - lastChangeTurn >= 75) break; // frozen: silent loss
    }
  }
  return { full, turns, durableBytes: await journalSized() };
};

/** leg "grow": the durable baseline one turn, then the journal GROWS —
 * real agent turns, 4 KB ballast each — until the sparse-image volume
 * ITSELF refuses a write (ENOSPC caught at the journal boundary, the
 * named disk-full event). No synthetic filler, no floor guessing: the
 * cap on the image is the exhaustion condition. */
const preLeg = async (env) => {
  const realFs = env.DSH_REALFS === '1';
  const { ctx, statuses } = await bootJournal(env);
  const { agent, backend } = await waitConfigured(ctx);
  demand(eventCount(ctx.sessions.get(SESSION_ID)) === 0, 'a fresh configured session carried events at boot');
  await runTurn(agent, 'Say hello');
  demand(assistantTexts(ctx.sessions.get(SESSION_ID)).includes(EXPECTED_TEXT),
    'the mock turn did not answer');
  await backend.flush();
  const minBytes = Number(env.DSH_JOURNAL_MIN_BYTES ?? 900 * 1024);
  // THE NAMED-SURFACE DEMAND (#571): the disk-full write failure must be
  // NAMED — either the backend surfaced ENOSPC through the turn (full) or
  // the boot-row surfaces raised agent/error (the sentinel's frozen-size
  // heuristic; under realFs, the publisher's rejected publish — that
  // rejection IS the cure doing its job). The old behavior — silence — is
  // the defect this face exists to rule out.
  const sentinelTripped = () => statuses.some((st) => st.startsWith('error:'));
  const { full, turns, durableBytes } =
    await growBallast(agent, backend, minBytes, journalSized, sentinelTripped);
  const namedBy = full !== null ? 'write-error'
    : (sentinelTripped() ? (realFs ? 'durable-publish' : 'sentinel') : null);
  demand(namedBy !== null,
    'the disk-full journal failure was silent: no write error and no agent/error surface');
  emit('journal.starve.named', { turns, by: namedBy });
  emit('journal.starve.verdict', {
    leg: 'grow', status: 'pass', events: eventCount(ctx.sessions.get(SESSION_ID)),
    journalBytes: durableBytes, turns, namedBy,
  });
  // The zero-agent-error demand is the UNGATED posture's honesty check: the
  // ungated cure stack names the loss without erroring the agent. Under
  // realFs the publisher's agent/error at the full-volume boundary is the
  // EXPECTED named surface, so it is not counted against the leg.
  if (!realFs) {
    demand(statuses.filter((s) => s.startsWith('error:')).length === 0,
      `the pre leg surfaced agent errors: ${statuses.join(';')}`);
  }
  globalThis.__dshComplete(true, 'ok');
};

/** leg "recover": space freed — the durable prefix restores exactly, the
 * journal accepts and flushes again. */
const recoverLeg = async (env) => {
  const { ctx, statuses } = await bootJournal(env);
  const { agent, session, backend } = await waitConfigured(ctx);
  const restored = eventCount(session);
  demand(restored > 0, 'the recovery boot restored no durable prefix');
  emit('journal.starve.restored', { leg: 'recover', count: restored });

  await runTurn(agent, 'Say hello after recovery');
  demand(assistantTexts(session).filter((t) => t === EXPECTED_TEXT).length >= 1,
    'the recovery turn did not answer');
  await backend.flush();
  const stat = await backend.stat(SESSION_ID);
  demand(stat && Number(stat.sizeBytes) > 0 && stat.header?.id === SESSION_ID,
    `the durable state is empty after the recovery flush: ${JSON.stringify(stat)}`);
  emit('journal.starve.verdict', {
    leg: 'recover', status: 'pass', events: eventCount(session),
  });
  demand(statuses.filter((s) => s.startsWith('error:')).length === 0,
    `the recover leg surfaced agent errors: ${statuses.join(';')}`);
  globalThis.__dshComplete(true, 'ok');
};

/** leg "heap": the capped heap turns runaway allocation into a catchable,
 * named exception — and the host stays alive and answerable afterwards. */
const heapLeg = async (env) => {
  const limitMb = Number(env.DSH_HEAP_LIMIT_MB ?? 0);
  demand(Number.isFinite(limitMb) && limitMb > 0,
    `DSH_HEAP_LIMIT_MB must reach the scenario through the launch env, got ${env.DSH_HEAP_LIMIT_MB}`);
  emit('heap.starve.begin', { leg: 'heap', limitMb });
  let caught = null;
  let rounds = 0;
  try {
    const ballast = [];
    while (rounds < 100000) {
      ballast.push(new Array(1024).fill('x'.repeat(1024)));
      rounds += 1;
    }
  } catch (err) {
    caught = err instanceof Error ? err.message : String(err);
  }
  demand(caught !== null,
    `the heap cap never tripped after ${rounds} allocation rounds — the knob has no teeth`);
  emit('heap.starve.oom', { caught: true, rounds, reason: String(caught).slice(0, 120) });
  // The host must still be alive and answerable: a small allocation and a
  // JSON roundtrip after the storm.
  const probe = JSON.parse(JSON.stringify({ alive: true, after: 'oom' }));
  demand(probe.alive === true, 'the host could not answer after the OOM');
  emit('heap.starve.verdict', { leg: 'heap', status: 'pass', limitMb });
  globalThis.__dshComplete(true, 'ok');
};

const main = async () => {
  demand(typeof globalThis.__dshGatewayNegotiate === 'function'
    && globalThis.__dshGatewayNegotiate('gateway@1'), 'gateway negotiation failed');
  const env = launchEnv();
  const leg = env.DSH_STARVATION_LEG;
  demand(typeof leg === 'string' && ['grow', 'recover', 'heap'].includes(leg),
    `DSH_STARVATION_LEG must be grow|recover|heap, got ${JSON.stringify(leg)}`);
  if (leg !== 'heap') emit('journal.starve.begin', { leg }); // the heap leg names its own begin
  if (leg === 'grow') return preLeg(env);
  if (leg === 'recover') return recoverLeg(env);
  return heapLeg(env);
};

await main().catch((err) => fail(`uncaught: ${err?.message ?? err}`));
