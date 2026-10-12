# ANALYSIS — seat mic (branch feat/cap-microphone)

**Summary**: This seat is essentially clean for teardown — zero untracked files and a single tracked
worktree edit, `.gov/surprises.jsonl`, whose only real delta vs origin/main is one uncommitted
ledger entry (`pr-branch-push-that-github`, 2026-09-30) that main lacks and is recorded in
SALVAGE-NOTES.md; the branch's mic work itself already landed via squash-merge.

## Archive contents

- `tracked.patch` — output of `git -C /Users/lixiang/workspace/dsh-mobile-mic diff HEAD` (9 lines:
  the single +1 ledger append below). Nothing else was copied because there are no untracked files.
- `SALVAGE-NOTES.md` — the one main-missing ledger line, byte-exact, plus the CRLF/noise explanation.

## Per-file verdicts

| path | verdict | note |
|---|---|---|
| `.gov/surprises.jsonl` | ledger-residue | Worktree appends one ledger entry (`sig: pr-branch-push-that-github`, ts 2026-09-30T06:51:50Z) that is absent from origin/main and from the branch's own HEAD commit — bookkeeping residue worth one line of salvage, not real WIP. |

Untracked files: none (`git status --porcelain -uall` shows only the one ` M` entry; `??` count 0),
so the 5MB / vendor-build-artifact copy filter had nothing to act on.

## Evidence trail (all commands run 2026-10-12)

1. `git -C /Users/lixiang/workspace/dsh-mobile-mic status --porcelain` (and `-uall`) →
   only ` M .gov/surprises.jsonl`.
2. `git -C /Users/lixiang/workspace/dsh-mobile-mic branch --show-current` → `feat/cap-microphone`;
   HEAD `5c79528e`, `origin/main` resolves to `98869dd1` (PR #468 tip; HEAD is not an ancestor of it
   because this repo squash-merges, which is expected, not a divergence of content).
3. `git diff HEAD > tracked.patch` → 9 lines, single hunk `@@ -138,3 +138,4 @@` adding the
   `pr-branch-push-that-github` entry.
4. `git diff origin/main -- .gov/surprises.jsonl` → non-empty, 369 lines (141 +, 223 −). Raw shape
   is misleading: origin/main's blob has CRLF endings (218/223 lines) vs LF in the seat worktree, so
   the whole file reads as rewritten. After CR-normalization: 140/141 seat lines already in main,
   1 seat-only line (the salvage target), 83 lines only on main (main is simply ahead — #466/#468
   et al. landed after this tree went stale). Salvage decision made on the normalized compare per
   the ask's `git show origin/main:<path>` step; the only main-missing line is in SALVAGE-NOTES.md.

## Teardown recommendation

Safe to remove the seat after appending the salvaged ledger line (or consciously dropping it — it
documents a stuck GitHub `pull_request` pipeline on this branch, historical context only).
No code, no config, no untracked artifacts at risk.
