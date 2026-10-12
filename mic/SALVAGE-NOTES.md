# SALVAGE-NOTES — seat mic (branch feat/cap-microphone)

## What main is missing

Exactly ONE line exists in this seat's working tree that is absent from origin/main's .gov/surprises.jsonl (verified 2026-10-12 via byte compare after CR-normalization: 140 lines common, 1 seat-only, 83 main-only). The branch's committed HEAD does NOT contain it either — it is purely uncommitted worktree content: an appended ledger entry. To salvage, append the following line to .gov/surprises.jsonl on main (LF line endings):

```
{"ts": "2026-09-30T06:51:50+00:00", "sig": "pr-branch-push-that-github", "expectation": "a PR-branch push that GitHub acknowledges (PushEvent lands, Actions enabled, workflows active) fires zero workflow runs — the pull_request event pipeline for that one PR is stuck", "reality": "workflow_dispatch on the same branch started instantly and close+reopen of the PR re-fired all pull_request events; two pushes (05:36Z, 06:22Z) produced no check-suites at all", "surface": null}
```

## Why the raw diff looked huge (not a salvage concern)

- `git diff origin/main -- .gov/surprises.jsonl` is 369 lines (142 +/-/141 +, 224 -), but that is almost entirely noise: origin/main's blob stores the ledger with CRLF line endings (218/223 lines end 0d0a) while this seat's working-tree file uses LF (0 CR), so byte-wise the entire file appears rewritten.
- After stripping CR: 140 of the seat's 141 lines are already in main; the other 83 lines exist only on main (main is 83 ledger entries AHEAD of this stale tree — PRs #466/#468 et al. landed after this branch diverged). Nothing else needs salvaging from this seat.

## Provenance of the commands

- git -C /Users/lixiang/workspace/dsh-mobile-mic diff origin/main -- .gov/surprises.jsonl  → non-empty (369 lines)
- git -C /Users/lixiang/workspace/dsh-mobile-mic show origin/main:.gov/surprises.jsonl      → 223 lines, CRLF
- worktree file                                        → 141 lines, LF
- comm -13/-23 on CR-normalized sorted versions        → 1 / 83
