// dsh:logging-exempt (node-side driver: its stdout IS the product — the
// runner reads the endpoint announce + mock telemetry from it)
/**
 * mock-llm-server.mjs — node-side lifecycle for the VENDORED upstream
 * dsh-llm-mock-server (the E2E test vehicle for the gateway LLM transport).
 *
 * The upstream mock is a real NODE package (node:http) — it runs node-side,
 * outside quickjs, exactly like a desktop dev-loop mock. The runner script
 * (run-upstream-e2e.sh) starts this driver, waits (condition-polled, with a
 * deadline) for the MOCK_BASE_URL line on stdout, points the CLI scenario at
 * it through --env, and kills it at exit. Stdout carries exactly two kinds of
 * lines: the MOCK_BASE_URL=... announce and one JSON line per accepted
 * request (the mock's onEvent telemetry) — diagnostics, not the E2E stream
 * (the checker only reads the CLI's stdout).
 *
 * Script: two behaviors, consumed in order — 'success' for the agent-loop
 * turn (SSE stream of successText 'Hello from upstream', chunked at 5 chars,
 * terminal chunk with finish_reason + usage, then [DONE]) and 'auth_error'
 * for the transport-error leg (401 JSON error body → the adapter's structured
 * AUTH diagnosis). The bearer key must match the adapter's authorization
 * header (wire evidence that the credential path is exercised).
 *
 * CHAOS PROFILES (test-hardening row 1, doc/test-coverage.md): DSH_MOCK_CHAOS
 * names a hostile preset. A profile is ONLY a parameterization of the
 * VENDORED mock's own script vocabulary — the SSE bytes on the wire stay the
 * vendored server's (the one invariant: wire shape identical to the real
 * backend; the hostile behavior is the only difference, and it lives only
 * here, never in the transport or gateway code):
 *
 *   truncation     'stream_eof'        — 200 + one SSE frame, then a clean
 *                                      close WITHOUT [DONE]; the transport's
 *                                      parser must answer STREAM_CLOSED
 *                                      (a truncated stream cannot be trusted)
 *   slow-drip      'slow_success'      — the success stream paced at
 *                                      DSH_MOCK_CHUNK_DELAY_MS; with the gap
 *                                      over the reader's read-idle budget the
 *                                      attempt dies TIMEOUT mid-drip
 *   malformed-sse  'malformed_json'    — one non-JSON `data:` payload; the
 *                                      parser must answer MALFORMED_RESPONSE
 *   oversized      'success' with a    — ONE SSE frame whose delta carries
 *                  2 MiB single delta   the whole text; the byte bridge and
 *                                      parser must carry it and the turn
 *                                      completes
 *   no-headers     'connection_reset'  — accept, then destroy the socket with
 *                                      ZERO response bytes (no status line,
 *                                      no headers); the call fails fast →
 *                                      TRANSPORT → the retry-pacing seam
 *
 * The presets ride the mock's public options (sequence / chunkDelayMs /
 * successText / chunkSize) — never an edit of the vendored package (D6).
 * DSH_MOCK_SUCCESS_TEXT / DSH_MOCK_CHUNK_SIZE expose the same two knobs for
 * drivers that want them without a named profile. An unknown profile name is
 * a defect now (rule 5), not a silently normal mock.
 *
 * MALFORMED TOOL-ARGUMENT PROFILES (test-hardening row 23, doc/test-coverage.md):
 * DSH_MOCK_TOOLARGS names a hostile SHAPE for the `tool_call_success` scripted
 * call's arguments — an independent env key from DSH_MOCK_CHAOS (that one owns
 * the transport wire; this one owns the tool-argument payload). Every profile
 * is schema-valid JSON at the mock boundary (the vendored server refuses to
 * start otherwise) and SEMANTICALLY invalid for the named tool's parameter
 * schema, so the rejection contract under test lives entirely in the harness
 * validation layer, never in a hand-broken wire:
 *
 *   type-error     '{"todos":42}'                    — a number where the
 *                    schema wants an array; the validator answers a
 *                    path-qualified type violation
 *   missing-field  '{"todos":[{"status":"pending"}]}' — the item's required
 *                    `content` property is absent; the validator answers
 *                    `missing required property`
 *   deep-nesting   a 2048-deep nested array at todos[0] — parses fine,
 *                    then hits the schema's object constraint; the vendored
 *                    validator walks explicit frames (no recursion), so the
 *                    depth must not crash or overflow anything
 *   oversized      a single 2 MiB string at `todos` — reassembled across the
 *                    mock's two-delta split, carried end to end, then rejected
 *                    on type (length-pinned, never logged)
 *
 * Each profile arms sequence `tool_call_success success` (tool round → closing
 * text, so the turn COMPLETES after the rejection — the no-crash witness) and
 * toolName `todo_write` (the vendored tool-todo schema the legs validate
 * against). Explicit DSH_MOCK_SEQUENCE / DSH_MOCK_TOOL_ARGS still win over
 * the preset. DSH_MOCK_CHAOS and DSH_MOCK_TOOLARGS are mutually exclusive —
 * arming both is a defect now (rule 5). An unknown profile name is a defect
 * now (rule 5), not a silently normal mock.
 *
 * usage: node mock-llm-server.mjs
 */
