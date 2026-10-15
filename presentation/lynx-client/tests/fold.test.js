import { describe, expect, it } from 'vitest';
import { applyViewEvent, createFold, isRunning, makeFoldState, snapshotState }
  from '../shared/fold.js';
import { makeDelta, makeSettled, makeToolPhase } from '../shared/view-events.js';

const feed = (fold, events) => events.forEach((event) => fold.apply(event));

const startTail = (fold) => feed(fold, [
  makeDelta('start', { attemptId: 'a1', turn: 1, step: 1 }),
]);

describe('fold: streaming tail', () => {
  it('accumulates text and reasoning; the end marks the tail terminal', () => {
    const fold = createFold();
    startTail(fold);
    feed(fold, [
      makeDelta('reasoning', { attemptId: 'a1', turn: 1, step: 1, text: 'think' }),
      makeDelta('text', { attemptId: 'a1', turn: 1, step: 1, text: 'say' }),
    ]);
    expect(fold.state.tail).toMatchObject({ text: 'say', reasoning: 'think', streaming: true });
    expect(isRunning(fold.state)).toBe(true);
    fold.apply(makeDelta('end', { attemptId: 'a1', turn: 1, step: 1 }));
    expect(fold.state.tail.streaming).toBe(false);
  });

  it('a start opens a fresh, non-streaming tail per attempt; a start for a live attempt keeps it', () => {
    // The pilot (test/mutation/) found the attemptId identity unasserted:
    // a RETRY (new attemptId) must reset the tail, a repeat start for the
    // live attempt must not, and a bare start streams nothing yet.
    const fold = createFold();
    startTail(fold);
    expect(fold.state.tail).toMatchObject({ attemptId: 'a1', text: '', streaming: false });
    fold.apply(makeDelta('start', { attemptId: 'a1', turn: 1, step: 1 }));
    expect(fold.state.tail).toMatchObject({ attemptId: 'a1', text: '' });
    fold.apply(makeDelta('text', { attemptId: 'a1', turn: 1, step: 1, text: 'one' }));
    fold.apply(makeDelta('start', { attemptId: 'a2', turn: 1, step: 1 }));
    expect(fold.state.tail).toMatchObject({ attemptId: 'a2', text: '' });
  });

  it('an end names its attempt: a foreign end is a no-op, an end without a tail is survivable', () => {
    const fold = createFold();
    startTail(fold);
    fold.apply(makeDelta('text', { attemptId: 'a1', turn: 1, step: 1, text: 'live' }));
    fold.apply(makeDelta('end', { attemptId: 'other', turn: 1, step: 1 }));
    expect(fold.state.tail).toMatchObject({ attemptId: 'a1', streaming: true }); // a1 still streaming
    expect(() => applyViewEvent(makeFoldState(), makeDelta('end', { attemptId: 'x', turn: 1, step: 1 })))
      .not.toThrow();
  });

});

describe('fold: streaming tail — the durable promotion', () => {
  it('the durable assistant message promotes the tail of its turn:step', () => {
    const fold = createFold();
    startTail(fold);
    feed(fold, [
      makeDelta('text', { attemptId: 'a1', turn: 1, step: 1, text: 'final words' }),
      makeDelta('reasoning', { attemptId: 'a1', turn: 1, step: 1, text: 'r' }),
      makeSettled('assistant-message', {
        turn: 1, step: 1, markdown: 'final words', reasoning: 'r', interrupted: false,
      }),
    ]);
    expect(fold.state.tail).toBeNull();
    expect(fold.state.items.map((i) => i.kind)).toEqual(['reasoning', 'assistant']);
  });

  it('a reasoning stream suppresses the duplicated durable reasoning row', () => {
    const fold = createFold();
    startTail(fold);
    feed(fold, [
      makeDelta('reasoning', { attemptId: 'a1', turn: 1, step: 1, text: 'r' }),
      makeSettled('assistant-message', {
        turn: 1, step: 1, markdown: 'm', reasoning: 'r', interrupted: false,
      }),
    ]);
    expect(fold.state.items.filter((i) => i.kind === 'reasoning').length).toBe(1);
  });

});

