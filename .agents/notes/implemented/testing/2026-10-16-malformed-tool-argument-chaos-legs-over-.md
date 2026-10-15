# Agent Note: Malformed tool-argument chaos legs over the harness validation layer

Status: implemented
Related: D6

## Problem

The transport-chaos legs (row 1) proved the SSE guard layer over a hostile
wire, but nothing exercised the NEXT layer in: what the harness does when the
model's tool-call ARGUMENTS are hostile. A real backend can stream tool calls
whose arguments are the wrong type, miss required fields, nest absurdly deep,
or arrive oversized — and the only thing standing between such a payload and
arbitrary tool-body execution is the schema validation layer
(`@deepseek-ai/dsh-tools` `defineTool`'s execute-time walk). That rejection
contract had no end-to-end evidence: no leg proved the rejection is STRUCTURED
(not a crash), that a rejected call never fails the turn, and that the tool
body never partially executes behind the rejection.

## Decision

`ci/mock-llm-server.mjs` grows `DSH_MOCK_TOOLARGS` — an independent env key
from the chaos seat's `DSH_MOCK_CHAOS` (transport wire vs argument payload;
arming both is a loud defect) — naming four hostile SHAPES for the vendored
mock's scripted tool call: `type-error`, `missing-field`, `deep-nesting`
(2048-deep), `oversized` (2 MiB). Every profile is JSON-valid at the wire (the
vendored server refuses to start otherwise) and schema-invalid for
`todo_write`, so the leg exercises the real validation layer, never a
hand-broken wire — the vendored packages stay untouched (D6).
`scenario/llm-chaos.js` grows the matching `toolargs-*` profile family and
asserts, over the REAL agent loop: the journal's tool/result carries
`isError: true` + the `ToolArgsError` name + the `INVALID_ARGS` code with the
`Error: invalid arguments` diagnostic prefix (structured rejection); the turn
still completes on the scripted closing text with zero retries (no crash);
the todos projection stays at its pre-first-write null and the journal records
no `todo/write` (no partial side effects). A new `ci/run-llm-toolargs-e2e.sh`
drives one fresh hostile mock per profile and verifies each leg one-to-one
against `test/e2e/scenarios/llm-chaos-toolargs-*.json`; the runner is wired
into `build/build.sh test core` so CI (c-core) owns it.

## Alternatives considered

A separate scenario file (`llm-toolargs.js`): rejected — the boot, journal
walk, and manifest machinery are identical to `llm-chaos.js`; a second file
would duplicate ~250 lines to carry one `if`. Breaking the vendored mock's
JSON-validity rule to arm truly unparseable arguments: rejected — it needs a
vendored edit (D6) and the parseArguments fallback (invalid JSON preserved as
text) is already upstream-owned behavior with its own unit coverage. Asserting
only "the turn did not crash" without the INVALID_ARGS/code and todos-null
witnesses: rejected — a vacuous pass would survive a regression that rejects
by exception-swallowing or executes the tool body anyway. Reusing
`DSH_MOCK_CHAOS` with new profile names: rejected — that key's semantics
(transport wire profiles) belong to the chaos seat's item; a shared namespace
would couple two parallel work streams' manifests.
