// render-intent.test.js — the R3 face dispatch layer pins (T-0290): the
// platform-neutral seam every native render payload crosses (runtime/dsh/
// render-intent.js + face-schemas.js) implements the face.*@1 family the
// 2026-11-12 proposal declares — validation, the five-rung degradation
// ladder (never crash, never silent), the version gate, the action inbox
// as event sequences (D8), and the #764 tool-view mapping. These
// assertions pin the ladder rules the proposal's §5 names; the E2E legs
// (card-player's card.action.received, question-face's cancelled settle)
// prove the same rules on the real seat.
import { describe, it, expect } from 'vitest';
import {
  validateIntent, approvalPayload, pickerPayload, notifyPayload,
  toolViewFace, mountRenderIntent, FACE_VERSION,
} from 'render-intent.js';

describe('face.card@1 validation (well-formed frames post as-is)', () => {
  it('posts a well-formed v1 present with schemaVersion and passes actions', () => {
    const intent = {
      type: 'card.present', schemaVersion: 1,
      card: { id: 'c1', kind: 'timer', title: 't', durationMs: 1000,
        actions: [{ id: 'snooze', label: '稍后看' }] },
    };
    const { ok, intent: validated, degradations } = validateIntent(intent);
    expect(ok).toBe(true);
    expect(degradations).toEqual([]);
    expect(validated.card.actions).toEqual([{ id: 'snooze', label: '稍后看' }]);
    expect(validated.schemaVersion).toBe(1);
  });

  it('absent schemaVersion = legacy = accepted with zero degradations', () => {
    const { ok, degradations } = validateIntent({
      type: 'card.present', card: { id: 'c1', kind: 'timer', durationMs: 5 },
    });
    expect(ok).toBe(true);
    expect(degradations).toEqual([]);
  });

  it('refuses a state frame with no valid field and a complete missing its id', () => {
    expect(validateIntent({ type: 'card.state', id: 'c1', state: {} }).ok).toBe(false);
    expect(validateIntent({ type: 'card.state', id: 'c1', state: { remainingMs: 3 } }).ok).toBe(true);
    expect(validateIntent({ type: 'card.complete', message: 'x' }).ok).toBe(false);
    expect(validateIntent({ type: 'card.dismiss' }).ok).toBe(true);
  });
});

describe('the degradation ladder, refusal rungs (§5.1/§5.4)', () => {
  it('REFUSES a present missing the id with the warn naming frame+field (§5.4)', () => {
    const { ok, degradations } = validateIntent({
      type: 'card.present', card: { title: 'no id' },
    });
    expect(ok).toBe(false);
    expect(degradations).toContainEqual(
      { rule: 'missing-field', frame: 'card.present', field: 'card.id' });
  });

  it('degrades an unknown kind to info WITH the warn (§5.1)', () => {
    const { ok, intent, degradations } = validateIntent({
      type: 'card.present', card: { id: 'c1', kind: 'hologram' },
    });
    expect(ok).toBe(true);
    expect(intent.card.kind).toBe('info');
    expect(degradations).toContainEqual(
      { rule: 'kind-unknown', frame: 'card.present', kind: 'hologram', rendered: 'info' });
  });

  it('renders a FUTURE schemaVersion legacy + one warn (§5.2); unknown fields pass (§5.3)', () => {
    const intent = {
      type: 'card.present', schemaVersion: FACE_VERSION + 1,
      card: { id: 'c1', kind: 'info', futureField: { x: 1 } },
    };
    const { ok, intent: validated, degradations } = validateIntent(intent);
    expect(ok).toBe(true);
    expect(validated.card.futureField).toEqual({ x: 1 });
    expect(degradations).toEqual([
      { rule: 'schema-future', frame: 'card.present',
        known: FACE_VERSION, spoke: FACE_VERSION + 1 }]);
  });

});

