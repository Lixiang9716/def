// dsh:logging-exempt (test: the verdict is the assertion output)
/**
 * queue-boundary-stress.test.mjs — row 14 of the test-hardening program:
 * the D2 dispatch seam's boundary stress on the REAL spine (node --test,
 * under test/panel/spine/run.sh; same harness as watchdog-abort-wire).
 *
 * THE INVARIANT UNDER STRESS: one serial JS queue carries every host
 * callback (gateway settles, bus frames, session events — AGENTS.md rule 2 /
 * D2). A burst of S sessions × T queued turns with jittered SSE pacing must:
 *   1. drain COMPLETELY — every posted turn settles, none lost;
 *   2. keep per-session ATTRIBUTION — each session's journal carries only
 *      the markers its own prompts asked for (the concurrent-bleed defect
 *      class turn-evidence.js was born from);
 *   3. keep each session's journal CONTIGUOUS — a seq gap is a dropped
 *      record, not a reorder;
 *   4. hold the deadline — a wedged queue cannot hide behind silence.
 *
 * Phases live in top-level helpers (the code-size gate's 50-line function
 * cap); the test body is the orchestration.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stagedHttp, disposeSeams } from './spine-seams.mjs';

const HERE = pathResolve(fileURLToPath(import.meta.url), '..');
const RUNTIME = pathResolve(HERE, '..', '..', '..', 'runtime', 'dsh');
const runtime = (rel) => pathToFileURL(join(RUNTIME, rel)).href;

await import('./spine-seams.mjs');

const SESSIONS = 4;
const TURNS_PER = 4; // posted as one burst → the inbox queues TURNS_PER deep
const sessionIds = Array.from({ length: SESSIONS }, (_, i) => `s-spine-q-${i + 1}`);
const state = {};

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');
const sse = (text) => {
  const body = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
  return body;
};

/** A jitter-paced endpoint that ECHOES the session marker found in the
 * request's last user message (attribution oracle). */
const stageEchoEndpoint = () => {
  stagedHttp.set('http://127.0.0.1:17890/v1/chat/completions', (args) => {
    const bodyId = `body:echo-${Math.random().toString(36).slice(2)}`;
    let marker = 'UNKNOWN';
    try {
      const req = JSON.parse(Buffer.from(args.bodyB64, 'base64').toString('utf8'));
      const last = req.messages.filter((m) => m.role === 'user').pop();
      const match = /MARK:(s-spine-q-\d+)/.exec(last?.content ?? '');
      if (match) marker = match[1];
    } catch { /* the unknown-marker path is itself an attribution failure */ }
    const timer = setTimeout(() => {
      globalThis.__dshGatewayOnEvent(JSON.stringify({
        callId: bodyId, event: 'http.body', chunkB64: b64(sse(`echo:${marker}`)),
      }));
      globalThis.__dshGatewayOnEvent(JSON.stringify({
        callId: bodyId, event: 'http.end',
      }));
    }, Math.floor(Math.random() * 40));
    return { status: 200, headers: { 'content-type': 'text/event-stream' }, bodyId, __timer: timer };
  });
};

const surfaceOptions = (ctx) => ({
  root: '/profiles/default',
  provider: 'bigmodel',
  model: 'glm-5.3-flash',
  baseURL: 'http://127.0.0.1:17890/v1',
  routeKind: 'byok',
  spine: () => state.spineInventory(ctx),
  stagedPlugins: () => [],
});

const bootOptions = () => ({
  scenario: 'spine.queue-boundary-stress',
  agentId: 'main',
  sessionId: 's-spine-q-boot',
  cwd: '/profiles/default',
  container: {
    cwd: '/profiles/default',
    tmpdir: '/profiles/default/tmp',
    home: '/profiles/default/home',
    scopeRoot: '/profiles',
    env: {},
    argv: ['dsh', '--profile', 'mobile'],
  },
  llm: {
    baseURL: 'http://127.0.0.1:17890/v1',
    apiKey: 'spine-suite-key',
    provider: 'bigmodel',
    model: 'glm-5.3-flash',
    userEndpoint: true,
    adapterName: 'spine stress byok endpoint',
  },
  onEvent: () => {},
});

const bootStressSpine = async () => {
  const { bootUpstream, spineInventory } = await import(runtime('upstream/boot.js'));
  const { createWriteSurface } = await import(runtime('upstream/web-write.js'));
  const { ctx } = await bootUpstream(bootOptions());
  state.ctx = ctx;
  state.spineInventory = spineInventory;
  state.createWriteSurface = createWriteSurface;
  // The control surface (create/prompt posts) — one of several surfaces on
  // this spine; the follow feeds each carry their own.
  state.write = createWriteSurface(ctx, () => {}, surfaceOptions(ctx));
};

const createSessions = async () => {
  // Sessions must EXIST before prompt/follow attach (session/create is the
  // mint → agents.create leg); the burst must not outrun it.
  for (const sessionId of sessionIds) {
    await state.write.api['session/create']({ sessionId });
  }
};