describe('fold: durable reasoning and promotion', () => {
  it('unstreamed durable reasoning lands its row; an empty one lands none', () => {
    const fold = createFold();
    feed(fold, [makeSettled('assistant-message', {
      turn: 3, step: 1, markdown: 'm', reasoning: 'durable', interrupted: false,
    })]);
    expect(fold.state.items).toEqual([
      expect.objectContaining({ kind: 'reasoning', text: 'durable', turn: 3, step: 1 }),
      expect.objectContaining({ kind: 'assistant', turn: 3, step: 1 }),
    ]);
    const bare = createFold();
    bare.apply(makeSettled('assistant-message', {
      turn: 1, step: 1, markdown: 'm', reasoning: '', interrupted: false,
    }));
    expect(bare.state.items.map((i) => i.kind)).toEqual(['assistant']);
  });

  it('the streamed-key is turn:step — lookalike pairs do not collide', () => {
    // keyFor(1,23) and keyFor(12,3) both flatten to '123' without the
    // separator; a collision would suppress a genuine durable reasoning row.
    const fold = createFold();
    feed(fold, [
      makeDelta('start', { attemptId: 'a23', turn: 1, step: 23 }),
      makeDelta('reasoning', { attemptId: 'a23', turn: 1, step: 23, text: 'live' }),
      makeSettled('assistant-message', {
        turn: 1, step: 23, markdown: 'm1', reasoning: 'live', interrupted: false,
      }),
      makeSettled('assistant-message', {
        turn: 12, step: 3, markdown: 'm2', reasoning: 'durable', interrupted: false,
      }),
    ]);
    expect(fold.state.items.filter((i) => i.kind === 'reasoning').map((i) => i.turn).sort((a, b) => a - b))
      .toEqual([1, 12]); // one reasoning row per turn: turn 1's live row, turn 12's durable row — no duplicates
  });

});

describe('fold: the promotion guard is turn:step-scoped', () => {
  it('the promotion guard is turn:step-scoped — another turn settles without stealing the tail', () => {
    const fold = createFold();
    startTail(fold); // turn 1 step 1
    fold.apply(makeToolPhase('streaming', { callId: 'c1', argsDelta: '{' }));
    feed(fold, [
      makeSettled('assistant-message', {
        turn: 2, step: 1, markdown: 'other turn', reasoning: '', interrupted: false,
      }),
    ]);
    expect(fold.state.tail).not.toBeNull(); // still turn 1's live tail
    expect(fold.state.items.map((i) => i.kind)).toEqual(['assistant']);
    fold.apply(makeSettled('assistant-message', {
      turn: 1, step: 2, markdown: 'same turn, next step', reasoning: '', interrupted: false,
    }));
    expect(fold.state.tail).not.toBeNull(); // step 2 does not promote step 1's tail
    fold.apply(makeSettled('assistant-message', {
      turn: 1, step: 1, markdown: 'mine', reasoning: '', interrupted: false,
    }));
    expect(fold.state.tail).toBeNull();
    expect(fold.state.items.map((i) => i.kind)).toEqual(['assistant', 'assistant', 'tool', 'assistant']);
    expect(fold.state.items[2]).toMatchObject({
      kind: 'tool', callId: 'c1', name: 'tool', args: '{', status: 'waiting', output: '',
    }); // the builder promotes with its accumulated args, unnamed
  });

  it('a text-only tail promotes without an empty reasoning row', () => {
    const fold = createFold();
    startTail(fold);
    feed(fold, [
      makeDelta('text', { attemptId: 'a1', turn: 1, step: 1, text: 'words' }),
      makeSettled('assistant-message', {
        turn: 1, step: 1, markdown: 'words', reasoning: '', interrupted: false,
      }),
    ]);
    expect(fold.state.items.map((i) => i.kind)).toEqual(['assistant']);
  });
});

describe('fold: tool cards', () => {
  it('a streamed builder rides the tail: it accumulates and is never an item', () => {
    // The pilot (test/mutation/) found the streaming phase's tail residency
    // unasserted — a phase misroute into the waiting branch still satisfied
    // the old byCall-only assertion.
    const fold = createFold();
    startTail(fold);
    feed(fold, [
      makeToolPhase('streaming', { callId: 'c1', name: 'bash', argsDelta: '{"c' }),
      makeToolPhase('streaming', { callId: 'c1', argsDelta: 'ommand"}' }), // name persists, args accumulate
    ]);
    expect(fold.state.items).toEqual([]); // a builder is not an item yet
    expect(fold.state.tail.tools.get('c1')).toEqual({ id: 'c1', name: 'bash', args: '{"command"}' });
  });

});

