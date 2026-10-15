// dsh:logging-exempt (test: the verdict is the assertion output)
/**
 * journal-migration.test.mjs — the persistence journal's CROSS-VERSION
 * migration leg (test-hardening row 8; node --test over the REAL vendored
 * jsonl backend on real disk — see journal-resolution.mjs for the one
 * resolution layer this leg adds and why it runs WITHOUT the loader hooks).
 *
 * The session journal's schema evolution points (read off the vendored
 * write/read code, pins 0.1.6-alpha.2): the physical log filename carries
 * the format generation (`session.jsonl` = v0, `session.vN.jsonl` after;
 * session-format's canonical-name regex), the header line stamps
 * `version` (current SESSION_FORMAT_VERSION = 3), and the build ships the
 * exact adjacent chain v0→v1 (legacy renames + id minting), v1→v2 (chunk
 * history → embedded assistant stream + assistant/attempt), v2→v3 (system
 * head promotion — the migration SYNTHESIZES one `system/message` at the
 * first step/start — plus PTC renames and surfaceOp canonicalization).
 * The jsonl storage refuses to serve a version it cannot migrate:
 * a NEWER header is "written by a newer harness — upgrade the harness",
 * never "corrupt"; unknown event vocabulary is refused unless the writer
 * marked the row `ignorable: true` (the forward-compat admission marker),
 * in which case the row is retained opaquely; unaudited fields on a known
 * row are refused. Corruption is honest per turn: a bad line at a turn
 * boundary leaves the committed prefix readable and the torn tail is
 * truncated (with a warn) before the next append; a bad line INSIDE a turn
 * refuses the read outright — no silent half-turn loss.
 *
 * Pinned here, against the vendored bytes (fixtures hand-built to the
 * released v0/v2 physical layouts — decode-only codecs upstream, shapes
 * taken from the codecs' own key tables):
 *
 *   1. a v2 journal write-opens THROUGH the migration: every message
 *      replays complete (content byte-equal), the synthesized system head
 *      lands at the first step, the appended turn lands in the published
 *      v3 generation, the v2 source file stays byte-identical, and a fresh
 *      backend instance (the restart) reads the whole journal;
 *   2. the same holds from v0 — the oldest generation, through all three
 *      migrations;
 *   3. a corrupt tail line is skipped HONESTLY: the committed prefix reads
 *      complete, the warn surfaces through the logger, the next write
 *      truncates the tail and appends — nothing else lost;
 *   4. a corrupt line inside a turn refuses the read loudly;
 *   5. a future header version (v4) refuses with the upgrade-the-harness
 *      wording and the artifact stays byte-identical;
 *   6. an unknown event type without `ignorable` refuses loudly; with
 *      `ignorable: true` it is retained opaquely and the journal stays
 *      appendable; an unknown FIELD on a known row refuses loudly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { journalImport } from './journal-resolution.mjs';

// Real Node resolution: these URLs realpath into external/npm/<pkg>/lib and
// the graph resolves through external/node_modules (+ the two override rows
// journal-resolution.mjs staged). Plain node:fs — no loader hooks.
const { default: JsonlSessionPersistence } = await import(journalImport('@deepseek-ai/dsh-session-persistence-jsonl'));
const { Context } = await import(journalImport('@deepseek-ai/cordis'));
const { SESSION_FORMAT_VERSION } = await import(journalImport('@deepseek-ai/dsh-session'));

const CREATED_AT = 1700000000000;
const A = 'append';
// The chain this leg pins: the vendored catalog serves exactly v0..v3.
assert.equal(SESSION_FORMAT_VERSION, 3, 'the current Session format moved — extend the fixtures');
// An embedded assistant stream that replays to exactly the fixture content
// (text-chunks expand to one text block; the finish chunk closes the stream).
const streamFor = (text) => [
  { type: 'text-chunks', index: 0, time0: 100, dt: [], texts: [text] },
  { type: 'chunk', time: 101, chunk: { type: 'finish', reason: { kind: 'completed' } } },
];

const userMessage = (seq, time, text, id) => ({
  type: 'user/message', seq, time, surfaceOp: A,
  data: { role: 'user', id, content: [{ type: 'text', text }], source: { kind: 'user' } },
});
const assistantMessage = (seq, time, turn, step, id, text, withStream) => ({
  type: 'assistant/message', seq, time, surfaceOp: A,
  data: {
    turn, step,
    message: { id, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'bigmodel', model: 'glm-5.3-flash' } },
    ...(withStream ? { stream: streamFor(text) } : {}),
  },
});

/** One complete turn in the released v0/v1/v2 vocabulary, at 0-based seqs:
 * surfaces sit INSIDE the step (v2→v3 refuses a surface before the first
 * step). v0/v1 rows carry no embedded stream (added by the v1→v2 stage);
 * v2 rows require one. */
