# The appgen auto-research loop: census-driven harness improvement

Status: implemented
Date: 2026-10-28
Class: feature
Related: doc/appgen-auto-research.md (the runbook), PR (this change), the L3/M4/TTFT receipts it extends

## Problem

def's app-generation capability (dsh-appshell: prompt → app-shell spec →
four gates → A2UI/lynx render) is measured by three single-purpose probes
— the L3 benchmark (one prompt × 10, structural), the M4 cost ledger
(token/latency bars), the TTFT probe. None answers "where does generation
quality actually fail" or "did the last harness change make generation
better". The owner set the program: improve app generation (backend
interaction design + mobile frontend UI) through the harness, via an
automatic research loop whose first job is finding def's problems.

## Decision

- **The measuring leg**: `test/panel/appgen-eval.mjs` +
  `appgen-eval/prompts.json` (8 mobile-app archetypes × N runs) +
  `appgen-eval/system-prompt.js` (frozen, versioned prompt exports). Each
  run is judged by the product's own four-gate validator AND the
  machine-checkable half of the design constitution (rubric), with every
  failure class-coded and first-pass failures preserved across retries.
  Provider-neutral; ledgers committed under
  `tools/dev-web-carrier/artifacts/appgen-eval/`. Not a CI gate —
  family-change rerun per plan §3.5, driven by the loop.
- **The loop** (six steps: measure → triage → research → publish →
  improve → re-measure) runs on the host agent on a schedule (ZCode
  cron); cycle digests land as GitHub issues labeled `appgen-loop`.
  Optimization lands only as reviewed PRs on the named surfaces (RULES
  prompt, validate.js, catalog.js, renderer) — the loop never
  self-approves product changes.
- **External benchmarks are method donors, not imports**: WebGen-Bench's
  operate-and-assert shape (future action-execution leg), WebCoderBench's
  metric sheet (future visual leg), 1D-Bench's visual-feedback iteration,
  OpenHarmony Bench / Web-Bench as far-term corpus/shape donors. Their
  artifacts target HTML sites or native apps, not app-shell specs.
- **First census run** (deepseek-v4-flash, 8×2, committed ledger): the
  dominant structural failure class is `BAD_ACTION` — action ids
  violating the id gate exactly where prompts name commercial actions,
  with the ecommerce category unrecoverable in one pass (0/2 final); the
  validator's refusal echoes the regex but never names the offending id,
  so neither the model nor the retry leg can repair it. Improvement
  candidate #1 is actionable refusals.

## Alternatives considered

- **Import a benchmark wholesale** (WebGen-Bench or Web-Bench as the
  measuring leg) — rejected: wrong artifact type (HTML sites / native
  apps, not app-shell specs) and the four-gate validator is the product's
  own contract; patterns are borrowed instead.
- **Run a deep-research engine as the loop** (GPT-Researcher /
  open_deep_research services) — rejected: whole services with their own
  model plumbing for what is an in-process cycle; the dzhng recursive
  search-refine pattern is borrowed as the in-cycle procedure.
- **Auto-approve the improve step** (the loop lands its own prompt/gate
  edits) — rejected: release actions need explicit go; the improve step
  stays a normal reviewed PR.

## Consequences

- Every prompt/gate/catalog change can now show a delta in one ledger
  format across models; "did generation get better" is a number, not a
  vibe.
- The rubric covers the machine-checkable half of the constitution;
  aesthetic regressions are invisible to the census until the visual leg
  lands (named blind spot, next after the action-execution leg).
- Measurement hygiene is now enforced in code: latency samples after the
  body settles (the M4 ~30× header-time trap, re-bitten once during
  bring-up and recorded as a surprise), and surprising numbers get
  variance/nonce controls before being believed.
