// dsh:logging-exempt (boot module; logging happens through the mounted logger)
/**
 * web-live/question-bridge.js — the IN-BAND user-questions answerer (the
 * user-facing seat's arm): the vendored service resolves its waterfall by
 * ANY listener answering first, so this bridge parks the ask, posts it to
 * the page over the composer bus (the same channel the approval card
 * rides), and settles when the page's answer lands. The answer travels
 * back through the seat's question/answer endpoint into
 * globalThis.__dshQuestionAnswer (same process on the desktop seat; the
 * device carriers wire their own primitive). Without a page answer the
 * ask stays parked — the turn waits, exactly like the official client's
 * pending-question face.
 */
import { createLogger } from 'logger.js';

const log = createLogger('question-bridge');

export const mountQuestionBridge = (ctx, post) => {
  const pending = new Map();
  let seq = 0;
  globalThis.__dshQuestionAnswer = (id, answers) => {
    const resolve = pending.get(id);
    if (resolve === undefined) return false;
    pending.delete(id);
    resolve({ answers });
    return true;
  };
  ctx.on('user-questions/request', async (request) => {
    const id = `question-${++seq}-${Date.now()}`;
    const questions = Array.isArray(request?.questions) ? request.questions : [];
    const p = new Promise((resolve) => pending.set(id, resolve));
    post({ type: 'question.request', id, questions });
    log.debug('question parked for the page', { id, count: questions.length });
    const result = await p;
    post({ type: 'question.decided', id });
    return result;
  });
};
