// dsh:logging-exempt (spine-boot module, the session-persistence template's
// class: the demand/take helpers never log — the mounted logger carries every
// canonical line the leg emits)
/**
 * session-multi-stress-legs.js — the MULTI-SESSION INTERLEAVED STRESS leg's
 * shared plumbing (split from scenario/session-multi-stress.js at the
 * code-size gate; the same split the api-coverage pair made). Three families:
 *
 *   - THE ATTRIBUTION FIREHOSE: one ctx 'session/event' listener over the
 *     whole runtime, the leg's live assertion surface. Every journal record
 *     arrives stamped with its owning session and must satisfy the
 *     per-session turn discipline IN THE MOMENT IT LANDS (the T-0210 class
 *     is a late frame mis-attributed at delivery time — an end-state
 *     re-derivation alone could miss a frame that landed wrong and was then
 *     overwritten by a correct one). Per session: seqs are CONTIGUOUS from 0
 *     (a gap is a record dropped on delivery — the "recorded nowhere"
 *     class), turns open/close one at a time numbered 1..K without gaps or
 *     duplicates, every turn settles exactly its answering messages with the
 *     scripted text, and the tool records land in the scripted tool
 *     session's window only. It also counts CONCURRENTLY OPEN turns — the
 *     burst's overlap is proven from the journals themselves (peak open
 *     turns == the burst size). A tripped demand must travel by FLAG: the
 *     session-store CONTAINS a listener throw (warn + continue, measured),
 *     so the leg's main flow re-demands the trip at every await barrier.
 *
 *   - THE JOURNAL/PROJECTION/DURABILITY RE-DERIVATION: the end-state twin
 *     of the firehose over snapshotEvents() — turn numbering, the
 *     answering-message account, the tool fingerprint (one linked
 *     call+result pair, in the scripted session's scripted turn, citing its
 *     call seq), per-session turnBoundary.lastTurn, and the per-session
 *     stored artifacts (backend.stat non-empty; backend.list covers exactly
 *     the stress sessions).
 *
 *   - THE LEG PLUMBING: the launch-env snapshot, registry waits, the spine
 *     factory create (agents.create with the boot route — the same path the
 *     write surface uses), turn starts, and the WALL-CLOCK journal waits
 *     (a microtask spin dies before the first byte of a paced stream moves
 *     — measured).
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import {
  EXPECTED_TEXT, TOOL_NAME, TOOL_SESSION,
} from 'scenario/session-multi-stress-ids.js';

/** The assistant text of one assistant/message event (upstream message shape:
 * data.message.content blocks; text blocks joined). */
export const assistantTextOf = (event) => (event?.data?.message?.content ?? [])
  .filter((block) => block?.type === 'text').map((block) => block.text).join('');

/** The launch env snapshot (--env KEY=VALUE on the CLI). */
export const launchEnv = () => {
  const raw = globalThis.__dshLaunchEnv?.();
  if (typeof raw !== 'string') {
    throw new Error('launch env snapshot missing (CLI must pass --env)');
  }
  return JSON.parse(raw);
};

/** Wait (bounded) for the named identity in both registries. */
export const waitSession = async (ctx, sessionId) => {
  let guard = 0;
  while ((ctx.agents.get(sessionId) === undefined || ctx.sessions.get(sessionId) === undefined)
    && guard++ < 10000) {
    await Promise.resolve();
  }
  if (ctx.agents.get(sessionId) === undefined) {
    throw new Error(`agent "${sessionId}" never appeared in the registry`);
  }
  if (ctx.sessions.get(sessionId) === undefined) {
    throw new Error(`session "${sessionId}" never appeared in the store`);
  }
  return { agent: ctx.agents.get(sessionId), session: ctx.sessions.get(sessionId) };
};

/** The persistence backend, fail-loud on the gated row. */
export const demandBackend = (ctx) => {
  const backend = ctx.get('sessionPersistence');
  if (backend === undefined) {
    throw new Error('sessionPersistence service missing — the gated row did not mount');
  }
  if (backend.name !== 'session-persistence-jsonl') {
    throw new Error(`backend label is ${backend.name}`);
  }
  return backend;
};

/** One turn START (followup only — the caller owns the waiting face). */
export const startTurn = (agent, text) => {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }));
};

/** Create one session through the spine factory (the write surface's exact
 * path: agents.create with the boot route + meta.cwd), then wait it out. */
