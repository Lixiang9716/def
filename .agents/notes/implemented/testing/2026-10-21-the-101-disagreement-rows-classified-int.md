# Agent Note: the 101 disagreement rows classified into four classes

Status: implemented
Related: dsh-mobile#626 (the node:child_process shim masking — the class-a
signature), dsh-mobile#631 (the Node sweep driver that produced the honest
node column), plan §3.1 (this classification) and §3.2 (the fix the class
table scopes), the 2026-10-20 lsp-differential note (the root cause the
class-a signature comes from)

## Problem

#631's Node differential left 101 rows (681-spec tree, 2026-10-21 run)
marked `NO` — the two legs disagree — with no account of WHY. The raw
count is unusable for decisions: a harness artifact, a real runtime bug
and a spec demanding an ability the host honestly lacks all look
identically red. Plan §3.1 called for the classification: (a) harness
artifacts, (b) Node-face gaps, (c) real runtime deltas, (d) specs needing
Node-only abilities.

## Decision

Classified by a per-family workflow (one analyst per family reading both
legs' logs, an independent confirmer re-deriving every non-a verdict from
the logs alone, and a two-leg single-spec rerun — `node tools/test/sweep.mjs
--filter <stem>` — reproducing the original counts for every non-a row and
a deterministic sample of a-rows). 53 rows re-confirmed independently, 53
rows through the rerun gate, all reproducing. **Result: a 58 · b 15 · c 24
· d 4.**

| family | NO | a | b | c | d |
|---|---|---|---|---|---|
| llm | 10 | 9 | 1 | 0 | 0 |
| hooks | 9 | 9 | 0 | 0 | 0 |
| web | 8 | 1 | 0 | 7 | 0 |
| experimental | 7 | 5 | 2 | 0 | 0 |
| preset | 6 | 6 | 0 | 0 | 0 |
| session | 6 | 1 | 0 | 1 | 4 |
| shell | 6 | 6 | 0 | 0 | 0 |
| api | 5 | 1 | 3 | 1 | 0 |
| lsp | 5 | 4 | 0 | 1 | 0 |
| util | 5 | 3 | 0 | 2 | 0 |
| bundle | 4 | 4 | 0 | 0 | 0 |
| deliverables | 3 | 3 | 0 | 0 | 0 |
| test-support | 3 | 0 | 3 | 0 | 0 |
| compaction | 2 | 0 | 0 | 2 | 0 |
| host | 2 | 1 | 1 | 0 | 0 |
| sdk | 2 | 0 | 0 | 2 | 0 |
| skill | 2 | 2 | 0 | 0 | 0 |
| ssh | 2 | 1 | 0 | 1 | 0 |
| subprocess | 2 | 2 | 0 | 0 | 0 |
| terminal | 2 | 1 | 0 | 1 | 0 |
| webhook | 2 | 0 | 2 | 0 | 0 |
| acp / context / core / fs / goal / mcp / subagent / typert | 1 each | — | 1 each (context, subagent, typert) | 1 each (acp, core, fs, goal, mcp) | — |

- **Class (a) — 58 rows, the #626 blast radius.** Every one dies on the
  node leg before reaching the tested code: the `ERR_DSH_NO_SEAM` spawn
  signature, `Cannot find module` module-resolution deaths (node-pty,
  fixture package.json), or the missing qjs-side fixture seeding (the
  bundle/deliverables rows read fixtures the qjs leg's driver seeds and
  the node leg's smoke.mjs does not). These are the rows the §3.2
  `NODE_BUILTIN_PASSTHROUGH` fix is expected to flip; the re-baseline is
  a full two-leg rerun after it, not a per-row list.
- **Class (b) — 15 rows, the node leg's missing seams**, grouped by
  mechanism: no fixture seeding in smoke.mjs (bundle acp-app/sdk-app,
  context loader-composition, subagent preset-inheritance — the presets
  registry answers `available: none`); no web-storage globals
  (localStorage/sessionStorage — api bindings.client, experimental
  inspector); no fetch→loopback/route transport seam, so the node leg
  dials a real port and dies in `fetch failed`/`ECONNREFUSED` (api
  gateway ×2, host host-routes, test-support llm-mock-server, webhook
  ×2); no `__dshChildProcessNs`/`__dshProfileTmpdir` host intrinsics so
  the tsx face cannot stage (test-support loader-smoke ×2); the qjs
  node:module shim's resolve face lacks exports-entry semantics (typert
  loader — the one b-row where qjs fails and node passes); the shim
  Event vs native Event instanceof gate (experimental webworker
  source-chooser). These are node-leg capability work, NOT #626 — they
  survive the §3.2 fix and are the honest checklist for making the node
  reference leg a full peer.
- **Class (c) — 24 rows, the differential's actual value.** Both legs
  ran the assertions and genuinely disagree: acp turns (cancellation/
  admission timing), compaction ×2 (ManualCompactionError mapping and a
  cross-module-copy `instanceof` failure under Node), core config-session-id
  (poll timeout), fs read-image, goal resume semantics, lsp tool-lsp
  integration, mcp egress, sdk server ×2 (frame counts), session-log
  feedback (error vs stop finish), ssh helper-lifecycle (leaked helper
  allocations), terminal loader-composition, util http-proxy ×2 (proxy
  routing — the node leg exercises REAL undici), web ×7 (provider/egress
  behaviors — WEB_REDIRECT_BLOCKED vs WEB_PROVIDER_ERROR, probe capture
  empty), api terminal-controller terminal (qjs-side provider-seam gap).
  These are real qjs-host behavior gaps (or real node-reference
  behaviors) worth individual triage — the differential earning its keep.
- **Class (d) — 4 rows, tier-2 candidates**: all four
  session-persistence-jsonl reopen tests, which need the persistence
  worker (`worker.js`) — a worker-threads-class ability the qjs host
  declares unavailable by design; node passes, qjs answers honestly
  unavailable. They join the §3.3 `node:*` passthrough conversation as
  the known-shaped qjs-red/node-green set.

## Alternatives considered

- **Classify from the cells alone (no logs)** — rejected: the cells are
  counts; the class lives in the failure signature. Every analyst read
  both full logs.
- **One classifier for all 101 rows** — rejected: 29 families' logs
  would not fit one context, and per-family analysts keep judgments
  consistent within a family while the confirmer provides the
  cross-family check.

## Consequences

§3.2's fix lands with a re-baseline whose expected delta is exactly the
58 a-rows flipping (anything else flipping is a finding). The 15 b-rows
are the node leg's honest work list, owned nowhere yet — candidates for
a follow-up seat. The 24 c-rows graduate from "101 unexplained reds" to
named runtime deltas; triaging them is the differential's next payoff.
The 4 d-rows are recorded for the §3.3 tier-2 call. The rerun-gate
method (single-spec `--filter` reruns as the deterministic check) is
reusable for any future differential triage.
