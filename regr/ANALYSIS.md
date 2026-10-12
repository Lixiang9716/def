# ANALYSIS — seat `regr`

Seat `/Users/lixiang/workspace/dsh-mobile-regr` (branch `feat/release-regression-final`, HEAD
`b1297c80`) carries exactly one dirty path — a 2-line append to the `.gov/surprises.jsonl`
surprise ledger whose two entries are missing from both `origin/main` (`98869dd1`) and local
`main` (`1b3b31cf`) — so the seat is safely demolishable once those 2 ledger lines are salvaged.

Per-file verdicts (rule from the runbook: `git diff origin/main -- <path>` non-empty + `.gov/`
prefix ⇒ `ledger-residue`):

| path | verdict | note |
|---|---|---|
| `.gov/surprises.jsonl` | ledger-residue | Raw diff vs `origin/main` is non-empty (217 KB, whole-file hunk due to a CRLF-vs-LF mismatch, not content); after normalization the only seat-side delta is 2 surprise-ledger entries (`281-reported-mergeableconflicting-rebasing`, `push-the-branch-triggers`, ts 2026-09-30T16:47:19+00:00) absent from both origin/main and local main — preserved verbatim in `SALVAGE-NOTES.md` and as the diff in `tracked.patch`. |

Untracked files: **none** (`git status --porcelain --untracked-files=all` shows only the one
modified tracked path) — nothing was copied into this archive under step 2, and no >5 MB /
vendor-artifact exclusions applied.

Checks actually run this session:
- `git -C <seat> status --porcelain` and `--untracked-files=all` → ` M .gov/surprises.jsonl` only.
- `git -C <seat> diff HEAD > tracked.patch` → 10-line patch, 2 insertions.
- `git -C <seat> diff origin/main -- .gov/surprises.jsonl` → non-empty (persisted 217 KB output).
- `git -C <seat> show origin/main:.gov/surprises.jsonl` vs worktree, CRLF-normalized →
  seat-only lines = the 2 above; main-only lines = 65 post-merge appends (main wins, no salvage).
- Local `main` (`1b3b31cf`) blob cross-checked: neither sig present.

Note: seat HEAD is not an ancestor of origin/main/local main — expected, since this repo
squash-merges PRs (the ask itself states the branch already landed via PR).

Archive contents: `ANALYSIS.md`, `SALVAGE-NOTES.md`, `tracked.patch`,
`main-normalized.jsonl`, `worktree-normalized.jsonl`, `normalized.diff`, `normalized-git.diff`.
The seat itself was not modified (read-only audit).
