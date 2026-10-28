# The appgen auto-improve round: the product prompt fix, measured

Status: implemented
Date: 2026-10-29
Class: feature
Related: doc/appgen-auto-research.md (§Boundaries — the owner's autonomous-improve grant; §Ported — the chain port), the 2026-10-28 loop note, PR (this change)

## Problem

The owner's 2026-10-29 mandate: port the benchmarks, run the loop, fix
the problems it finds, and update the harness/plugins/prompts
autonomously. The loop's own ledgers had already named the highest-
leverage problem: BAD_ACTION (action ids violating the id gate) was the
dominant census failure class and, under the one-shot port benchmark,
start-failures cost 2/12 instructions a 0%. Root cause on inspection:
**the product's operative prompt (the appshell_render tool description)
never stated the id grammar at all** — the validator enforces
`^[a-z][a-z0-9.:-]{0,63}$` but RULES only said "must be declared in
actions", no format, no examples. A second defect rode with it: the
benchmarks measured a harness copy of the prompt (SYSTEM_V1), not the
product's, so a product-side prompt fix would have been invisible.

## Decision

- **RULES single-sourced into the catalog** (`lib/catalog.js` exports
  `RULES`; `index.js` imports it): the catalog is already in the import
  graph (no new file, no staging-list tax) and is semantically the home
  of "authoring rules". The moved text gains the load-bearing sentence:
  ACTION IDS are dot.case ASCII matching the gate-4 grammar, with three
  examples and the explicit "labels may be Chinese; ids may not".
- **Actionable refusals** (`lib/validate.js`): every BAD_ACTION message
  now quotes the offending value and offers a compliant rewrite
  (`suggestActionId`: lowercase, invalid runes folded to '.', fallback
  `app.action`); the undeclared-action message names the id and the two
  repairs. The model — and any retry leg — can now repair what it can
  see.
- **SYSTEM_V2**: the benchmark prompt becomes the PRODUCT prompt — the
  frozen V1 schema/mechanics head + the catalog's RULES, imported, not
  copied. Runners take `APPGEN_SYSTEM` (V2 default; V1 kept for the
  V1-era ledgers); ledgers record the version; cross-version numbers
  never mix in one delta claim.
- **The chain port** (`test/panel/appgen-chain.mjs`, Web-Bench's shape):
  sequential dependent update tasks over one surface; payloads merge via
  the product's own `mergeUpdate` and must pass the four gates before
  the judge grades the task; a refused update scores NO and the chain
  continues from the last valid truth. Reports chain accuracy % and
  per-position decay — the backend-axis percentage benchmark.
- **Census percentage rollups**: the census ledger now carries
  `percentages: { structuralValid, constitution, alignment }` — the
  owner's bar is percentages, not pass counts.

## Alternatives considered

- **Put RULES in a new lib/rules.js** — rejected: a new plugin file
  changes the staging derivations and bundle counts for zero semantic
  gain; the catalog is the authoring-rules home already.
- **Make the validator AUTO-FIX offending ids instead of refusing** —
  rejected for v1: silent normalization would hide the failure from the
  model and the journal (fail loud, rule 5). The refusal now carries the
  repair; auto-fix is a future toggle if the refusal leg proves weak.
- **Re-score the old ledgers under SYSTEM_V2** — rejected: cross-version
  numbers never mix; the V2 run is a new baseline ledger.

## Consequences

- The benchmarks now measure the product prompt by construction —
  prompt improvements land in the next benchmark run with no harness
  edit (this was the named drift from the 2026-10-28 census note, now
  closed).
- The chain benchmark adds the backend/update axis the one-shot port
  could not see.
- Known measurement note: one census re-run failed wholesale (HTTP 400 —
  the launcher forgot `LLM_MODEL` and sent a GLM model name to the
  DeepSeek endpoint); the garbage ledger was deleted before any number
  was read, and the model-name requirement is now explicit in the cron
  prompt.
