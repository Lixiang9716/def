/**
 * upstream/tool-deadline.js — the per-tool-run deadline (issue #323, ring 1).
 *
 * The vendored ToolRuntime dispatches every native tool body with a bare
 * `await tool.execute(...)` (dsh-tools lib/index.js dispatchToolBody) — a
 * tool body that never settles suspends the agent loop forever, and on the
 * serial mobile runtime that wedged the whole spine (the T-0167 hang: one
 * real-LLM turn pinned the thread, starved the mux heartbeat, and the page
 * lost its connection; no structured logs in release to even name the call).
 * Definitions may DECLARE `timeoutMs` but nothing enforces it on native
 * dispatch, and the agent loop arms no timeout either.
 *
 * This plugin rides the registry's own extension point — the `tools/execute`
 * waterfall (around-dispatch) — so every tool body the loop dispatches gets
 * a wall-clock budget armed with the vendored @deepseek-ai/dsh-timeout
 * `deadline()`. The budget is FUSED into `exec.signal` before the body runs,
 * so a body that honours cancellation is told to stop through the same
 * signal path upstream designed for it; when the budget lapses first the
 * call fails IN-BAND (a normal isError tool result the model can read), the
 * turn continues, and the runtime stays responsive.
 *
 * Honest limit (the #323 hang's most likely shape): a body spinning
 * SYNCHRONOUSLY on the serial thread never yields, so no JS timer — this
 * one included — can fire; that class is only preventable at the spinning
 * layer (wasm3 has no interruption API in the pinned v0.9.0 — a fuel cap
 * needs an engine fork). What this ring covers is every await-shaped wedge:
 * a gateway call the host never settles, a runaway async body, a stuck
 * approval wait. The turn-level ring (upstream/turn-watchdog.js) sits
 * outside tool dispatch.
 */
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout';
import { createLogger } from 'logger.js';

const log = createLogger('dsh.tool-deadline');

/** The default per-tool budget: generous against every measured legitimate
 * tool on the seat (fs/editor/shell runs land in seconds; ishRun carries its
 * own timeoutMs), far under the 10+ minute wedge the hang showed. */
export const DEFAULT_BUDGET_MS = 120_000;

/** Interactive tools park on a HUMAN (the in-band question/approval cards):
 * their budget is human latency, not machine latency (measured 2026-10-28:
 * the 120 s default aborted the model's ask_user_question before the user
 * could answer, and the plugin-manager's mount approval raced the same
 * wall — both cards answered correctly, the deadline had already fired). */
const INTERACTIVE_BUDGET_MS = 600_000;
const INTERACTIVE_TOOLS = new Set(['ask_user_question', 'plugin_manager']);
const budgetFor = (tool, budgetMs) => (INTERACTIVE_TOOLS.has(tool) ? INTERACTIVE_BUDGET_MS : budgetMs);

/** The per-turn STEP budget (the appgen wander, measured 2026-10-28: a
 * probe-happy turn ran 421 tool dispatches; legitimate creation runs land
 * ≤ 110). The count is per dispatch chain — an idle gap longer than the
 * reset window means a NEW user turn started, so the count zeroes. Over
 * budget fails IN-BAND with a wrap-up instruction the model can read. */
const STEP_BUDGET = 150;
const STEP_RESET_MS = 180_000;
let stepCount = 0;
let lastStepAt = 0;
const stepBudgetCheck = (tool) => {
  const now = Date.now();
  log.debug('step budget check', { tool, stepCount, STEP_BUDGET });
  if (now - lastStepAt > STEP_RESET_MS) stepCount = 0;
  lastStepAt = now;
  stepCount += 1;
  if (stepCount <= STEP_BUDGET || INTERACTIVE_TOOLS.has(tool)) return null;
  return {
    content: [{ type: 'text', text: `Error: the turn's step budget is exhausted (${stepCount} tool calls). `
      + 'Stop exploring. Wrap up NOW: deliver what exists with the present tool (or report the blocker) and end the turn.' }],
    isError: true,
    error: { message: 'step budget exhausted — wrap up and deliver', info: { code: 'STEP_BUDGET', tool, steps: stepCount } },
  };
};