import { startMockLlmServer } from '../../../external/dsh/llm-mock-server@0.1.6-alpha.2/lib/index.js';

// DSH_MOCK_SEQUENCE (space-separated) and DSH_MOCK_REPEAT_LAST=1 override the
// script for drivers that need more successes (the W-INTEG web-boot drive
// streams two turns through the journal): defaults keep the m2 script intact.
// DSH_MOCK_TOOL_NAME / DSH_MOCK_TOOL_ARGS shape the `tool_call_success`
// behavior's scripted tool call (the parity drive points it at todo_write
// with schema-valid arguments); defaults keep the upstream mock's own.
let sequence = (process.env.DSH_MOCK_SEQUENCE ?? 'success auth_error').split(/\s+/);
const repeatLast = process.env.DSH_MOCK_REPEAT_LAST === '1';
// DSH_MOCK_CHUNK_DELAY_MS paces the success stream's deltas (0 = the default
// instant wire): the mid-turn kill leg (session-persist-midturn) needs the
// stream PROVABLY still open when the runner kills the process — a delay the
// runner's kill window is sized against, not a sleep hoping the state arrives
// (the delay IS the scripted model's pacing, the device seat's SLOW_TURN twin).
const chunkDelayMs = Number(process.env.DSH_MOCK_CHUNK_DELAY_MS ?? 0);
// The expected bearer (the wire-evidence check). Drivers that audit a
// credential's leak surface (security.byok-leak) point this at THEIR canary
// so the real value is the one the mock demands; the default keeps every
// existing leg byte-compatible.
const apiKey = process.env.DSH_MOCK_LLM_KEY ?? 'mock-key-0001';

// ---- chaos profiles (preset table above) ----------------------------------
// Each entry only picks vendored script behaviors and content knobs; the
// `chaos` announce line tells the runner which preset actually armed.
const CHAOS_PROFILES = {
  'truncation': { sequence: ['stream_eof'] },
  'slow-drip': { sequence: ['slow_success'] },
  'malformed-sse': { sequence: ['malformed_json'] },
  // 2 MiB of text in ONE delta: splitText(text, chunkSize) yields exactly one
  // frame, so the wire carries one oversized SSE payload end to end.
  'oversized': {
    sequence: ['success'],
    successText: 'x'.repeat(2 * 1024 * 1024),
    chunkSize: 2 * 1024 * 1024,
  },
  'no-headers': { sequence: ['connection_reset'] },
};
const chaosName = process.env.DSH_MOCK_CHAOS;
const chaosPreset = chaosName === undefined ? undefined : CHAOS_PROFILES[chaosName];
if (chaosName !== undefined && chaosPreset === undefined) {
  throw new Error(
    `mock-llm-server: unknown DSH_MOCK_CHAOS profile ${JSON.stringify(chaosName)} `
    + `(want one of ${Object.keys(CHAOS_PROFILES).join('|')})`);
}

