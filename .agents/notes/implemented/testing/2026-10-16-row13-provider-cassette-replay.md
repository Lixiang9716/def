# Row 13: provider cassette replay — LLM contract quirks offline

Status: implemented
Related: test-coverage row 12 (the generative half)

## Problem

Row 12's fastcheck fuzz proves the SSE parser against ANY well-formed
generated stream, but generative streams cannot carry provider-specific
contract quirks — reasoning-piece conventions, usage chunks with empty
choices, mid-stream served-model substitution, CRLF proxies, connections
that close without [DONE]. Those quirks are exactly what breaks transports
in production, and nothing replayed them offline: every observed-shape
check lived in live quota-spending legs.

## Decision

`test/panel/fastcheck/provider-cassettes.test.mjs` plus nine recorded
fixtures under `test/panel/fastcheck/cassettes/*.json`. Each cassette
records one quirk byte-faithfully — its chunk array IS the recording, the
boundaries included (the mid-line split cassette pins a recorded cut
class) — and replays through the real `streamChat` seam (row 12's harness:
stubbed fetchImpl, chunked async-iterable body). Assertions cover the full
folded result (text/reasoning/counters/finishReason/served), the ordered
per-kind delta/reasoning index series, and the exact model-event count.

Provenance is a load-bearing field: every cassette names where its shape
comes from — a documented provider stream contract (GLM/DeepSeek/OpenAI
faces), observed proxy behavior (keep-alive comments, CRLF, no-[DONE]
close), or a recorded counterexample class (mid-line cut). No fixture
claims bytes we did not see; live-recorded cassettes can join the
directory as they are captured, provenance first.

## Alternatives considered

- Recording live provider bytes now: rejected for this row — it spends
  owner quota and hard-codes today's wire into the tree; the documented
  contracts pin the same quirks offline, and the provenance field lets
  real recordings land later without a schema change.
- Extending the mock-llm-server's script vocabulary: rejected — that
  drives the e2e scenario seat and its vocabulary is pinned by manifests;
  the quirks belong to the transport unit face where row 12 already lives.
- A separate vitest suite directory: rejected — the fastcheck runner is
  the transport-parser seat; the include grew from `*.test.js` to
  `*.test.js` + `*.test.mjs` to collect it (the .mjs spelling matches the
  panel spine suites).

Cadence: informational like row 12 — rerun on llm.js/transport changes
and when a new provider quirk is observed, never a gate.