describe('fold: tool cards — the durable call owns the name', () => {
  it('a streamed builder with no live tail synthesizes one (never a throw)', () => {
    const fold = createFold();
    fold.apply(makeToolPhase('streaming', { callId: 'cx', argsDelta: 'x' }));
    expect(fold.state.tail.attemptId).toBe('unknown'); // the synthesized tail is marked, not faked
    expect(fold.state.tail.tools.get('cx')).toMatchObject({ name: '', args: 'x' });
  });

  it('a streamed builder becomes the pending card the durable call names', () => {
    const fold = createFold();
    startTail(fold);
    feed(fold, [
      makeToolPhase('streaming', { callId: 'c1', name: 'bash', argsDelta: '{"c' }),
      makeToolPhase('waiting', { callId: 'c1', name: 'bash', args: '{"command":"ls"}' }),
      makeToolPhase('ok', { callId: 'c1', output: 'total 24' }),
    ]);
    const card = fold.state.byCall.get('c1');
    expect(card).toMatchObject({ name: 'bash', status: 'ok', output: 'total 24' });
    expect(fold.state.items).toEqual([card]); // waiting lands exactly one item
  });

  it('a waiting card is a tool item born waiting with empty output, idempotently', () => {
    const fold = createFold();
    fold.apply(makeToolPhase('waiting', { callId: 'cw', name: 'fs', args: '{}' }));
    fold.apply(makeToolPhase('waiting', { callId: 'cw', name: 'fs', args: '{}' }));
    fold.apply(makeToolPhase('waiting', { callId: 'cw', name: 'zsh', args: '{}' }));
    expect(fold.state.items).toHaveLength(1); // a repeated durable call never duplicates nor renames
    expect(fold.state.items[0]).toMatchObject({
      kind: 'tool', callId: 'cw', name: 'fs', args: '{}', status: 'waiting', output: '',
    }); // only a bare `tool` card may take the durable name — `fs` stays
  });

  it('an unseen call lands its card straight at the result phase', () => {
    const fold = createFold();
    fold.apply(makeToolPhase('fail', { callId: 'cx', name: 'wasm', output: 'boom' }));
    expect(fold.state.items[0]).toMatchObject({ kind: 'tool', status: 'fail', output: 'boom' });
  });

  it('a result for a call with no known name still names it `tool`', () => {
    const fold = createFold();
    fold.apply(makeToolPhase('ok', { callId: 'cn', output: 'fine' }));
    expect(fold.state.items[0])
      .toMatchObject({ kind: 'tool', name: 'tool', status: 'ok', args: '', output: 'fine' });
  });

});

describe('fold: tool cards — the durable rename', () => {
  it('a durable waiting call that arrives after promotion renames the bare card', () => {
    // A builder streamed unnamed is promoted as `tool`; the durable call
    // later names it — in place, without duplicating the card.
    const fold = createFold();
    feed(fold, [
      makeDelta('start', { attemptId: 'a1', turn: 1, step: 1 }),
      makeToolPhase('streaming', { callId: 'c1', argsDelta: '{' }),
      makeSettled('assistant-message', {
        turn: 1, step: 1, markdown: 'm', reasoning: '', interrupted: false,
      }),
    ]);
    expect(fold.state.items.filter((i) => i.kind === 'tool')).toHaveLength(1);
    expect(fold.state.items.find((i) => i.kind === 'tool')).toMatchObject({ name: 'tool', status: 'waiting' });
    fold.apply(makeToolPhase('waiting', { callId: 'c1', name: 'bash', args: '{}' }));
    expect(fold.state.items.filter((i) => i.kind === 'tool')).toHaveLength(1); // renamed in place
    expect(fold.state.items.find((i) => i.kind === 'tool'))
      .toMatchObject({ name: 'bash', args: '{}', status: 'waiting' });
    // And once that card settles, a straggler waiting call re-opens nothing:
    // the rename guard is status-scoped, not just name-scoped.
    fold.apply(makeToolPhase('ok', { callId: 'c1', output: 'out' }));
    fold.apply(makeToolPhase('waiting', { callId: 'c1', name: 'zsh', args: '{}' }));
    expect(fold.state.items.find((i) => i.kind === 'tool'))
      .toMatchObject({ name: 'bash', status: 'ok' });
  });

});