// ---- malformed tool-argument profiles (preset table above) -----------------
// The oversized profile's scripted text length must match scenario/llm-chaos.js
// (OVERSIZED_TOOLARGS_LENGTH) and the manifests' pinned argsLength values.
const TOOLARGS_DEPTH = 2048;
const TOOLARGS_OVERSIZED_LENGTH = 2 * 1024 * 1024;
const TOOLARGS_PROFILES = {
  'type-error': { toolArguments: '{"todos":42}' },
  'missing-field': { toolArguments: '{"todos":[{"status":"pending"}]}' },
  // 2048 nested brackets at todos[0]: JSON-parses everywhere, then the schema's
  // object constraint rejects it — the validator's explicit-frame walk (no
  // recursion) is what must survive the depth.
  'deep-nesting': {
    toolArguments: `{"todos":[${'['.repeat(TOOLARGS_DEPTH)}${']'.repeat(TOOLARGS_DEPTH)}]}`,
  },
  'oversized': { toolArguments: `{"todos":"${'x'.repeat(TOOLARGS_OVERSIZED_LENGTH)}"}` },
};
const toolargsName = process.env.DSH_MOCK_TOOLARGS;
const toolargsPreset = toolargsName === undefined ? undefined : TOOLARGS_PROFILES[toolargsName];
if (toolargsName !== undefined && toolargsPreset === undefined) {
  throw new Error(
    `mock-llm-server: unknown DSH_MOCK_TOOLARGS profile ${JSON.stringify(toolargsName)} `
    + `(want one of ${Object.keys(TOOLARGS_PROFILES).join('|')})`);
}
if (chaosPreset !== undefined && toolargsPreset !== undefined) {
  throw new Error('mock-llm-server: DSH_MOCK_CHAOS and DSH_MOCK_TOOLARGS are mutually exclusive '
    + '(the transport wire and the tool-argument payload do not co-arm)');
}
if (toolargsPreset !== undefined) {
  // The preset fills what the env leaves open; explicit DSH_MOCK_SEQUENCE /
  // DSH_MOCK_TOOL_ARGS win (same rule as the chaos presets above).
  if (process.env.DSH_MOCK_SEQUENCE === undefined) sequence = ['tool_call_success', 'success'];
}
const toolName = process.env.DSH_MOCK_TOOL_NAME ?? (toolargsPreset !== undefined ? 'todo_write' : undefined);
const toolArguments = process.env.DSH_MOCK_TOOL_ARGS ?? toolargsPreset?.toolArguments;
if (chaosPreset !== undefined && process.env.DSH_MOCK_SEQUENCE === undefined) {
  // Explicit DSH_MOCK_SEQUENCE wins over the preset (a driver that needs a
  // longer script keeps working); the preset fills what the env leaves open.
  sequence = chaosPreset.sequence;
}
let successText = process.env.DSH_MOCK_SUCCESS_TEXT ?? 'Hello from upstream';
let chunkSize = Number(process.env.DSH_MOCK_CHUNK_SIZE ?? 5);
if (chaosPreset?.successText !== undefined) {
  successText = chaosPreset.successText;
  chunkSize = chaosPreset.chunkSize;
}

const handle = await startMockLlmServer({
  host: '127.0.0.1',
  port: 0, // OS-assigned; announced below (no fixed port races)
  sequence,
  repeatLast,
  successText,
  chunkSize,
  chunkDelayMs,
  apiKey,
  requestId: 'mock-req-1',
  ...(toolName !== undefined ? { toolName } : {}),
  ...(toolArguments !== undefined ? { toolArguments } : {}),
  onEvent: (event) => console.log(JSON.stringify(event)),
});
console.log(`MOCK_BASE_URL=${handle.baseURL}`);
if (chaosName !== undefined) console.log(JSON.stringify({ type: 'chaos', profile: chaosName, sequence }));
if (toolargsName !== undefined) {
  // length only — the hostile arguments themselves are never logged
  console.log(JSON.stringify({
    type: 'toolargs',
    profile: toolargsName,
    toolName,
    argsLength: toolArguments.length,
    sequence,
  }));
}

const close = () => {
  handle.close().then(() => process.exit(0));
};
process.on('SIGTERM', close);
process.on('SIGINT', close);
// keep the event loop alive waiting for the CLI's request
setInterval(() => {}, 3600000).unref?.();