const fixtureTurn = (withStream) => [
  { type: 'turn/start', seq: 0, time: 2, data: { turn: 1 } },
  { type: 'step/start', seq: 1, time: 3, data: { turn: 1, step: 1 } },
  userMessage(2, 1, 'hello from the previous harness', 'm-1'),
  assistantMessage(3, 4, 1, 1, 'a-1', 'hi there', withStream),
  { type: 'step/end', seq: 4, time: 5, data: { turn: 1, step: 1 } },
  { type: 'turn/end', seq: 5, time: 6, data: { turn: 1, reason: { kind: 'completed' } } },
];

/** Write one historical generation for `id` into a fresh backend root.
 * `version` selects the filename AND the header stamp (v0 keeps the
 * suffix-only `session.jsonl`; unseeded headers omit seedLength / carry
 * isSeeded: false after v0). Returns the journal file's path. */
const stageJournal = (root, id, version, events) => {
  const dir = join(root, '_no-cwd', id);
  mkdirSync(dir, { recursive: true });
  const header = version === 0
    ? { type: 'session', version, id, createdAt: CREATED_AT, delegationDepth: 0 }
    : { type: 'session', version, id, createdAt: CREATED_AT, isSeeded: false, delegationDepth: 0 };
  const name = version === 0 ? 'session.jsonl' : `session.v${version}.jsonl`;
  const path = join(dir, name);
  writeFileSync(path, [JSON.stringify(header), ...events.map((event) => JSON.stringify(event))].join('\n') + '\n');
  return path;
};

/** A fresh backend instance on `root` — one per open cycle so a restart is
 * a real new storage (no shared memo), exactly the process-restart shape. */
const backend = async (root) => {
  const persistence = new JsonlSessionPersistence(new Context(), { root, compression: 'none' });
  return persistence;
};

const tempRoot = (label) => mkdtempSync(join(tmpdir(), `journal-migration-${label}-`));

/** The migrated v3 journal's expected event types for one fixture turn:
 * the source six plus the v2→v3-synthesized system head at the first
 * step/start. */
const EXPECTED_MIGRATED_TYPES = [
  'turn/start', 'step/start', 'system/message', 'user/message', 'assistant/message', 'step/end', 'turn/end',
];

const assertReplayComplete = (events, text) => {
  assert.deepEqual(events.map((event) => event.type), EXPECTED_MIGRATED_TYPES,
    'the migrated replay lost or reordered events');
  assert.equal(events[0].seq, 0, 'migrated seqs do not start at 0');
  assert.deepEqual(events.map((event) => event.seq), events.map((_, index) => index), 'migrated seqs are not dense');
  const system = events[2];
  assert.equal(system.type, 'system/message', 'the synthesized system head is not at the first step');
  assert.match(system.data.message.id, /^v2-to-v3-system-[0-9a-f]{64}$/,
    'the synthesized system head does not carry the migration identity');
  assert.equal(events[3].data.content[0].text, text, 'the user message text did not survive migration');
  assert.deepEqual(events[4].data.message.content, [{ type: 'text', text: 'hi there' }],
    'the assistant message content did not survive migration');
};

test('a v2 journal migrates on write-open, replays completely, and appends into the published v3 generation', { timeout: 60000 }, async () => {
  const root = tempRoot('v2');
  const id = 's-journal-mig-v2';
  const source = stageJournal(root, id, 2, fixtureTurn(true));
  const sourceBytes = readFileSync(source, 'utf8');

  const storage = await backend(root);
  const handle = await storage.open(id, 'write');
  const replay = await handle.read(0);
  assertReplayComplete(replay.events, 'hello from the previous harness');

  // Append a second, current-format turn — it must land AFTER the migrated
  // prefix in the NEW generation, dense from its tail.
  const second = [
    { type: 'turn/start', time: 8, data: { turn: 2 } },
    { type: 'step/start', time: 9, data: { turn: 2, step: 1 } },
    userMessage(0, 7, 'again', 'm-2'),
    assistantMessage(0, 10, 2, 1, 'a-2', 'second', true),
    { type: 'step/end', time: 11, data: { turn: 2, step: 1 } },
    { type: 'turn/end', time: 12, data: { turn: 2, reason: { kind: 'completed' } } },
  ].map((event, offset) => ({ ...event, seq: replay.events.length + offset }));
  await handle.append(second);
  await handle.close();

  const v3Path = join(source, '..', 'session.v3.jsonl');
  assert.equal(readFileSync(v3Path, 'utf8').split('\n').length, 1 + 7 + 6 + 1,
    'the published v3 generation does not carry header + migrated turn + appended turn');
  assert.equal(readFileSync(source, 'utf8'), sourceBytes,
    'the v2 source generation was mutated by the migration');

  // The restart: a fresh storage instance reads the whole journal.
  const restarted = await backend(root);
  const readHandle = await restarted.open(id, 'read');
  const after = await readHandle.read(0);
  assert.equal(after.events.length, 13, 'the restart lost events');
  assert.equal(after.events.at(-1).data.turn, 2, 'the restart lost the appended turn');
  assert.equal(after.events[3].data.content[0].text, 'hello from the previous harness',
    'the restart lost a migrated message');
  await readHandle.close();
  rmSync(root, { recursive: true, force: true });
});

