# SALVAGE-NOTES — byok seat (`feat/byok-onboarding`)

Seat: `/Users/lixiang/workspace/dsh-mobile-byok` · compared against `origin/main` = `98869dd1`
(`git -C /Users/lixiang/workspace/dsh-mobile-byok show origin/main:.gov/surprises.jsonl`, 223 lines)
vs worktree copy (150 lines).

## What main lacks

Of the worktree's 150 ledger lines, 149 are **byte-identical** to lines already in
`origin/main` (checked per-line by JSON `sig`, then full-line byte compare — script output:
`byte-identical in main: 149 · same sig, different content: 0 · truly missing from main: 1`).
The seat HEAD (`cb80e20f`) is *not* an ancestor of origin/main — the branch was merged
content-wise and then rebased onto an older main, so the raw `git diff origin/main` is 214 KB
of ordering/append noise around content main already has.

**Exactly one line is missing from main** — it is also the seat's only uncommitted change
(`git diff HEAD` = +1 line, not present in `cb80e20f`, in `origin/main`, or in the primary
worktree `/Users/lixiang/workspace/dsh-mobile/.gov/surprises.jsonl`):

```json
{"ts": "2026-09-30T13:56:08+00:00", "sig": "head-with-live-workflow-triggering", "expectation": "A PR head with live workflow-triggering paths will keep reporting checks on every push", "reality": "With mergeStateStatus=DIRTY (base advanced, conflict), GitHub cannot create the pull request merge ref, so pull_request workflows never start at all — gh pr checks reports 'no checks reported' indefinitely until the branch is rebased. The red check is not slow CI, it is no CI.", "surface": null}
```

## Salvage action

Append the line above to `.gov/surprises.jsonl` on main (normal ledger append; it is the
file's last worktree line and `git apply` of `tracked.patch` reproduces it against a tree at
the seat's base — on current main a plain append of that final line is the equivalent).
Nothing else in the seat needs salvaging: no untracked files exist, and no other tracked file
differs from HEAD.
