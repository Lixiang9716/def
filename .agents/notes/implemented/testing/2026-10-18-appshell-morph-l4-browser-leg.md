# appshell.morph: the L4 browser leg lands as a registered evidence dir

Status: implemented
Date: 2026-10-18
Class: testing
Related: PR #576 (the morph test file + carrier-synthesized cards), PR #582 (the real-plugin L2 leg + surfaceId), plan `.zcode/plans/appshell-morph-plan.md` §3.5/§8, T-0251

## Problem

The plan owed L4: the `appshell.morph` browser leg with two verdict rows —
DOM component-node count == the spec's expanded tree (100%, templates per the
expanded tree), and console error == 0 — as a one-command local leg with a
repo-verifiable artifact. The raw material existed since #576
(`tools/dev-web-carrier/appshell-morph.test.mjs` rides the tools vitest glob,
so it even runs in CI), but nothing proved the DOM=spec row, and no
registered evidence existed: the leg had no scenario id, no manifest, no
runner, and no receipt — "the morph test passed" was a vitest exit code,
not an inventory-recorded verdict.

## Decision

- **The DOM=spec parity is now a triple-checked assertion per theme**: the
  test derives the spec from the SAME `appShellScriptFor` the carrier's turn
  machine plays (newly exported from next-mode.mjs — never a re-typed copy),
  expands it with the PLUGIN validator (`system-plugins/dsh-appshell/lib/
  validate.js`) AND the client core (`appshell-core.js`) — asserting the two
  expanders' promised lockstep — and then counts the live page's rendered
  primitive elements (every spec primitive carries exactly one `ash-*` class;
  progressbar counts its track, the tabbar is chrome, the unrendered screen
  root is subtracted). 32/32/32 across the three themes.
- **Milestone events** (`DSH_MORPH_EVENTS_FILE`): every completed assertion
  step appends one JSON line under scenario `appshell.morph` — 23 rows,
  pinned one-to-one by `test/e2e/scenarios/appshell-morph.json`; inert
  without the env var (plain vitest/CI runs write nothing).
- **The formal leg**: `tools/dev-web-carrier/run-appshell-morph.sh` — one
  command installs the tools face's deps if absent, runs the suite, verifies
  the milestone one-to-one count against the manifest (drift exits red with
  a diff), and lands the registered evidence set (verdict/logs/scenario/
  receipt) under `tools/dev-web-carrier/artifacts/appshell-morph/` — a clean
  evidence dir in the e2e-matrix walk (verdict+manifest+deliverables all
  check out; no known-gap row needed).
- **Carrier echo parity**: next-mode.mjs's synthesized appshell_render result
  now carries `surfaceId: dev-app-<turn>` — the #582 plugin echo shape, so
  the browser leg's wire matches what a real spine returns (the test pins it).
- e2e-matrix doc gains the 2026-10-18 Currency note (both appshell legs;
  132/252/247 on this tree), pairing re-confirmed.

## Alternatives considered

- **Feed the milestone stream through check.mjs like the CLI legs** —
  rejected: check.mjs matches `dsh.runtime.log:` prefixed JSON from a
  captured process log; the browser leg's record is assertion-completion,
  not a log stream. The one-to-one counting lives in the runner, the
  manifest stays the contract, and the matrix reads the landed verdict.
- **Count the DOM with a prefixed selector list** (`#appshell-root .a,.b,…`)
  — measured trap, not taken: in a CSS selector LIST the prefix binds only
  the first comma-arm; the rest match document-wide and the count silently
  swallows the timeline preview cards' 18 non-text elements (50 vs 32). The
  assertion scopes from the root ELEMENT instead — and the buggy form's
  failure is itself the rejection evidence for the parity row's teeth.
- **Commit screenshots per run** — rejected: screenshots are local evidence
  by the repo's E2E-by-logs law; the ui-sweep baselines are static diffs,
  a different concern.

## Consequences

- L4's two verdict rows are recorded artifacts, not vibes; the remaining
  M2-M4 debts are the measurement set only: M3 numbers (≤50ms local /
  ≤15s loop / incremental ≤40%) and M4 cost ledger (morph/update P50/P95,
  e2e ≤20s) — both now have their carrier (this leg + the L2 spine leg),
  plus the text-safety spot-check table.
- The morph leg re-runs refresh logs.txt (timestamps/paths) — the accepted
  churn convention of every committed evidence dir.
- The action-loopback milestone fires for all three themes (every carrier
  spec carries a mini-player action button); the wechat "no button" comment
  in the old test was stale defensive prose, removed with the rewrite.