test('a v0 journal (the oldest generation) migrates through the whole chain', { timeout: 60000 }, async () => {
  const root = tempRoot('v0');
  const id = 's-journal-mig-v0';
  const source = stageJournal(root, id, 0, fixtureTurn(false));
  const sourceBytes = readFileSync(source, 'utf8');

  const storage = await backend(root);
  const handle = await storage.open(id, 'write');
  const replay = await handle.read(0);
  assertReplayComplete(replay.events, 'hello from the previous harness');
  assert.equal(handle.header.version, 3, 'the migrated header is not v3');
  assert.equal(handle.header.createdAt, CREATED_AT, 'the migrated header lost createdAt');
  await handle.close();

  assert.equal(readFileSync(source, 'utf8'), sourceBytes, 'the v0 source generation was mutated');
  assert.ok(!readFileSync(source, 'utf8').includes('v2-to-v3-system'),
    'the v0 source file gained migrated content');
  rmSync(root, { recursive: true, force: true });
});

test('a corrupt tail line is skipped honestly: prefix reads complete, warn surfaces, the next write repairs', { timeout: 60000 }, async () => {
  const root = tempRoot('tail');
  const id = 's-journal-tail';
  const storage = await backend(root);
  const create = await storage.create({
    id, createdAt: CREATED_AT, version: SESSION_FORMAT_VERSION, isSeeded: false, delegationDepth: 0,
  });
  await create.append(fixtureTurn(true));
  await create.close();
  const journal = join(root, '_no-cwd', id, 'session.v3.jsonl');
  const good = readFileSync(journal, 'utf8');
  // A torn final record: valid JSONL framing, invalid JSON — the classic
  // mid-line crash artifact.
  writeFileSync(journal, good + '{"type":"user/message","seq":6,"time":7,"da\n');

  // Read-side honesty: the committed prefix, complete, no throw.
  const reader = await backend(root);
  const readHandle = await reader.open(id, 'read');
  const prefix = await readHandle.read(0);
  assert.equal(prefix.events.length, 6, 'the committed prefix did not read complete');
  assert.equal(prefix.events.at(-1).data.turn, 1, 'the prefix lost its last event');
  await readHandle.close();

  // Write-side honesty: the torn tail truncates WITH A WARN (the skip is
  // loud, never silent), then the append lands dense.
  const warns = [];
  const warnStorage = new JsonlSessionPersistence(new Context(), { root, compression: 'none' });
  warnStorage.ctx.logger.exporter({
    levels: { default: 4 },
    export: (record) => warns.push((record.args ?? []).map((value) => String(value)).join(' ')),
  });
  const repair = await warnStorage.open(id, 'write');
  await repair.append([{ type: 'turn/start', seq: 6, time: 8, data: { turn: 2 } }]);
  await repair.close();
  assert.ok(warns.some((text) => text.includes('torn tail')),
    `the torn-tail repair did not warn (records: ${JSON.stringify(warns)})`);
  const after = readFileSync(journal, 'utf8');
  assert.ok(!after.includes('"da\n'), 'the corrupt bytes survived the repair');
  assert.equal(after.split('\n').length, 1 + 6 + 1 + 1, 'the repair did not truncate to the committed prefix');

  const verify = await backend(root);
  const verifyHandle = await verify.open(id, 'read');
  assert.equal((await verifyHandle.read(0)).events.length, 7, 'events were lost across the repair');
  await verifyHandle.close();
  rmSync(root, { recursive: true, force: true });
});

