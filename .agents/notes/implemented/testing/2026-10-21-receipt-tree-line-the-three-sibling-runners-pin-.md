# Agent Note: the receipt tree line pins at run start in the three sibling runners

Status: implemented
Related: D0 (a receipt that cannot name the tree it proved is prose, not a
receipt), the 2026-10-20 note "upgrade-matrix receipt tree line pinned at
run start" (the class, the fix, and the named follow-up this lands), #569
(the false-dirty receipt that started it), plan §3.10

## Problem

The 2026-10-20 upgrade-matrix note fixed the receipt tree line for one
runner and named the remaining three: `hosts/android/ci/run-ble.sh` (was
line 151), `hosts/android/ci/run-device-plane.sh` (191),
`hosts/android/ci/run-session-persist-restart.sh` (161). All three computed
`TREE_LINE` immediately before the receipt heredoc, i.e. after their steps
had rewritten the committed evidence under `$OUT` — so `git diff-index`
always saw the runner's own rewrites and every in-place rerun stamped its
receipt dirty, whatever the seat's real state was. Same class, same
zero-information suffix as #569's.

## Decision

Each runner now computes `TREE_LINE` once at run start — right after the
output directory is created, before the build and every evidence write —
with the suffix wording ` (dirty working tree at run start)`; the
receipt-time line is gone. Placement mirrors the upgrade-matrix fix, so the
four runners of this receipt family now agree on the instant the line
describes.

The `origin/main <12-char sha>` literal stays as-is. #629's audit found 22
of 36 committed receipts whose sha is not on origin/main (it is the seat's
HEAD, not a reachability claim); renaming the literal to a branch name or a
bare sha would churn every consumer of the field for zero new information —
the label names the schema, the sha is the pin, and
`git merge-base --is-ancestor <sha> origin/main` resolves any doubt.

## Alternatives considered

- **Stamp the literal with the actual ref (`--abbrev-ref HEAD`)** —
  rejected: in a seat that is a feature branch name, which dies at
  squash-merge; the receipt would trade a truthful-but-odd label for a
  dangling one.
- **Re-run all three legs now to re-stamp their committed receipts** —
  not done in this change: two of the three drive native surfaces on an
  emulator and one refuses emulators outright (the device leg runs on
  hardware only). The code fix is the deliverable; each leg's next
  legitimate run re-stamps its receipt with a truthful line, and until then
  the 2026-10-20 note's reading guidance applies to their existing
  receipts.

## Consequences

In-place reruns stop lying dirty. A seat genuinely carrying uncommitted
source changes at run start still stamps the suffix — the case the line
exists for. Receipts produced between 2026-10-20 and this change still
carry the receipt-time read; read them with the class in mind until their
leg re-runs.
