# SALVAGE-NOTES — seat `regr` (branch `feat/release-regression-final`)

Seat: `/Users/lixiang/workspace/dsh-mobile-regr` (read-only audit; nothing in the seat was modified)
Compared against: `origin/main` = `98869dd1` (and cross-checked against local `main` = `1b3b31cf`)
Baseline for verdict: `git -C <seat> diff origin/main -- <path>` per the cleanup runbook.

## Files with content missing from main

### `.gov/surprises.jsonl`

Working tree = HEAD (`b1297c80`) content (160 entries, LF line endings) **+ the 2 ledger
entries below appended** (see `tracked.patch`). Neither entry exists in `origin/main`
(`git show origin/main:.gov/surprises.jsonl`) **nor in local `main`** (`1b3b31cf`) —
verified by sig search on both normalized blobs. They are genuine surprise-ledger records
documenting GitHub-side CI behavior; if the ledger's history matters, these 2 lines must be
re-appended to main before the seat is torn down.

Verbatim main-missing lines (single-line JSONL records):

```
{"ts": "2026-09-30T16:47:19+00:00", "sig": "281-reported-mergeableconflicting-rebasing", "expectation": "PR 281 reported mergeable=CONFLICTING, so rebasing the branch onto origin/main would surface a real git conflict to resolve", "reality": "git merge-tree and a full 24-commit rebase onto origin/main both completed with zero conflicts — the CONFLICTING verdict was stale server-side state, cured by the force-push itself", "surface": null}
{"ts": "2026-09-30T16:47:19+00:00", "sig": "push-the-branch-triggers", "expectation": "A push to the PR branch triggers the pull_request workflows (gov and ci-verdict have bare on.pull_request with no paths filter)", "reality": "head commit 5b90abac (pushed 2026-09-30T16:05Z by the owner) produced 0 check runs and 0 workflow runs; the very next force-push of b1297c80 triggered all five workflows within seconds — the original push event was lost GitHub-side, cause not retrievable after the fact", "surface": null}
```

## Line-ending caveat (why the raw diff is huge)

`git show origin/main:.gov/surprises.jsonl` has **CRLF** line endings (218/223 lines contain
`\r`); the seat's tree and HEAD blob are **LF** (0 lines with `\r`). A raw
`git diff origin/main -- .gov/surprises.jsonl` therefore renders as a whole-file rewrite
(217 KB). After stripping `\r`, the true delta is: **origin/main has 65 lines the seat lacks**
(other PRs appended ledger entries after this branch merged — no salvage needed, main wins),
and **the seat has the 2 lines above that main lacks** (salvage needed).

Evidence artifacts in this directory: `tracked.patch`, `main-normalized.jsonl`,
`worktree-normalized.jsonl`, `normalized.diff` (`/usr/bin/diff` of the two normalized files),
`normalized-git.diff` (`git diff --no-index` of the same).

Tooling note: `diff` on this machine's PATH resolves to the HarmonyOS command-line-tools shim
(`/opt/homebrew/share/harmonyos-commandlinetools/.../diff`), which exited 0 on two different
files; `/usr/bin/diff` was used instead.