describe('fold: tool cards — settled and named in place', () => {
  it('a settled card is never re-opened by a late durable call', () => {
    // The unseen-result card is deliberately not registered in byCall, so
    // the wire's out-of-order case (waiting after the result) lands a second
    // card instead of mutating the settled one — the fold stays total, and
    // the settled row the user already saw never changes under them.
    const fold = createFold();
    fold.apply(makeToolPhase('ok', { callId: 'c1', output: 'done' })); // lands named `tool`, settled
    fold.apply(makeToolPhase('waiting', { callId: 'c1', name: 'bash', args: '{}' }));
    expect(fold.state.items[0]).toMatchObject({ name: 'tool', status: 'ok', output: 'done' });
    expect(fold.state.items).toHaveLength(2);
  });

  it('a settled bare card keeps its name against a straggler durable call', () => {
    // promoted unnamed (name `tool`), settled ok, then a late waiting: the
    // rename guard is status-scoped — a settled card never takes the name.
    const fold = createFold();
    feed(fold, [
      makeDelta('start', { attemptId: 'a1', turn: 1, step: 1 }),
      makeToolPhase('streaming', { callId: 'c1', argsDelta: '{' }),
      makeSettled('assistant-message', {
        turn: 1, step: 1, markdown: 'm', reasoning: '', interrupted: false,
      }),
      makeToolPhase('ok', { callId: 'c1', output: 'out' }),
      makeToolPhase('waiting', { callId: 'c1', name: 'zsh', args: '{}' }),
    ]);
    expect(fold.state.items.filter((i) => i.kind === 'tool')).toHaveLength(1);
    expect(fold.state.items.find((i) => i.kind === 'tool'))
      .toMatchObject({ name: 'tool', status: 'ok' });
  });

  it('a promoted tail never duplicates a card the durable call already landed', () => {
    const fold = createFold();
    fold.apply(makeToolPhase('waiting', { callId: 'c1', name: 'bash', args: '{}' }));
    feed(fold, [
      makeDelta('start', { attemptId: 'a1', turn: 1, step: 1 }),
      makeToolPhase('streaming', { callId: 'c1', argsDelta: '{' }),
      makeSettled('assistant-message', {
        turn: 1, step: 1, markdown: 'm', reasoning: '', interrupted: false,
      }),
    ]);
    const cards = fold.state.items.filter((i) => i.kind === 'tool' && i.callId === 'c1');
    expect(cards).toHaveLength(1); // byCall wins over the stale builder
  });
});

describe('fold: settled facts', () => {
  it('a fresh fold is quiet: empty, connecting, not running, untitled', () => {
    const snap = snapshotState(createFold().state);
    expect(snap).toEqual({
      items: [], tail: null, title: undefined, sessions: [],
      connection: 'connecting', running: false, seedComplete: false,
    });
  });

  it('a cancelled turn drops the tail and records 已停止; a normal stop is silent', () => {
    const fold = createFold();
    startTail(fold);
    fold.apply(makeSettled('turn-end', { reason: 'cancelled' }));
    expect(fold.state.tail).toBeNull();
    expect(fold.state.items.at(-1)).toMatchObject({ kind: 'status', text: '已停止', tone: 'info' });

    const aborted = createFold();
    startTail(aborted);
    aborted.apply(makeSettled('turn-end', { reason: 'aborted' }));
    expect(aborted.state.tail).toBeNull(); // both cancel spellings drop the tail
    expect(aborted.state.items.at(-1)).toMatchObject({ text: '已停止', tone: 'info' });

    const quiet = createFold();
    startTail(quiet);
    quiet.apply(makeSettled('turn-end', { reason: 'stop' }));
    expect(quiet.state.items).toEqual([]);
  });

  it('every normal turn reason is silent; the tail stays terminal-but-present', () => {
    // A normal end neither adds a row nor drops the tail — the durable
    // message still promotes it. (The pilot found the streaming flip and
    // the reason table both unasserted.)
    for (const reason of ['stop', 'tool-calls', 'completed']) {
      const fold = createFold();
      startTail(fold);
      fold.apply(makeDelta('text', { attemptId: 'a1', turn: 1, step: 1, text: 'words' }));
      fold.apply(makeSettled('turn-end', { reason }));
      expect(fold.state.items).toEqual([]);
      expect(fold.state.tail).toMatchObject({ streaming: false, text: 'words' });
    }
  });

  it('a turn-end with no live tail stays quiet and not running', () => {
    const fold = createFold();
    fold.apply(makeSettled('turn-end', { reason: 'stop' }));
    expect(fold.state.tail).toBeNull(); // no ghost tail resurrected
    expect(isRunning(fold.state)).toBe(false);
  });

});

describe('fold: settled facts — the durable rows', () => {
  it('an abnormal, non-cancelled reason is a loud warn row, never 已停止', () => {
    const fold = createFold();
    startTail(fold);
    fold.apply(makeSettled('turn-end', { reason: 'error' }));
    expect(fold.state.items).toEqual([
      expect.objectContaining({ kind: 'status', text: '回合结束（error）', tone: 'warn' }),
    ]);
  });

  it('a user bubble carries no images unless the event brought them', () => {
    const fold = createFold();
    fold.apply(makeSettled('user-message', { text: 'hi' }));
    expect(fold.state.items[0]).toMatchObject({ kind: 'user', text: 'hi', images: [] });
    fold.apply(makeSettled('user-message', { text: 'see', images: ['a.png'] }));
    expect(fold.state.items[1].images).toEqual(['a.png']);
  });

});

