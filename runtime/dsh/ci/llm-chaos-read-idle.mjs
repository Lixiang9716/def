#!/usr/bin/env node
// dsh:logging-exempt (node-side test vehicle: its stdout IS the product —
// inline assertions, exit code is the verdict)
/**
 * llm-chaos-read-idle.mjs — the chaos leg for the ATTEMPT-level read-idle
 * watchdog (upstream/llm-read-idle.js) over a hostile wire (test-hardening
 * row 1, doc/test-coverage.md).
 *
 * The REAL gateway transport adapter (upstream/llm-transport.js, imported
 * verbatim through the parity node hooks — the same module the quickjs port
 * runs) streams against the chaos mock's `slow-drip` profile
 * (ci/mock-llm-server.mjs DSH_MOCK_CHAOS=slow-drip: the success stream's
 * deltas paced at DSH_MOCK_CHUNK_DELAY_MS). The leg budgets read-idle at
 * DSH_READ_IDLE_MS (default 800ms) — far under the drip interval — so the
 * stream delivers its first deltas (the guard re-arms per delivered chunk,
 * exactly the battery-r14 field shape: deltas flowed, THEN silence) and the
 * next drip gap outlasts the budget. The DESIGNED reaction, asserted here:
 *
 *   1. the bytes that did arrive stream through (text-delta chunks yield),
 *   2. the attempt dies with the RETRYABLE TIMEOUT code — mapped by the
 *      guard's fired flag, message naming the watchdog and the budget,
 *   3. TIMEOUT is retryable BY THE VENDORED POLICY (membership in
 *      resolveRetryPolicy()'s retryableCodes — dsh-llm-retry's 1/5..5/5
 *      rhythm owns the retries), not by a hardcoded string list here.
 *
 * Why node-side: the CLI smoke backend (example/main_cli.c --http) drains
 * the response body synchronously INSIDE the httpFetch call — the quickjs
 * runtime is quiescent while the driver blocks in recv, so a mid-body stall
 * can never interleave with the guard's timer on that host (the C host's own
 * 5s SO_RCVTIMEO + http.end preempts it as STREAM_CLOSED). The guard's
 * logic is unit-owned (test/panel/llm-transport-read-idle.test.js, fake
 * timers + the async fake gateway); this leg owns its REAL-WIRE behavior;
 * the device seats' async gateways own the full-stack shape.
 *
 * usage: node ci/llm-chaos-read-idle.mjs   (env: DSH_MOCK_LLM_URL,
 *        DSH_MOCK_LLM_KEY, DSH_READ_IDLE_MS; the mock must already run with
 *        DSH_MOCK_CHAOS=slow-drip and DSH_MOCK_CHUNK_DELAY_MS > the budget)
 */
import { register } from 'node:module';

register('./parity-node-hooks.mjs', import.meta.url);

const fail = (message) => {
  console.error(`chaos-read-idle: FAIL ${message}`);
  process.exit(1);
};

const env = { ...process.env };
if (typeof env.DSH_MOCK_LLM_URL !== 'string' || !env.DSH_MOCK_LLM_URL.startsWith('http://127.0.0.1:')) {
  fail(`DSH_MOCK_LLM_URL missing or not loopback: ${String(env.DSH_MOCK_LLM_URL)}`);
}
if (typeof env.DSH_MOCK_LLM_KEY !== 'string' || env.DSH_MOCK_LLM_KEY.length === 0) {
  fail('DSH_MOCK_LLM_KEY missing');
}
const IDLE_MS = Number(env.DSH_READ_IDLE_MS ?? 800);
if (!Number.isFinite(IDLE_MS) || IDLE_MS <= 0) fail(`DSH_READ_IDLE_MS must be a positive number, got ${env.DSH_READ_IDLE_MS}`);

const { createGatewayLlmAdapter } = await import('../upstream/llm-transport.js');
const { LlmError, resolveRetryPolicy } = await import('@deepseek-ai/dsh-llm');

const adapter = createGatewayLlmAdapter({
  baseURL: env.DSH_MOCK_LLM_URL,
  apiKey: env.DSH_MOCK_LLM_KEY,
  provider: 'mock',
  readIdleTimeoutMs: IDLE_MS,
});

const deadline = Date.now() + 60_000;
const pull = async (gen) => {
  const outcome = await Promise.race([
    gen.next().then(
      (value) => ({ value }),
      (error) => ({ error }),
    ),
    // unref'd: the race losing must not pin the process (the deadline is a
    // hang detector, not a keep-alive)
    new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), deadline - Date.now()).unref()),
  ]);
  if (outcome?.timeout) fail(`the stream neither yielded nor failed within ${deadline - Date.now()}ms`);
  return outcome;
};

const gen = adapter.stream({
  provider: 'mock',
  model: 'mock-1',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Say hello' }] }],
});

// 1. the drip's first deltas flow (wire liveness: the guard re-arms on each)
const opening = await pull(gen);
if (opening.error !== undefined) fail(`the stream died before its first chunk: ${opening.error.message}`);
if (opening.value.value?.type !== 'block-start') {
  fail(`the first chunk is ${JSON.stringify(opening.value.value)} (want a text block-start)`);
}
const delta = await pull(gen);
if (delta.error !== undefined) fail(`the stream died before its first delta: ${delta.error.message}`);
if (delta.value.value?.type !== 'text-delta' || delta.value.value.text !== 'Hello') {
  fail(`the second chunk is ${JSON.stringify(delta.value.value)} (want the 'Hello' text-delta)`);
}
console.log(`chaos-read-idle: drip delivered ${JSON.stringify(delta.value.value.text)} (wire liveness re-armed the guard)`);

// 2. the next drip gap outlasts the budget: the attempt dies TIMEOUT
const stalled = await pull(gen);
if (stalled.error === undefined) fail(`the attempt survived a ${IDLE_MS}ms silent gap (want the read-idle TIMEOUT)`);
const error = stalled.error;
if (!(error instanceof LlmError)) fail(`the failure is a ${error?.constructor?.name}, not an LlmError`);
if (error.code !== 'TIMEOUT') fail(`the failure code is ${error.code} (want the read-idle TIMEOUT)`);
if (!error.message.includes(`no bytes for ${IDLE_MS}ms`) || !error.message.includes('read-idle watchdog')) {
  fail(`the failure does not name the watchdog + budget: ${error.message}`);
}

// 3. retryability is the vendored policy's verdict, not this leg's string
const policy = resolveRetryPolicy(undefined, 'llm-chaos-read-idle: policy');
if (!policy.retryableCodes.includes('TIMEOUT')) {
  fail(`the vendored retry policy does not list TIMEOUT: [${policy.retryableCodes.join(', ')}]`);
}

console.log('chaos-read-idle: PASS {code: TIMEOUT, retryable: vendored policy, budget: '
  + `${IDLE_MS}ms, wire: slow-drip (deltas flowed, then silence)}`);