describe('the degradation ladder, coercion rungs (§5.2/§5.3)', () => {
  it('drops mistyped known fields with warns and drops malformed action entries', () => {
    const intent = {
      type: 'card.present', card: {
        id: 'c1', title: 42, durationMs: 'soon',
        actions: [{ id: 'ok', label: '好' }, { id: 7 }, 'bare'],
      },
    };
    const { ok, intent: validated, degradations } = validateIntent(intent);
    expect(ok).toBe(true);
    expect(validated.card.title).toBeUndefined();
    expect(validated.card.durationMs).toBeUndefined();
    expect(validated.card.actions).toEqual([{ id: 'ok', label: '好' }]);
    expect(degradations.map((d) => d.rule)).toEqual(
      ['field-type', 'field-type', 'action-dropped', 'action-dropped']);
  });

  it('refuses unknown face types, non-objects, and bad schemaVersions without throwing', () => {
    expect(validateIntent({ type: 'hologram.present' }).degradations)
      .toEqual([{ rule: 'face-unknown', frame: 'hologram.present' }]);
    expect(validateIntent(null).degradations).toEqual([{ rule: 'face-unknown', frame: undefined }]);
    expect(validateIntent('card.present').degradations)
      .toEqual([{ rule: 'face-unknown', frame: undefined }]);
    expect(validateIntent({ type: 'card.present', schemaVersion: '1', card: { id: 'x' } }).ok)
      .toBe(false);
  });
});

describe('face.question@1 — options normalize to {id, label}', () => {
  it('normalizes bare strings and id-bearing objects; drops alien options with warns', () => {
    const intent = {
      type: 'question.request', schemaVersion: 1, id: 'ask-1',
      questions: [{ id: 'q1', options: ['甲', { id: 'opt-2', label: '乙' }, 42] }],
    };
    const { ok, intent: validated, degradations } = validateIntent(intent);
    expect(ok).toBe(true);
    expect(validated.questions[0].options).toEqual([
      { id: '甲', label: '甲' }, { id: 'opt-2', label: '乙' },
    ]);
    expect(degradations.map((d) => d.rule)).toEqual(['option-dropped']);
  });

  it('refuses a request with no id or no questions', () => {
    expect(validateIntent({ type: 'question.request', questions: [{}] }).ok).toBe(false);
    expect(validateIntent({ type: 'question.request', id: 'a', questions: [] }).ok).toBe(false);
  });
});

describe('the primitive payload faces (request side only — results stay frozen)', () => {
  it('face.approval@1 keeps {schemaVersion,title,detail,allowRemember} and KILLS the message alias', () => {
    const { payload, degradations } = approvalPayload({
      schemaVersion: 1, title: '挂载?', message: '旧键', detail: '详情', extra: 1,
    });
    expect(payload).toEqual({ schemaVersion: 1, title: '挂载?', detail: '详情' });
    expect(degradations).toEqual([
      { rule: 'unblessed-alias', frame: 'face.approval', field: 'message', canonical: 'detail' }]);
  });

  it('face.picker@1 forwards an unknown mode (the primitive refuses loud) with the warn', () => {
    expect(pickerPayload({ mode: 'camera' })).toEqual({
      payload: { mode: 'camera' },
      degradations: [
        { rule: 'mode-unknown', frame: 'face.picker', mode: 'camera',
          served: 'file|directory|media' }],
    });
    expect(pickerPayload({ mode: 'media' }).degradations).toEqual([]);
  });

  it('face.notify@1 warns on the missing title and still forwards (the primitive is authority)', () => {
    expect(notifyPayload({ body: 'b' })).toEqual({
      payload: { body: 'b' },
      degradations: [{ rule: 'missing-field', frame: 'face.notify', field: 'title' }],
    });
  });
});

describe('the #764 tool-view mapping (presenters degrade, never throw)', () => {
  it('maps call views to card.present payloads and result views to card.complete', () => {
    expect(toolViewFace({ card: 'generic', title: 'Create plugin x', kind: 'edit' }))
      .toEqual({ frame: 'card.present', card: { kind: 'info', title: 'Create plugin x' } });
    expect(toolViewFace({ card: 'terminal', title: 'bash', description: 'run tests' }))
      .toEqual({ frame: 'card.present', card: { kind: 'info', title: 'bash', label: 'run tests' } });
    expect(toolViewFace({ card: 'diff', title: 'Write a.txt', diffs: [{}, {}] }))
      .toEqual({ frame: 'card.present', card: { kind: 'info', title: 'Write a.txt', label: '2 个文件变更' } });
    expect(toolViewFace({ card: 'search', title: 'grep', total: 12, truncated: true }))
      .toEqual({ frame: 'card.complete', message: 'grep · 12 项（已截断）' });
    expect(toolViewFace({ card: 'web', kind: 'fetch', title: 'fetch', statusCode: 404 }))
      .toEqual({ frame: 'card.complete', message: 'fetch · HTTP 404' });
  });

  it('degrades alien shapes to null (undefined view is the pin\'s silent fallback)', () => {
    expect(toolViewFace(undefined)).toBe(null);
    expect(toolViewFace({ no: 'card tag' })).toBe(null);
    expect(toolViewFace({ card: 'quantum' }).frame).toBe('card.present');
  });
});

