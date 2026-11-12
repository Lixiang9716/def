// dsh:logging-exempt (scenario; the logger face is the seat's emit)
/**
 * Scenario `question.face` — the face.question@1 pilot leg (R3, T-0290):
 * a REAL `ctx.userQuestions.ask()` on a booted spine (the vendored
 * service's waterfall — never a synthesized frame), parked by the question
 * bridge and posted through the face dispatch layer (render-intent.js —
 * options normalized to {id, label}, schemaVersion declared), answered by
 * the host's NATIVE dialog CANCELLING — and the cancel SETTLES the parked
 * turn (`outcome:"cancelled"` on `question.answer`): the park-forever
 * defect (iOS 取消 had no handler, so no answer was ever delivered and the
 * ask waited forever) dies here, proven on the real waterfall.
 *
 * The LLM is never dialed (the create-card precedent: the route is boot
 * wiring, no model turn runs) — the ask is driven straight against the
 * service the agent loop would use.
 */
import { createLogger } from '../logger.js';
import { scenarioModule } from '../transport-tokens.mjs';
import { fsScope } from 'gateway.js';
import { bootUpstream } from 'upstream/boot.js';
import { mountRenderIntent } from 'render-intent.js';
import { mountQuestionBridge } from 'web-live/question-bridge.js';
import 'upstream/shims/timers.js';

const SCENARIO = 'question.face';
const log = createLogger(scenarioModule);
const emit = (event, fields = {}) => log.info('e2e', { scenario: SCENARIO, event, ...fields });
const fail = (reason) => {
  log.debug('scenario failed', { reason });
  emit('scenario.failed', { reason });
  globalThis.__dshComplete(false, reason);
};
const demand = (cond, reason) => {
  if (cond) return;
  fail(reason);
  throw new Error(reason);
};

const post = (msg) => globalThis.__dshBusPost?.(JSON.stringify(msg));

emit('question.face.begin', {});
if (!globalThis.__dshGatewayNegotiate('gateway@1')) {
  fail('gateway negotiation failed');
} else {
  emit('question.face.seat.ready', { gateway: 'gateway@1' });

  // The face layer + its action inbox on the bus chain (the host's
  // question.answer delivery lands as an event; the chained handler also
  // resolves the bridge's parked ask through __dshQuestionAnswer).
  const faces = mountRenderIntent({ post, installBus: true });

  const resolved = await fsScope.resolve('scope://app/');
  const root = resolved?.path;
  demand(typeof root === 'string' && root.startsWith('/'),
    `profile container not resolved: ${JSON.stringify(root)}`);

  const booted = await bootUpstream({
    scenario: SCENARIO,
    agentId: 'main',
    sessionId: 's-question-face-0001',
    cwd: root,
    onEvent: (event, fields) => log.debug('boot', { event, ...fields }),
    container: {
      cwd: root,
      scopeRoot: root,
      tmpdir: `${root}/tmp`,
      home: `${root}/home`,
      env: {},
      argv: ['dsh', '--profile', 'mobile'],
    },
    llm: {
      baseURL: 'http://127.0.0.1:9/never-dialed',
      apiKey: 'unused',
      provider: 'mock',
      kind: 'mock',
      model: 'mock-1',
    },
  });
  demand(booted !== undefined && typeof booted.ctx === 'object',
    'the spine boot returned no ctx');
  emit('question.face.spine.booted', { sessionId: booted.sessionId });

  // The vendored user-questions service (the exact row the spine's
  // composition host plane mounts — boot-coverage-rows.js's import), so
  // ctx.userQuestions.ask() runs the REAL waterfall on this seat.
  const { default: UserQuestionsService } = await import('@deepseek-ai/dsh-user-questions');
  await booted.ctx.plugin(UserQuestionsService, {});
  demand(typeof booted.ctx.userQuestions?.ask === 'function',
    'ctx.userQuestions.ask is not mounted on this spine');

  // The bridge (the user-facing seat's arm): parks the ask, posts the
  // face through the dispatch layer, settles on the answer.
  mountQuestionBridge(booted.ctx, post);
  emit('question.face.bridge.mounted', {});

  const settle = faces.awaitAction('question.answer', 30000,
    (event) => event.outcome === 'cancelled');

  const askP = booted.ctx.userQuestions.ask({
    questions: [{
      id: 'q-cancel',
      header: '问询',
      question: '要取消这次提问吗？',
      options: [{ id: 'yes', label: '取消' }, { id: 'no', label: '继续' }],
    }],
  });
  emit('question.face.asked', { questions: 1, options: 'id-label' });

  const cancelled = await settle;
  demand(cancelled !== null, 'the cancelled answer never arrived (30s)');
  emit('question.face.cancelled', { outcome: cancelled.outcome, id: cancelled.id });

  // The park-forever defect dies HERE: the waterfall resolves on cancel
  // and the turn settles with the answers gathered before it (none).
  const result = await askP;
  demand(Array.isArray(result?.answers) && result.answers.length === 0,
    `the cancelled ask did not settle clean: ${JSON.stringify(result)}`);
  emit('question.face.turn.settled', { answers: result.answers.length });

  emit('question.face.done', { outcome: 'cancelled' });
  emit('scenario.complete', { status: 'pass' });
  globalThis.__dshComplete(true, 'question.face settled');
}