/** The capability-owned timeout code (dsh-timeout's vocabulary: the code
 * rides the TimeoutReason and the failure result's error.info). */
export const TIMEOUT_CODE = 'tool/deadline';

/** Validate the configured budget (rule 5: a bad config is a defect now). */
export const parseBudgetMs = (value) => {
  log.debug('budget parse', { value });
  if (value === undefined) return DEFAULT_BUDGET_MS;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `tool-deadline: budgetMs must be a positive finite number, got ${JSON.stringify(value)}`);
  }
  return value;
};

/** The in-band failure result, in the registry's own error-result shape
 * (dsh-tools toolErrorResult): the model reads the text, the journal keeps
 * the structured error.info. */
export const deadlineResult = (tool, budgetMs) => {
  log.debug('deadline result shaped', { tool, budgetMs });
  const message = `tool "${tool}" exceeded its ${budgetMs}ms budget `
    + `(${TIMEOUT_CODE}) — the call failed in-band; the runtime stayed responsive. `
    + `Do not retry the same call unchanged.`;
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
    error: { message, info: { code: TIMEOUT_CODE, tool, timeoutMs: budgetMs } },
  };
};

/** The `tools/execute` waterfall listener: arm the budget around `next()`
 * (the registry's dispatch), fuse it into exec.signal so cancellation-aware
 * bodies observe it, race, and fail in-band when the budget wins. The body
 * promise is deliberately abandoned on timeout (nothing consumes it after
 * the in-band result; the fused abort signal asks it to stop). */
export const makeToolsExecuteListener = (budgetMs) => async (exec, next) => {
  const tool = exec?.name ?? '(unknown tool)';
  const stepStop = stepBudgetCheck(tool);
  if (stepStop !== null) return stepStop;
  const budget = budgetFor(tool, budgetMs);
  log.debug('tool deadline armed', { tool, budget });
  const wrapperSignal = exec?.signal;
  const guard = deadline(wrapperSignal, budget, TIMEOUT_CODE);
  if (exec !== undefined) exec.signal = guard.signal;
  // Resolves exactly when OUR deadline reason lands on the fused signal —
  // an upstream cancellation aborting the same signal is not a timeout and
  // keeps the registry's own cancellation semantics.
  let onAbort;
  const deadlineFired = new Promise((resolve) => {
    onAbort = () => {
      if (timeoutOf(guard.signal, TIMEOUT_CODE) !== undefined) resolve();
    };
    if (guard.signal.aborted) onAbort();
    else guard.signal.addEventListener('abort', onAbort, { once: true });
  });
  let settled;
  try {
    settled = await Promise.race([
      next().then((result) => ({ kind: 'done', result })),
      deadlineFired.then(() => ({ kind: 'deadline' })),
    ]);
  } finally {
    guard.signal.removeEventListener('abort', onAbort);
    if (exec !== undefined) exec.signal = wrapperSignal;
    guard[Symbol.dispose]();
  }
  if (settled.kind === 'done') {
    log.debug('tool deadline disarmed (done)', { tool, budget });
    return settled.result;
  }
  log.warn('tool deadline fired', { tool, budget });
  return deadlineResult(tool, budget);
};

export const name = 'tool-deadline';

/** After `tools` (the registry must exist to own the waterfall event); the
 * agent loop mounts later and dispatches through the armed waterfall. */
export const inject = ['tools'];

export const apply = (ctx, config) => {
  const budgetMs = parseBudgetMs(config?.budgetMs);
  ctx.on('tools/execute', makeToolsExecuteListener(budgetMs));
  log.info('tool deadline mounted', { budgetMs });
};