describe('fold: settled facts — the item rows', () => {
  it('creation, status, system and title events land their durable facts', () => {
    const fold = createFold();
    fold.apply(makeSettled('creation', { files: ['main.ts'] }));
    fold.apply(makeSettled('status', { text: 'syncing', tone: 'warn' }));
    fold.apply(makeSettled('system', { label: 'cron', source: 'scheduler' }));
    fold.apply(makeSettled('title', { title: 'New chat' }));
    expect(fold.state.items[0]).toEqual({ kind: 'creation', files: ['main.ts'] });
    expect(fold.state.items[1]).toEqual({ kind: 'status', text: 'syncing', tone: 'warn' });
    expect(fold.state.items[2]).toEqual({ kind: 'system', label: 'cron', types: ['scheduler'] });
    expect(fold.state.title).toBe('New chat');
  });

});

describe('fold: the seed burst retires the optimistic prompt', () => {
  it('seed-end completes the burst and retires the optimistic prompt', () => {
    const fold = createFold();
    fold.apply(makeSettled('prompt-admitted', {}));
    expect(isRunning(fold.state)).toBe(true);
    fold.apply(makeSettled('seed-end', {}));
    expect(fold.state.seedComplete).toBe(true);
    expect(isRunning(fold.state)).toBe(false);
  });

  it('prompt-admitted runs optimistically until a stream frame or turn end', () => {
    const fold = createFold();
    fold.apply(makeSettled('prompt-admitted', {}));
    expect(isRunning(fold.state)).toBe(true);
    startTail(fold);
    // The live signal retires the optimism — the turn stays running, now
    // owned by the tail instead of the optimistic flag. (A 'stop' turn-end
    // leaves the tail terminal-but-present until its durable message lands;
    // the retirement to not-running is asserted on the cancelled end, which
    // drops the tail outright.)
    expect(fold.state.pendingPrompt).toBe(false);
    expect(isRunning(fold.state)).toBe(true);
    fold.apply(makeSettled('turn-end', { reason: 'cancelled' }));
    expect(fold.state.pendingPrompt).toBe(false);
    expect(isRunning(fold.state)).toBe(false);
  });

  it('seed-start resets the thread but keeps the shell (connection, drawer)', () => {
    const fold = createFold();
    fold.apply(makeSettled('connection', { status: 'open' }));
    fold.apply(makeSettled('sessions', { items: [{ sessionId: 's1' }] }));
    fold.apply(makeSettled('user-message', { text: 'old' }));
    fold.apply(makeSettled('seed-start', {}));
    expect(fold.state.items).toEqual([]);
    expect(fold.state.connection).toBe('open');
    expect(fold.state.sessions).toEqual([{ sessionId: 's1' }]);
    expect(fold.state.seedComplete).toBe(false);
    fold.apply(makeSettled('seed-end', {}));
    expect(fold.state.seedComplete).toBe(true);
  });
});

describe('fold: snapshot publication', () => {
  it('snapshotState is plain data with arrays instead of Maps', () => {
    const state = makeFoldState();
    state.tail = { turn: 1, step: 1, attemptId: 'a', text: 't', reasoning: 'r',
      streaming: true, tools: new Map([['c1', { id: 'c1', name: 'bash', args: '' }]]) };
    const snap = snapshotState(state);
    expect(() => JSON.stringify(snap)).not.toThrow();
    expect(snap.tail.tools).toEqual([{ id: 'c1', name: 'bash', args: '' }]);
    expect(snap.items).toEqual([]);
  });

  it('each snapshot owns its arrays — publication identity changes for reconciliation', () => {
    // The slice() is the React contract: a renderer holding one snapshot
    // must never see a later event mutate its list in place.
    const fold = createFold();
    const first = snapshotState(fold.state);
    fold.apply(makeSettled('user-message', { text: 'hi' }));
    const second = snapshotState(fold.state);
    expect(second.items).not.toBe(first.items);
    expect(first.items).toEqual([]); // the earlier snapshot is frozen at its moment
    expect(second.sessions).not.toBe(first.sessions);
  });

  it('applyViewEvent rejects anything outside the closed set', () => {
    expect(() => applyViewEvent(makeFoldState(), { type: 'alien' })).toThrow(/type/);
  });
});
