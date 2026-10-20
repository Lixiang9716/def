# the verification registry gets a query face — known flakes retry in-step

Status: implemented
Date: 2026-10-20
Class: testing
Related: surprise:the-appshell-morph-tools-face-tests (.gov/surprises.jsonl —
the tools-face carrier-page 15s tab-switch timeout, second occurrence #609),
#515 (the environment-verdict precedent for honest retries), the
dev-harmonyos for-attempt precedent, rule 11 (third recurrence = process
defect)

## Problem

Two standing taxes, both paid repeatedly:

**The archaeology tax.** The verification legs' ground truth is scattered
across runners, workflows, and docs, and three sessions independently
re-dug the same answers: does the upstream sweep's count come from the qjs
leg or the node differential (and why is the differential dead — the
dsh-subprocess-local/index exports gap that kills the lsp-stdio family at
module load)? what happened to run-ios-m1.sh (renamed run-ios-boot-carrier.sh
on 2026-10-20)? where does the harmony host E2E actually run on Windows
(WSL driving hdc.exe)? Each answer exists in the tree — doc/e2e-matrix.md,
the runners' headers, doc/windows-test-plan.md — but nothing answers
"which leg counts, and where is the evidence?" in one query. Three sessions
stepping on the same rake is the rule-11 threshold: the process, not the
person, needed to change.

**The flake rerun tax.** The tools-face CI suite's appshell-morph leg races
a real carrier boot under runner load and has now timed out twice on the
same signature (`carrier-page: timed out after 15000ms waiting for the
local tab switch`) — both times red-on-arrive, green on a rerun, with local
runs 111/111 green. Today the only remedy is a run-level `gh run rerun`,
which is the worst possible shape: ci-verdict does not follow the rerun,
and the rerun re-executes the entire gate DAG before the flaky step even
starts — a two-stage tax paid in full for one 15s race.

## Decision

- **`test/verifications.mjs`** — the verification registry and its query
  CLI. One table registers each leg with only confirmed facts: countsFrom
  (which leg the counts answer on), live/dead legs with reasons, the
  artifact flatten rule, where it runs, where the evidence lives. Today it
  registers four entries — `upstream-sweep` (counts from the qjs leg; the
  node differential is dead with its reason named), `ios-boot-carrier`,
  `panel`, `harmony-host-e2e` — and grows as the unified test driver lands.
  `--list` prints one line per entry; `--why <name | artifact-stem>` prints
  the counting leg, dead legs with reasons, and evidence paths;
  `--resolve <tests-tree-relative-path>` prints the flattened artifact name
  (entries without a resolve function don't answer; a path none claim lists
  the ones that do). Unknown names fail loud naming the offender, exit 1
  (rule 5).
- **`.github/flakes.json`** — the known-flake debt register. A row is a
  signature + suite + owner ref (the surprise-ledger sig) + added/expires
  dates + maxRetries. Debt, not absolution: the ref keeps the failure
  countable, the expires date forces a review, and the row is removed when
  the flake is fixed.
- **`tools/test/flake-retry.mjs`** — ONE in-step retry. Runs the child with
  output captured and replayed verbatim (the step's product is
  byte-identical to a bare run); on failure, a registered signature in the
  complete output buys exactly maxRetries more attempts. Both the retry and
  a green-on-retry emit `::warning::` annotations — visibility never drops;
  a flake fixed by a retry still shows on the run. The exit code is always
  the final attempt's. No registry, empty registry, or non-matching failure
  is plain pass-through; a malformed registry fails loud (rule 5) rather
  than silently disabling retries.
- **`.github/workflows/gov.yml`** — the tools-face vitest step wraps its
  runner: `node tools/test/flake-retry.mjs -- sh tools/test/run-tools-tests.sh`,
  so the step (not a checker, not the run) owns the retry loop — the
  dev-harmonyos for-attempt precedent — and ci-verdict only ever sees the
  final attempt.

## Alternatives considered

- **Run-level `gh run rerun`** — rejected: ci-verdict does not follow the
  rerun, and the rerun re-pays the full gate DAG (the two-stage rerun tax)
  before reaching the one flaky step — measured this session on the
  appshell-morph red. An in-step retry pays one step, once, and the
  annotation keeps the flake visible either way.
- **No registry, permanent manual** — rejected: three sessions independently
  re-dug the same three answers (the node-differential death, the
  run-ios-m1 rename, the WSL hdc.exe path). The third recurrence is a
  process defect (rule 11); the registry converts the archaeology into a
  query.

## Consequences

- The registry is the seed of the unified test driver: entries gain resolve
  functions and the driver executes over the same table.
- flakes.json rows are visible debt: green-on-retry still annotates the run,
  the surprise sig accumulates occurrences, and an expired row is a review
  trigger — pruning it is a human act, never the wrapper's.
- The tools-face suite's runtime gains a second attempt only when the
  registered signature actually appears; every other failure path is
  byte-identical and exactly as fast as before.