export const createSession = async (ctx, sessionId, root, demand, emit) => {
  demand(ctx.agents.get(sessionId) === undefined, `session "${sessionId}" already exists`);
  await ctx.agents.create({
    sessionId,
    agentOptions: { provider: 'mock', model: 'mock-1' },
    meta: { cwd: root },
  });
  const handles = await waitSession(ctx, sessionId);
  demand(handles.session.seq === 0,
    `session "${sessionId}" was born with ${handles.session.seq} journal records — a fresh create must be blank`);
  emit('stress/created', { sessionId });
  return handles.agent;
};

/** Wait (bounded, WALL-CLOCK) until a predicate over the session's journal
 * holds — the mid-flight synchronization face (the trip crosses a network
 * round trip; a microtask spin exhausts itself first — measured). */
const waitJournal = async (session, predicate, describe, demand) => {
  const deadline = Date.now() + 30000;
  for (;;) {
    if (predicate(session.snapshotEvents())) return;
    if (Date.now() > deadline) {
      demand(false, `session "${session.id}" never ${describe} within 30s`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

/** Wait until the named session's journal carries a record of the given
 * type (the caller needs the tool call PROVABLY on the journal). */
export const waitJournalRecord = (session, type, demand) => waitJournal(
  session,
  (events) => events.some((e) => e.type === type),
  `journaled a ${type}`,
  demand,
);

/** Wait until the session's journal carries at least n turn/start records —
 * the "this session's NEXT turn has opened" barrier the mid-flight insertion
 * waits on (a plain record-type wait cannot tell turn 2's start from turn
 * 1's). */
export const waitJournalTurns = (session, n, demand) => waitJournal(
  session,
  (events) => events.filter((e) => e.type === 'turn/start').length >= n,
  `open ${n} turns`,
  demand,
);

/** The firehose's per-page settle: fold the open turn's account, demand it,
 * emit the canonical settle record, close the page. */
const settleTurn = (session, st, stats, demand, emit) => {
  demand(st.open !== null,
    `firehose: session "${session.id}" closed a turn that was never opened`);
  const text = st.open.texts.join('');
  demand(text === EXPECTED_TEXT,
    `firehose: session "${session.id}" turn ${st.open.turn} settled "${text}", `
    + `expected "${EXPECTED_TEXT}"`);
  demand(st.open.toolResults === st.open.toolCalls,
    `firehose: session "${session.id}" turn ${st.open.turn} has ${st.open.toolCalls} `
    + `tool calls but ${st.open.toolResults} results`);
  emit('stress/turn.settled', {
    sessionId: session.id,
    turn: st.open.turn,
    records: st.open.records,
    text,
    toolCalls: st.open.toolCalls,
  });
  st.closed.push(st.open.turn);
  st.open = null;
  stats.openCount -= 1;
};

/** Tool records: only the scripted tool session may carry them, and only
 * inside an open turn — a tool record anywhere else is a cross-turn or
 * cross-session landing, failed loud in the moment. */
const handleFirehoseToolRecord = (session, event, st, type, demand) => {
  demand(session.id === TOOL_SESSION,
    `firehose: tool record (${type}) landed in session "${session.id}" — only `
    + `"${TOOL_SESSION}" scripts a tool turn`);
  demand(st.open !== null,
    `firehose: session "${session.id}" produced a ${type} with no open turn`);
  st.toolRecords += 1;
  if (type === 'tool/call') {
    st.open.toolCalls += 1;
    demand(event.data?.name === TOOL_NAME,
      `firehose: the tool call is ${event.data?.name}, expected ${TOOL_NAME}`);
  } else st.open.toolResults += 1;
};

/** The firehose's per-record dispatch (everything except the seq check). */
const handleFirehoseEvent = (session, event, st, stats, demand, emit) => {
  const type = event.type;
  if (type === 'turn/start') {
    demand(st.open === null,
      `firehose: session "${session.id}" opened turn ${event.data?.turn} while turn `
      + `${st.open?.turn} is still open — a late frame landed in the wrong turn`);
    demand(event.data?.turn === st.closed.length + 1,
      `firehose: session "${session.id}" opened turn ${event.data?.turn}, expected `
      + `${st.closed.length + 1} — turn numbering has a gap or duplicate`);
    st.open = { turn: event.data?.turn, records: 1, texts: [], toolCalls: 0, toolResults: 0 };
    stats.openCount += 1;
    if (stats.openCount > stats.peakOpen) stats.peakOpen = stats.openCount;
    return;
  }
  if (st.open !== null) st.open.records += 1;
  if (type === 'user/message') {
    demand(st.open !== null,
      `firehose: session "${session.id}" took a prompt with no open turn`);
  } else if (type === 'assistant/message') {
    demand(st.open !== null,
      `firehose: session "${session.id}" produced an assistant message with no open turn `
      + '— a late stream frame landed outside every turn window');
    st.open.texts.push(assistantTextOf(event));
  } else if (type === 'tool/call' || type === 'tool/result') {
    handleFirehoseToolRecord(session, event, st, type, demand);
  } else if (type === 'turn/end') {
    settleTurn(session, st, stats, demand, emit);
  }
};

/** The ATTRIBUTION FIREHOSE — see the module doc. Returns the per-session
 * state map, the open-turn counters, and the trip flag the leg's main flow
 * re-demands at every await barrier. */
export const installFirehose = (ctx, demand, emit) => {
  const state = new Map(); // sessionId → {seq, open, closed, toolRecords}
  const stats = { openCount: 0, peakOpen: 0 };
  // The firehose's demands run INSIDE a session-store listener: the store
  // CONTAINS a listener throw (warn + continue, measured), so a tripped
  // demand would not stop the run on its own.
  const trip = { reason: null };
  const firehoseDemand = (cond, reason) => {
    if (cond) return;
    if (trip.reason === null) trip.reason = reason;
    demand(cond, reason);
    throw new Error(reason);
  };
  const of = (id) => {
    let st = state.get(id);
    if (st === undefined) {
      st = { seq: -1, open: null, closed: [], toolRecords: 0 };
      state.set(id, st);
    }
    return st;
  };
  ctx.on('session/event', (session, event) => {
    if (session?.id === undefined || event === undefined) return;
    const st = of(session.id);
    // Journal seqs are CONTIGUOUS from 0 on a fresh session — a gap is a
    // record dropped on delivery, not merely reordered.
    firehoseDemand(event.seq === st.seq + 1,
      `firehose: session "${session.id}" journaled seq ${event.seq}, expected ${st.seq + 1} `
      + '— a record was lost or duplicated on delivery');
    st.seq = event.seq;
    handleFirehoseEvent(session, event, st, stats, firehoseDemand, emit);
  });
  return { state, stats, trip };
};

/** The tool fingerprint: exactly one linked call+result pair, in the
 * scripted turn, with schema-valid todo_write arguments, the result citing
 * its call's seq. */
const assertToolFingerprint = (session, toolCalls, toolResults, demand) => {
  demand(toolCalls.length === 1 && toolResults.length === 1,
    `${session.id}: expected exactly one tool call+result pair, got ${toolCalls.length}+${toolResults.length}`);
  demand(toolCalls[0]?.data?.name === TOOL_NAME,
    `${session.id}: tool call is ${toolCalls[0]?.data?.name}`);
  const args = JSON.parse(toolCalls[0]?.data?.arguments ?? 'null');
  demand(Array.isArray(args?.todos) && args.todos.length > 0,
    `${session.id}: tool arguments are not the schema-valid todo write: ${toolCalls[0]?.data?.arguments}`);
  // The result must CITE its call (the linked pair — an orphaned result
  // would be a cross-turn landing the firehose's count pairing missed).
  demand(toolResults[0]?.sourceEventSeqs?.[0] === toolCalls[0]?.seq,
    `${session.id}: tool/result does not cite its tool/call (${JSON.stringify(toolResults[0]?.sourceEventSeqs)} vs seq ${toolCalls[0]?.seq})`);
  demand(toolCalls[0]?.data?.turn === 2,
    `${session.id}: the scripted tool turn is ${toolCalls[0]?.data?.turn}, expected 2`);
};

/** Journal-shape re-derivation for one session — the end-state twin of the
 * firehose: turns 1..K in order, every turn closed completed, and the
 * answering messages exactly K x the scripted text (a tool round carries an
 * EXTRA, text-less assistant message — the tool-call carrier — accounted
 * separately). Returns the summary fold for the caller's emit. */
export const assertJournalShape = (session, expectedTurns, demand) => {
  const events = session.snapshotEvents();
  const starts = events.filter((e) => e.type === 'turn/start').map((e) => e.data?.turn);
  demand(JSON.stringify(starts) === JSON.stringify(Array.from({ length: expectedTurns }, (_, i) => i + 1)),
    `${session.id}: journal turns are ${JSON.stringify(starts)}, expected 1..${expectedTurns}`);
  const ends = events.filter((e) => e.type === 'turn/end');
  demand(ends.length === expectedTurns,
    `${session.id}: ${ends.length} turn/end records, expected ${expectedTurns}`);
  demand(ends.every((e) => e.data?.reason?.kind === 'completed'),
    `${session.id}: a turn closed without completing: ${JSON.stringify(ends.map((e) => e.data?.reason))}`);
  const assistantTexts = events
    .filter((e) => e.type === 'assistant/message').map(assistantTextOf);
  const toolCalls = events.filter((e) => e.type === 'tool/call');
  const toolResults = events.filter((e) => e.type === 'tool/result');
  const toolRounds = session.id === TOOL_SESSION ? 1 : 0;
  // A tool round carries TWO assistant messages: the tool-call carrier
  // (empty text blocks) and the final answer. Every ANSWERING message must
  // carry exactly the scripted text — nothing else, from anyone.
  demand(assistantTexts.length === expectedTurns + toolRounds,
    `${session.id}: ${assistantTexts.length} assistant messages, expected ${expectedTurns + toolRounds} — `
    + 'a late frame or a lost settle broke the per-turn account');
  const answered = assistantTexts.filter((text) => text !== '');
  demand(answered.length === expectedTurns
    && answered.every((text) => text === EXPECTED_TEXT),
    `${session.id}: answering texts ${JSON.stringify(assistantTexts)}, expected `
    + `${expectedTurns} x "${EXPECTED_TEXT}"`);
  if (session.id === TOOL_SESSION) {
    assertToolFingerprint(session, toolCalls, toolResults, demand);
  } else {
    demand(toolCalls.length === 0 && toolResults.length === 0,
      `${session.id}: carries ${toolCalls.length} tool calls / ${toolResults.length} tool results — `
      + `tool records leaked out of "${TOOL_SESSION}"`);
  }
  return { events: events.length, assistantCount: answered.length, toolRounds };
};

/** The per-session projection pin: turnBoundary.lastTurn is the session's
 * OWN last started turn (the projection rides turn/start) — the
 * no-cross-wiring face (a projection fed from another session's journal
 * answers a number this session never produced). */
export const demandTurnBoundary = (ctx, sessionId, expectedLastTurn, demand) => {
  const session = ctx.sessions.get(sessionId);
  demand(session !== undefined, `session "${sessionId}" vanished from the store`);
  const turnBoundary = ctx.sessionProjections.stateOf(session, 'turnBoundary');
  demand(turnBoundary !== undefined && turnBoundary.lastTurn === expectedLastTurn,
    `${sessionId}: turnBoundary.lastTurn is ${turnBoundary?.lastTurn}, expected ${expectedLastTurn}`);
  return turnBoundary.lastTurn;
};

/** The persistence pin: every session's artifact is materialized (non-empty),
 * and the backend's listing covers EXACTLY the stress ids — no phantom
 * session, no missing one. */
export const demandDurable = async (backend, sessionIds, demand) => {
  await backend.flush();
  for (const id of sessionIds) {
    const stored = await backend.stat(id);
    demand(stored !== undefined, `backend.stat found no stored session for "${id}"`);
    demand(Number(stored.sizeBytes ?? 0) > 0, `stored artifact for "${id}" is empty (${stored.sizeBytes} bytes)`);
  }
  const listed = await backend.list();
  const listedIds = listed.map((snap) => snap.header?.id).sort();
  demand(JSON.stringify(listedIds) === JSON.stringify([...sessionIds].sort()),
    `backend.list covers ${JSON.stringify(listedIds)}, expected exactly the stress sessions`);
  return listedIds;
};

/** The restored-seed shape: EXACTLY this session's drive-side journal — its
 * own turn count, its own answers, its own tool records (or nobody's) — and
 * no open turn may survive the process boundary. A resumed journal ends with
 * the backend's resume seed marker (session/end-seed — the same shape the
 * midturn leg pins); the last REPLAYED record must still be a turn/end. */
export const assertRestoredSeed = (session, driveTurns, demand, emit) => {
  const expectedTurns = driveTurns[session.id];
  demand(expectedTurns !== undefined, `session "${session.id}" is not a stress session`);
  const shape = assertJournalShape(session, expectedTurns, demand);
  const events = session.snapshotEvents();
  const tail = events[events.length - 1]?.type;
  const nonSeed = events.filter((e) => e.type !== 'session/end-seed');
  demand(nonSeed[nonSeed.length - 1]?.type === 'turn/end',
    `${session.id}: the restored seed's last replayed record is `
    + `${nonSeed[nonSeed.length - 1]?.type} (raw tail ${tail}) — the drive side left an open turn behind`);
  demand(tail === 'session/end-seed',
    `${session.id}: the resumed journal carries no resume seed marker (tail ${tail})`);
  emit('stress/resumed', {
    sessionId: session.id,
    restoredEvents: shape.events,
    turns: shape.assistantCount,
    tail,
  });
};
