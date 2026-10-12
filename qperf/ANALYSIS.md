# Seat audit: qperf (`feat/perf-baseline`)

**Summary**: The seat is effectively clean — zero tracked modifications (`tracked.patch` is 0 bytes) and only two untracked spike run logs, both of which are byte-identical (`cmp` exit 0) to evidence artifacts already merged into `origin/main` via PR #297; nothing unique would be lost by tearing the worktree down.

## Worktree state (audited 2026-10-12)

- `git -C /Users/lixiang/workspace/dsh-mobile-qperf status --porcelain --untracked-files=all` → exactly 2 untracked files, 0 tracked modifications.
- `git -C … diff HEAD > tracked.patch` → 0 bytes (confirms no tracked changes).
- Step-4 per-file loop (`git diff origin/main -- <path>` for each tracked changed file): zero iterations — there are no tracked changed files. No `.gov/` paths are dirty, so there is no ledger residue; no SALVAGE-NOTES.md is warranted and `salvageFiles` is empty.

## Per-file verdicts

| path | verdict | note |
|---|---|---|
| `runtime/spike/logs-leak-canary.txt` | already-in-main | Raw leak-canary run log (162,324 B, 1219 lines); byte-identical (`cmp` exit 0) to `origin/main:runtime/dsh/artifacts/macos-cli-leak-canary/logs.txt`, landed by PR #297 (4173ae7a) and renamed `runtime/spike/`→`runtime/dsh/` by #402 (2dc9e7c3). Archived anyway (small). |
| `runtime/spike/logs-perf-baseline.txt` | already-in-main | Raw perf-baseline run log (19,136 B, 149 lines); byte-identical (`cmp` exit 0) to `origin/main:runtime/dsh/artifacts/macos-cli-perf-baseline/logs.txt`, same #297/#402 provenance. Archived anyway (small). |

## Branch-level findings (context for teardown)

- Local `feat/perf-baseline` == `origin/feat/perf-baseline` (both 2edf1ce3): nothing unpushed.
- `git merge-base --is-ancestor feat/perf-baseline origin/main` → **not** an ancestor; merge-base is cb7b0a50 (#294, 2026-10-01), with 163 main commits since. This is expected, not a red flag: this repo squash-merges (AGENTS.md "merge (squash)"), and the branch's full content demonstrably landed via **PR #297** (`4173ae7a feat(testing): the perf baseline and the leak canary …`, whose stat matches the branch's touched-file list: spike ci/scenario/host sources, `artifacts/*/logs.txt|scenario.jsonl|receipt.json|verdict.json`, `baselines/perf-baseline.json`, task cards, gates).
- The seat is a **linked worktree** (`--git-dir` = `/Users/lixiang/workspace/dsh-mobile/.git/worktrees/dsh-mobile-qperf`): stashes live in the shared common dir and survive worktree teardown. The 4 existing stashes (gaps-integration / device-plane / tool-rows-integration / chore/upstream-submodule) belong to other seats' work, not to this seat's dirty state — no action taken.

## Archive contents

- `tracked.patch` — full `git diff HEAD` output (empty; kept as proof).
- `runtime/spike/logs-leak-canary.txt`, `runtime/spike/logs-perf-baseline.txt` — copies of both untracked files at their seat-relative paths, verified byte-identical to the originals after copy.