const attachFeeds = async () => {
  // One follow feed per session; any frame is the attach receipt (a fresh
  // session may carry no snapshot, just the open). Bounded wait — the burst
  // must not outrun the attach.
  const feeds = sessionIds.map((sessionId, i) => {
    const frames = [];
    const write = state.createWriteSurface(state.ctx, (f) => frames.push(f), surfaceOptions(state.ctx));
    write.openStream({
      streamId: `q-live-${i}`,
      endpoint: 'session/follow',
      payload: { args: { request: { address: { sessionId }, assistantStream: true } } },
    });
    return { sessionId, frames };
  });
  for (const { sessionId, frames } of feeds) {
    for (let guard = 0; guard < 500; guard++) {
      if (frames.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(frames.length > 0, `${sessionId}'s follow never attached`);
  }
  return feeds;
};

/** Per-session turn/end counters (the drain oracle): resolves when every
 * session has settled TURNS_PER turns; rejects at the 90s deadline. */
const armDrainOracle = () => {
  const settled = Object.fromEntries(sessionIds.map((id) => [id, 0]));
  const drain = new Promise((resolve, reject) => {
    const off = state.ctx.on('session/event', (session, event) => {
      if (event?.type === 'turn/end' && session?.id in settled) {
        settled[session.id] += 1;
        if (Object.values(settled).every((n) => n >= TURNS_PER)) {
          try { off(); } catch {} // eslint-disable-line no-useless-catch
          resolve();
        }
      }
    });
    setTimeout(
      () => reject(new Error(`queue did not drain in 90s: ${JSON.stringify(settled)}`)),
      90000,
    );
  });
  return { settled, drain };
};

const postBurst = async () => {
  // THE BURST: every session/prompt posted without awaiting its settle —
  // TURNS_PER deep per inbox, all SESSIONS at once.
  for (let t = 0; t < TURNS_PER; t++) {
    for (const sessionId of sessionIds) {
      await state.write.api['session/prompt']({
        sessionId,
        requestId: `req-${sessionId}-${t}`,
        mode: 'queue',
        content: [{ type: 'text', text: `MARK:${sessionId} turn ${t}` }],
      });
    }
  }
};

/** Wire quiesce: tail deltas trail the final turn/end on the wire — wait
 * for each feed to stop growing (bounded). */
const quiesceWire = async (feeds) => {
  const counts = feeds.map(() => -1);
  for (let guard = 0; guard < 50; guard++) {
    const now = feeds.map((f) => f.frames.length);
    if (now.every((n, i) => n === counts[i])) break;
    counts.splice(0, counts.length, ...now);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

/** The JOURNAL is the authoritative record: each session's log carries its
 * own echoes and nobody else's. */
const assertAttribution = () => {
  for (const sessionId of sessionIds) {
    const events = state.ctx.sessions.get(sessionId).snapshotEvents();
    const joined = JSON.stringify(events);
    assert.ok(joined.includes(`echo:${sessionId}`),
      `${sessionId}'s journal must carry its own echo`);
    for (const other of sessionIds) {
      if (other === sessionId) continue;
      assert.ok(!joined.includes(`echo:${other}`),
        `${sessionId}'s journal bled ${other}'s stream (cross-session attribution break)`);
    }
  }
};

/** Journal contiguity per session, judged through the WIRE page at the
 * cursor (throughSeq -1 is the by-design empty page): seq is 0-based with
 * no gaps — a gap is a dropped record, not a reorder. */
const assertWireContiguity = async () => {
  for (const sessionId of sessionIds) {
    const throughSeq = state.ctx.sessions.get(sessionId).seq - 1;
    assert.ok(throughSeq >= 0,
      `${sessionId}: journal empty after ${TURNS_PER} settled turns`);
    const page = await state.write.api['session/page']({
      request: {
        address: { kind: 'session', sessionId },
        throughSeq, maxMessages: 500,
      },
    });
    const seqs = (page.records ?? []).map((r) => r?.event?.seq)
      .filter((n) => Number.isFinite(n));
    assert.equal(seqs.length, throughSeq + 1,
      `${sessionId}: wire page returned ${seqs.length} of `
      + `${throughSeq + 1} journal records (a windowed read, not the log)`);
    const sorted = [...seqs].sort((a, b) => a - b);
    assert.equal(sorted[0], 0, `${sessionId}: journal must start at seq 0`);
    for (let i = 1; i < sorted.length; i++) {
      assert.equal(sorted[i], sorted[i - 1] + 1,
        `${sessionId}: journal seq gap ${sorted[i - 1]} → ${sorted[i]} (a dropped record)`);
    }
  }
};

test('queue-boundary stress: S×T burst drains completely with per-session attribution', { timeout: 120000 }, async (t) => {
  // A red assertion must not park the runner on the spine's standing
  // watchdog timer — dispose runs on every outcome.
  t.after(() => disposeSeams());
  stageEchoEndpoint();
  await bootStressSpine();
  await createSessions();
  const feeds = await attachFeeds();
  const { settled, drain } = armDrainOracle();
  await postBurst();
  await drain;
  await quiesceWire(feeds);
  assertAttribution();
  await assertWireContiguity();
  // Drain completeness (asserted by the resolved promise, restated for the
  // record).
  for (const sessionId of sessionIds) {
    assert.equal(settled[sessionId], TURNS_PER, `${sessionId} lost turns`);
  }
});
