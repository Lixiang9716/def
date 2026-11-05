# The WebGen-Bench port: a percentage benchmark for def's appgen

Status: implemented
Date: 2026-10-29
Class: feature
Related: doc/appgen-auto-research.md (§Ported), PR (this change), the 2026-10-28 auto-research-loop note (its "method donors" stance is narrowed, not superseded)

## Problem

The auto-research loop's first census reported pass/fail counts
(13/16 first-pass). The owner's bar is different: a benchmark reports
**percentage results** that the loop optimizes cycle over cycle — and the
donor benchmarks should be ported, not merely consulted. The direct-run
wall is real (WebCoderBench's 21/24 tooling metrics hang on HTML/CSS/JS a
JSON spec does not have; WebGen-Bench's 647 cases drive a browser over
websites; its dataset-closed sibling never shipped data), but that wall
blocks the HARNESS, not the corpus, the formula, or the diagnostics.

## Decision

- **The port** (`test/panel/appgen-bench/build-port.mjs` →
  `webgen-port.json`): 12 instructions / 74 test cases from the
  WebGen-Bench test corpus (101/647), balanced across the application
  types that map to a single-face mobile app. Test cases travel VERBATIM
  (task, expected_result, task_category); only the instruction is
  re-phrased def-native (capabilities preserved; color asks map to
  `theme.accent`). The benchmark's semantics remain the benchmark's.
- **The scorer** (`test/panel/appgen-bench-port.mjs`) runs the upstream
  formula verbatim at case level — `accuracy = (N_yes + 0.5 × N_partial)
  / N_total × 100%` — with the upstream diagnostics: start-failed
  (no valid spec → all its cases NO) and judge-failed (excluded from the
  denominator). Breakdowns per case category (Functional / Data Display /
  Design Validation) and per instruction; ledger committed under
  `tools/dev-web-carrier/artifacts/appgen-bench/`.
- **Execution tier v1 = spec-inspection judge**, deliberately
  different-family (generator deepseek-v4-flash, judge glm-4.6 — the
  WebCoderBench anti-self-preference practice). Grading contract: YES
  (content present AND an action delivers the operation), PARTIAL, NO —
  judged only from the spec, no invented capabilities. The
  action-execution leg upgrades this to real dispatch; that upgrade is a
  new tier with a new baseline ledger, never a silent re-score.
- The loop's optimization target on this axis is the accuracy percentage
  plus its three category percentages; cycle digests report deltas
  against the ported baseline ledger.

## Alternatives considered

- **Run WebGen-Bench's harness as-is** — rejected on artifact grounds:
  its WebVoyager GUI agent operates generated WEBSITES in a browser; def
  emits app-shell specs rendered on the phone surface. Nothing to point
  the agent at.
- **Wait for the action-execution leg before porting** — rejected: the
  static tier already measures the product against an external corpus
  with the external formula, and waiting would leave the loop optimizing
  pass/fail counts for weeks.
- **Rewrite the test cases into def-native phrasing** — rejected: it
  would bake my paraphrase into the benchmark's semantics and make
  cross-version comparisons unauditable. Cases stay byte-verbatim; only
  the instruction (the prompt fed to the generator) is ported.

## Consequences

- The program now has a real percentage benchmark: baseline ledger
  (deepseek-v4-flash × glm-4.6 judge) committed in this PR; every
  harness/prompt change re-runs it and reports the delta in points.
- The three-category breakdown (Functional / Data Display / Design
  Validation) tells the loop WHERE generation loses accuracy — the same
  triage shape as the census, now in the benchmark's own currency.
- Known limits, named: the def-domain subset is 12/101 instructions
  (11%) chosen for artifact fit, so the absolute number is NOT comparable
  to the paper's leaderboard figures — only intra-def deltas are.