describe('the mounted layer: bus rows through the one seam', () => {
  const mount = () => {
    const posted = [];
    const faces = mountRenderIntent({ post: (msg) => posted.push(msg) });
    return { faces, posted };
  };

  it('presentCard/cardState/cardComplete post validated v1 rows; bad ones never post', () => {
    const { faces, posted } = mount();
    expect(faces.presentCard({ id: 'c1', kind: 'timer', durationMs: 9 }).posted).toBe(true);
    expect(posted[0]).toEqual({
      type: 'card.present', schemaVersion: 1,
      card: { id: 'c1', kind: 'timer', durationMs: 9 },
    });
    expect(faces.presentCard({ kind: 'timer' }).posted).toBe(false);
    expect(posted.length).toBe(1);
    expect(faces.cardState('c1', { remainingMs: 4 }).posted).toBe(true);
    expect(faces.cardComplete('c1', 'done').posted).toBe(true);
    expect(faces.dispatch({ type: 'wat.present', x: 1 }).posted).toBe(false);
  });

  it('presentToolView mints tool ids and posts through the same validation', () => {
    const { faces, posted } = mount();
    const outcome = faces.presentToolView({ card: 'generic', title: 'plugin_create' });
    expect(outcome.posted).toBe(true);
    expect(posted[0].type).toBe('card.present');
    expect(posted[0].card.title).toBe('plugin_create');
    expect(outcome.id).toMatch(/^tool-\d+-1$/);
    expect(faces.presentToolView({ alien: true }).posted).toBe(false);
  });
});

describe('the mounted layer: the action inbox as event sequences (D8)', () => {
  const mount = () => mountRenderIntent({ post: () => {} });

  it('delivers card.action as ordered events with close terminal-once per id', () => {
    const faces = mount();
    const events = [];
    faces.onAction('card.action', (e) => events.push(e));
    expect(faces.deliverAction({ type: 'card.action', id: 'c1', action: 'button', actionId: 'snooze' })).toBe(true);
    expect(faces.deliverAction({ type: 'card.action', id: 'c1', action: 'close' })).toBe(true);
    // close is terminal — a second close for the id drops; buttons are not
    expect(faces.deliverAction({ type: 'card.action', id: 'c1', action: 'close' })).toBe(false);
    expect(faces.deliverAction({ type: 'card.action', id: 'c1', action: 'button', actionId: 'late' })).toBe(true);
    expect(events.map((e) => `${e.action}:${e.actionId ?? ''}`))
      .toEqual(['button:snooze', 'close:', 'button:late']);
    // a NEW card id re-arms the terminal rule
    expect(faces.deliverAction({ type: 'card.action', id: 'c2', action: 'close' })).toBe(true);
    expect(events.length).toBe(4);
    expect(faces.deliverAction({ type: 'card.action', id: 'c3', action: 'shake' })).toBe(false);
  });

  it('normalizes question.answer outcomes and awaitAction resolves on delivery (bounded)', async () => {
    const faces = mount();
    const waiter = faces.awaitAction('question.answer', 500,
      (e) => e.outcome === 'cancelled');
    expect(faces.deliverAction({ type: 'question.answer', id: 'a1', answers: [] })).toBe(true);
    const never = faces.awaitAction('question.answer', 50,
      (e) => e.outcome === 'answered' && e.id === 'never');
    expect(faces.deliverAction({ type: 'question.answer', id: 'a2', outcome: 'cancelled' })).toBe(true);
    expect((await waiter).id).toBe('a2');
    expect(await never).toBe(null); // timeout = absence, never a hang
  });

  it('handleBusLine feeds the inbox AND resolves the question bridge global', () => {
    const faces = mount();
    let parked = null;
    globalThis.__dshQuestionAnswer = (id, answers, outcome) => { parked = { id, answers, outcome }; };
    faces.handleBusLine(JSON.stringify({
      type: 'question.answer', id: 'a3', outcome: 'cancelled', answers: [] }));
    expect(parked).toEqual({ id: 'a3', answers: [], outcome: 'cancelled' });
    faces.handleBusLine('not json'); // never throws
    faces.handleBusLine(JSON.stringify({ type: 'card.action', id: 'z', action: 'close' }));
    delete globalThis.__dshQuestionAnswer;
  });
});