test('a corrupt line inside a turn refuses the read loudly', { timeout: 60000 }, async () => {
  const root = tempRoot('mid');
  const id = 's-journal-mid';
  const journal = stageJournal(root, id, 3, fixtureTurn(true));
  const lines = readFileSync(journal, 'utf8').split('\n');
  lines.splice(4, 0, '{"seq":3,"type":"assistant/message"'); // unparsable, mid-turn
  writeFileSync(journal, lines.join('\n'));

  const storage = await backend(root);
  await assert.rejects(() => storage.open(id, 'read'),
    (error) => error.constructor.name === 'SessionPersistenceCorruptionError'
      && String(error.message).includes('unparsable committed event'),
    'mid-turn corruption was not refused');
  rmSync(root, { recursive: true, force: true });
});

test('a future header version refuses with the upgrade-the-harness wording and stays byte-identical', { timeout: 60000 }, async () => {
  const root = tempRoot('future');
  const id = 's-journal-future';
  const journal = stageJournal(root, id, 4, fixtureTurn(true));
  const bytes = readFileSync(journal, 'utf8');

  const storage = await backend(root);
  await assert.rejects(() => storage.open(id, 'read'), (error) => {
    assert.equal(error.constructor.name, 'SessionFormatUnsupportedError',
      'a future version refused with the wrong error class');
    assert.match(error.message, /format v4.*newer harness/, `wrong refusal wording: ${error.message}`);
    return true;
  }, 'a future version journal was served');
  await assert.rejects(() => storage.open(id, 'write'),
    (error) => error.constructor.name === 'SessionFormatUnsupportedError',
    'a future version journal opened for write');
  assert.equal(readFileSync(journal, 'utf8'), bytes, 'the refusal mutated the artifact');
  rmSync(root, { recursive: true, force: true });
});

test('an unknown event type without ignorable refuses loudly', { timeout: 60000 }, async () => {
  const root = tempRoot('unknown-plain');
  const id = 's-journal-unknown-plain';
  const journal = stageJournal(root, id, 3,
    fixtureTurn(true).map((event) => ({ ...event, seq: event.seq + (event.seq >= 4 ? 1 : 0) }))
      .toSpliced(4, 0, { type: 'future/widget', seq: 4, time: 7, data: { payload: true } }));
  const storage = await backend(root);
  await assert.rejects(() => storage.open(id, 'read'), (error) => {
    assert.equal(error.constructor.name, 'SessionFormatUnsupportedError',
      'unknown vocabulary refused with the wrong error class');
    assert.match(error.message, /future\/widget/, 'the refusal does not name the unknown type');
    return true;
  });
  rmSync(root, { recursive: true, force: true });
});

test('an ignorable unknown event type is retained opaquely and the journal stays appendable', { timeout: 60000 }, async () => {
  const root = tempRoot('unknown-ignorable');
  const id = 's-journal-unknown-ignorable';
  const journal = stageJournal(root, id, 3,
    fixtureTurn(true).map((event) => ({ ...event, seq: event.seq + (event.seq >= 4 ? 1 : 0) }))
      .toSpliced(4, 0, { type: 'future/widget', seq: 4, time: 7, ignorable: true, data: { payload: true } }));
  const writable = await backend(root);
  const handle = await writable.open(id, 'write');
  const replay = await handle.read(0);
  assert.equal(replay.events.length, 7, 'the ignorable row changed the event count');
  assert.deepEqual(replay.events[4],
    { type: 'future/widget', seq: 4, time: 7, ignorable: true, data: { payload: true } },
    'the ignorable row was not retained opaquely');
  await handle.append([{ type: 'turn/start', seq: 7, time: 8, data: { turn: 2 } }]);
  await handle.close();
  rmSync(root, { recursive: true, force: true });
});

test('an unknown field on a known row refuses loudly', { timeout: 60000 }, async () => {
  const root = tempRoot('unknown-field');
  const id = 's-journal-unknown-field';
  const padded = fixtureTurn(true).map((event) => (
    event.seq === 2 ? { ...event, priority: 'high' } : event));
  stageJournal(root, id, 3, padded);
  const storage = await backend(root);
  await assert.rejects(() => storage.open(id, 'read'), (error) => {
    assert.equal(error.constructor.name, 'SessionPersistenceCorruptionError',
      'an unknown field refused with the wrong error class');
    assert.match(String(error.cause ?? error.message), /unexpected field/,
      'the refusal does not name the unaudited field');
    return true;
  });
  rmSync(root, { recursive: true, force: true });
});
