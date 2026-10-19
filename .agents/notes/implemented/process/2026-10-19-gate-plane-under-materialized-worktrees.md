# Agent Note: the gate plane under materialized worktrees — excludes and the live-tree lock deadline

Status: implemented
Related: #348 (path exclusions), #443 (rejection-case SIGKILL budget),
rules.md rule 6, worktree-workflow (materialize before judging)

## Problem

A materialized worktree — the state the worktree-workflow skill requires
before judging any gate — changed the gate plane's operating envelope:

1. Content gates that walk untracked files meet ~250 MB of sha256-pinned
   upstream bytes (`external/{dsh,npm,quickjs-ng,wasm3,zstd,node_modules}`,
   `external/dsh-tests@*`, `presentation/official-web/{dist,client-bundles}`).
   These are vendored-verbatim upstream (D6: never modified in place) and
   untracked, so CI never sees them — but a local gate run judges them
   pointlessly, and the judgment time lands inside fixed gate budgets.
2. The live-tree rejection-case family serializes on one worktree lock;
   measured solo (2026-10-19) each member holds it 1.2–4.7 s. Under the
   full DAG's concurrency the queue stretched past
   `case-staging-generated-webclient-leak`'s 5 s lock deadline, failing
   runs whose own mutation window still fit the 10 s SIGKILL budget. Three
   full-DAG runs produced three different budget-boundary failure subsets
   while every gate passed solo — pure throughput contention, no defect.
3. `case-transport-tokens.sh` ran lock-free by a measured exemption ("the
   mutation is one inert comment line … nothing flips verdicts") authored
   on an un-materialized tree. On this tree the exemption is falsified:
   its checker's green leg raced a sibling's window in three consecutive
   full-DAG runs ("the restored tree still fails") while passing solo
   every time — the green leg reads sibling-scanned bytes and is not
   window-safe.

## Decision

- The vendored/pinned untracked trees are declared in
  `.gov/checks/exclude.json` — #348's mechanism, whose own contract names
  this exact case ("vendored upstream trees pinned verbatim by project
  rule, where an in-file marker would edit forbidden bytes"). Every entry
  carries its reason; excluded matches surface as SKIP(excluded: ...) with
  counts, so the narrowing is counted, never invisible.
- `case-staging-generated-webclient-leak.sh`'s lock deadline moves from 5 s
  to 60 s — `case-staging-check.sh`'s existing value — so the runner's
  10 s SIGKILL is the only bound that kills; a moderate lock queue no
  longer fails a run whose window fits its budget.
- `case-transport-tokens.sh` joins the live-tree lock family for its whole
  window (inject → red leg → restore → green leg), with the family's 60 s
  deadline and #443 leak recovery; its mutation stays exactly as inert as
  documented. What changed is not the mutation's neutrality but the green
  leg's immunity claim: only lock-held windows are now serialized against
  it, which is the discipline every other window-breaking case already
  follows.

## Alternatives considered

- Narrowing the gates' own enumeration to tracked files: already true where
  it matters — `tools/check-shellcheck-warn.sh` enumerates via
  `git ls-files '*.sh'` (measured: its surface is identical with and
  without the materialized trees), so there was nothing further to narrow.
- Keeping the 5 s deadline: converts moderate lock contention into a
  lock-failure the 10 s SIGKILL budget would have passed; the deadline was
  authored against sub-second windows and un-materialized trees.
- Lowering the DAG's `concurrency` (gates.json, project-owned, 4): a
  throughput-for-stability trade owned by the machine budget, not a fix —
  left untouched and reported instead.
