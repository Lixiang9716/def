// dsh:logging-exempt (boot module; logging happens through the mounted logger)
/**
 * web-live/question-bridge.js — the IN-BAND user-questions answerer (the
 * user-facing seat's arm): the vendored service resolves its waterfall by
 * ANY listener answering first, so this bridge parks the ask, posts it to
 * the page over the composer bus through the face dispatch layer
 * (render-intent.js — face.question@1: options normalized to {id, label},
 * schemaVersion declared), and settles when the answer lands. The answer
 * travels back through the seat's question/answer endpoint into
 * globalThis.__dshQuestionAnswer (same process on the desktop seat; the
 * device carriers deliver the frame over the bus, where the dispatch
 * layer's chained handler resolves here too).
 *
 * face.question@1's outcome rule kills the park-forever defect: a
 * `question.answer` with outcome "cancelled" (the iOS/Android cancel
 * buttons now deliver it) SETTLES the parked ask — the turn resumes with
 * the answers gathered so far, `question.decided` keeps its post-settle
 * position, and the ask never waits on a waterfall no listener resolves.
 */
import { createLogger } from 'logger.js';
import { renderIntent, FACE_VERSION } from 'render-intent.js';

const log = createLogger('question-bridge');

export const mountQuestionBridge = (ctx, post) => {
  const pending = new Map();
  let seq = 0;
  globalThis.__dshQuestionAnswer = (id, answers, outcome = 'answered') => {
    const resolve = pending.get(id);
    if (resolve === undefined) return false;
    pending.delete(id);
    // The settle: `answered` carries the page's answers; `cancelled`
    // settles with what was gathered before the cancel (usually none) —
    // the service's waterfall resolves either way and the turn resumes.
    resolve({ answers: Array.isArray(answers) ? answers : [] });
    // The action inbox is fed by whoever DELIVERED the frame — the dispatch
    // layer's chained bus handler on device seats (it calls here AND feeds
    // the inbox itself) — so this global must not double-emit (the event
    // sequence stays one-per-occurrence).
    return true;
  };
  ctx.on('user-questions/request', async (request) => {
    const id = `question-${++seq}-${Date.now()}`;
    const questions = Array.isArray(request?.questions) ? request.questions : [];
    const p = new Promise((resolve) => pending.set(id, resolve));
    const faces = renderIntent();
    const { posted, degradations } = faces.presentQuestion({ id, questions });
    for (const d of degradations) log.warn('question face degraded', d);
    log.debug('question parked for the face', { id, posted,
      count: questions.length, schemaVersion: FACE_VERSION });
    const result = await p;
    post({ type: 'question.decided', id });
    return result;
  });
};
