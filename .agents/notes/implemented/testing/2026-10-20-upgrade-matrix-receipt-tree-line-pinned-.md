# Agent Note: upgrade-matrix receipt tree line pinned at run start

Status: implemented
Related: D0 (receipts as the working discipline — a receipt that cannot
name the tree it proved is prose, not a receipt), #569 (the upgrade-matrix
leg whose receipt carried the self-inflicted dirty suffix), commit a1b25ee2
(the fix), test-hardening row 15 in `doc/test-coverage.md`

## Problem

Every Android evidence runner stamps its `receipt.json` with a `tree` line —
`origin/main <12-char sha>` plus a ` (dirty working tree ...)` suffix when
`git diff-index --quiet HEAD --` is non-quiet — so a reader can tell which
tree the evidence was produced from and whether that tree was the committed
one. `hosts/android/ci/run-upgrade-matrix.sh` computed that line immediately
before the receipt heredoc, i.e. at receipt time.

The runner's own evidence directory is COMMITTED: `logs.txt`,
`scenario.jsonl`, `verdict-android-session-persist-restart.json` and the two
screens live under `hosts/android/artifacts/upgrade-matrix/` in git. Steps
3-7 of the run rewrite every one of them in place (the logcat capture writes
`$OUT/logs.txt` from line 100, the view/grep at lines 182-184 regenerates
`logs.txt` and `scenario.jsonl`, the checker rewrites the verdict at line
189) and only then, at line 194, does the receipt get written. So by the time
the tree line was read, `diff-index` always saw the runner's own rewrites
and every in-place rerun was stamped dirty — whatever the seat's real state
was. The suffix therefore carried zero information: a genuinely dirty seat
and a pristine one produced the identical line.

The instance is in the history: #569's receipt (2026-10-17) read
`"tree": "origin/main 2f88739a5216 (dirty working tree at receipt time)"`
while the leg itself was green and the seat clean of anything but its own
evidence. A reviewer reading that receipt had to go and prove the negative.

## Decision

`TREE_LINE` is read once at run start — before build A, right after the SDK
discovery — and carried to the receipt (`hosts/android/ci/run-upgrade-matrix.sh`
line 69; the suffix now says ` (dirty working tree at run start)` so the
instant it describes is named in the text). The receipt thus pins the tree
the two builds actually came from, which is the only tree the proof is
about: the probe asset the runner materializes between the builds is
untracked and runner-owned (created before build A, removed before build B,
deleted on every exit path), the APKs are gitignored
(`.gitignore:321`, `hosts/android/artifacts/upgrade-matrix/*.apk`), and the
evidence rewrites happen after the pin. The 2026-10-20 rerun on this seat
reads `"tree": "origin/main e5f92b4931af"` with
`producedAt 2026-10-20T11:46:09Z` and `android.session-persist.restart`
46/46 — the first upgrade-matrix receipt whose tree line is literally true.

The sibling runners keep the receipt-time form for now and are NOT changed
by this seat: `hosts/android/ci/run-ble.sh` line 151,
`hosts/android/ci/run-device-plane.sh` line 191,
`hosts/android/ci/run-session-persist-restart.sh` line 161. Each of them
also rewrites committed evidence under its `$OUT` before the receipt, so
each carries the same false-dirty class; moving their `TREE_LINE` to run
start is the follow-up this note names, to be done per runner with a rerun
that re-stamps its receipt.

## Alternatives considered

- **Write the evidence to an untracked scratch directory and move it into
  `$OUT` after the receipt** — rejected. The receipt would then be produced
  away from the directory it describes: its `screens` and `scenarios` paths
  would point at files not yet where the e2e-matrix checker walks for them
  (`test/e2e/matrix.mjs` scopes to the `artifacts` segment), the two-phase
  move opens a window where a killed run leaves a receipt without its
  evidence or evidence without its receipt, and the restart leg this runner
  shares its manifest with writes in place — two conventions for one
  evidence family.
- **Accept the dirty annotation as a known artifact** — rejected. A suffix
  that fires on every run is indistinguishable from a seat with real
  uncommitted source changes, so the receipt loses the one thing its tree
  line exists to give: the pin to the tree that was proved. #569's receipt
  is exactly the record a future reader would have had to re-litigate.
- **Keep the receipt-time read but exclude `$OUT` from the diff
  (`git diff-index --quiet HEAD -- ':!<OUT>'`)** — rejected. It would hide
  genuine dirt under `$OUT` (a hand-edited verdict is precisely what a
  receipt must not launder), and it still measures the tree AFTER the run
  rather than the tree the builds came from; the semantically right instant
  is before build A, and reading it there needs no exclusion list.

## Consequences

The suffix still fires honestly when the seat carries uncommitted source
changes at run start, which is the case it was meant for. A tree edited
mid-run (between build A and build B) is not captured by the line — accepted:
the only mid-run tree delta is the probe, and the runner owns it. The three
sibling runners' receipts should be read with this class in mind until their
follow-up lands.
