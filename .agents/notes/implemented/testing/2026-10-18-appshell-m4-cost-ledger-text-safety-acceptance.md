# appshell M4: the cost ledger, the text-safety spot-check, and the acceptance table

Status: implemented
Date: 2026-10-18
Class: testing
Related: PR #582 (L2 + forged surfaceId), PR #585 (L4 browser leg), PR #586 (M3 numbers + incremental seam), plan `.zcode/plans/appshell-morph-plan.md` §M4/§3.5, T-0253

## Problem

M4 owed the program's last rows: the real-model cost ledger (morph P50 ≤3k /
P95 ≤5k, update P50 ≤1.2k, e2e ≤20s), the text-safety spot-check (`<`, `"`,
`onerror=` fields rendering 100% as plain text), the red-team tally (≥20
cases, six categories each ≥3), and the acceptance comparison table the
owner audits against.

## Decision

- **The safety leg** (`appshell.m4`, `run-appshell-m4.sh`): a hostile fixture
  lives carrier-side (`APP_SHELL_HOSTILE_TEXTS` — script tag, quote-break,
  onerror handler in EVERY text-bearing field) and is VALIDATOR-CLEAN on
  purpose — purity is the gate, not censorship. The browser leg proves the
  whole chain: timeline preview AND fullscreen surface render the hostile
  strings 100% VERBATIM with zero script/img elements and zero on*
  attributes. 4/4 milestones, registered evidence set.
- **The cost ledger** (`test/panel/m4-cost-benchmark.mjs` →
  `artifacts/appshell-m4/cost-ledger.json`): real glm-4.6, morph×10 + update×10,
  same L3 prompt for the morph tier (comparability), a screen-only update
  prompt for the incremental tier (validated through the M3 mergeUpdate seam
  over the carrier's wechat origin). Final numbers (one coherent full run):
  **morph 10/10, P50 2557 ✓≤3k, P95 4336 ✓≤5k · update 10/10, P50 1110
  ✓≤1.2k, payload P50 340B (51% of the full spec) · e2e: update 15.1s ✓≤20s,
  morph 33.6s ✗** — the morph latency is the same non-streaming physics the
  L3 ledger recorded as a miss at M1 (streaming TTFT / spec compression are
  the named candidates); recorded, not hidden.
- **The update prompt iterated three times** (measured): the naive
  "8-12 components" prompt produced 1.5-1.7k tokens with near-full payloads
  (77-94% of a full spec); the final four-component + hard-budget + exact-
  example prompt lands 1110 P50 with 10/10 validity. The knob the iteration
  surfaced: the INPUT side is a ~500-token floor — output discipline is the
  only lever left.
- **tools-face serialization**: the four dev-web-carrier browser tests
  (axe-sweep, morph, m3, m4-safety) each boot a carrier + real Chrome;
  vitest's default file parallelism made them contend and the morph retry
  window flaked (full-suite red, every file green alone). The face now runs
  `fileParallelism: false` — 107/107.

## The red-team tally (six plan categories, each ≥3)

| Category | Cases | Where |
|---|---|---|
| unknown components | 4 UNKNOWN_TYPE + 2 pseudo-template EXPAND_FAILED + 5 catalog hygiene + 1 client non-catalog | appshell-validate / appshell-catalog / appshell-core (webclient suite) |
| script & event attrs | 4 validator-inert (script/onerror/quote/markup) + 4 client hostile-verbatim + innerHTML/document.write source ban + 3-tier browser spot-check (fixture/preview/surface) | appshell-validate / webclient suite / appshell-m4-safety |
| oversized payloads | TEXT_TOO_LONG ×1 + SPEC_TOO_LARGE ×1 + NODE_OVERFLOW ×2 | appshell-validate |
| action escape | BAD_ACTION ×3 (undeclared/underscore/malformed) + ACTION_RE grammar | appshell-validate |
| nesting depth | DEPTH_OVERFLOW ×1 + EXPAND_FAILED depth-recursion ×2 | appshell-validate |
| forged-surfaceId update | forged+invalid-spec-first + missing/empty ×3 shapes + mock unknown-fixture + rejected-render-mints-nothing | appshell-surfaces |
| **total** | **≥35 rejection/inertness assertions, 100% red** | across three suites |

## The acceptance comparison table (plan §0 A1-A6, §M1-M4)

| Row | Bar | Result | Evidence |
|---|---|---|---|
| A1 generation | real model, validator-passing spec, log one-to-one | ✓ (L3 10/10 cumulative; L2 spine leg 14/14) | #578 L3 receipt; `runtime/dsh/artifacts/macos-cli-appshell-spec` |
| A2 render | in-place re-shell, carrier-reproducible | ✓ (three-theme morph, zero renderer edits) | `tools/dev-web-carrier/artifacts/appshell-morph` (#585) |
| A3 loop-back | spec interactions drive updates | ✓ (auto-apply seam; incremental contract) | `artifacts/appshell-m3` (#586) |
| A4 security | red team ≥20/six-classes 100% refused | ✓ (tally above; forged surfaceId closed) | suites + `artifacts/appshell-m4` |
| A5 cross-host | same spec on the second renderer | ✓ (genui v0.7.0 MessageProcessor 3/3) | #579, `test/panel/a2ui-genui-e2e.mjs` |
| A6 cost | morph ≤3k/≤5k · update ≤1.2k · e2e ≤20s | ✓ ✓ ✓ · update e2e ✓ · **morph e2e ✗ (33.6s, non-streaming physics — recorded miss, streaming TTFT the candidate)** | `cost-ledger.json` |
| M3 numbers | ≤50ms / ≤15s / ≤40% / DOM parity | ✓ 0.1ms / 855ms (mock) / 32.3% / 8-8 zero-stale | `artifacts/appshell-m3` |

Owner's call remains on the two recorded misses (both physics-of-transport,
both named with candidates) and on the boot-level plugin mount (deferred at
L2 — the scenario-side mount is the standing shape).

## Alternatives considered

- **Gate the ledger's verdict on the e2e latency bars** — rejected: a red
  verdict would misstate a transport-physics finding as a product failure;
  the bars record per-row truth instead (3 of 5 green, 2 misses named).
- **Iterate the update prompt a fourth time** — stopped at three: the input
  floor (~500 tokens) plus the 1110 P50 leaves ~600 output tokens; further
  shaving risks the validity rate (iteration 2 already dipped to 8/10).
- **Put the hostile fixture behind a validator rejection** — rejected: the
  point under test is the rendering chain with a payload that LEGALLY rides
  it; a rejected spec would prove the validator, not the renderer.

## Consequences

- The M2-M4 closeout program is complete: every plan row has committed,
  re-runnable evidence or an honestly recorded miss with a named candidate.
- The cost ledger reruns with `node test/panel/m4-cost-benchmark.mjs`
  (.env credentials; `M4_TIER`/`M4_N` knobs read the process env).
- Browser legs now serialize in the tools face — a fifth browser test would
  lengthen the face, not break it.
