# SALVAGE NOTES — seat dcanon (branch feat/canonical-json-single-source)

## What main is missing

`origin/main`'s `.gov/surprises.jsonl` does **not** contain the following ledger entry. It is the
only uncommitted change in the seat (see `tracked.patch`; seat HEAD blob `97c53912` → worktree
`d6febcf9`, one appended line). It documents a real GitHub Actions behavior observation from
PR #291 and is worth re-appending to main's ledger.

File (repo-relative): `.gov/surprises.jsonl`

```jsonl
{"ts": "2026-10-01T07:34:51+00:00", "sig": "two-consecutive-pushes-291", "expectation": "Two consecutive pushes to PR #291 (66b882ea, 5b02c34f) produced ZERO pull_request workflow runs — while sibling PRs' runs fired normally in the same window, and cancel-in-progress never fired either (proof the push events never reached Actions), i.e. GitHub dropped the synchronize events themselves", "reality": "workflow_dispatch on each workflow re-kicks them reliably; but dispatch binds to the ref's head at dispatch time, so after the re-kick push a SECOND dispatch round is needed for the required gates context to sit on the new head SHA", "surface": null}
```

Validity: the line parses as JSON with keys `ts, sig, expectation, reality, surface`
(checked with `python3 -c "json.loads(...)"` during this audit).

## How this was determined (commands run)

1. `git -C /Users/lixiang/workspace/dsh-mobile-dcanon status --porcelain` — exactly one dirty
   path: ` M .gov/surprises.jsonl`. No untracked files.
2. `git -C … diff origin/main -- .gov/surprises.jsonl` — non-empty (whole-file), so per protocol
   the path is ledger-residue and needs this salvage comparison.
3. Byte-level `comm` of worktree vs `git show origin/main:.gov/surprises.jsonl` initially flagged
   ~170 lines as seat-only — false alarm: main's blob has CRLF endings on 218/223 lines
   (`grep -c $'\r'` = 218 in main blob vs 0 in the seat worktree/HEAD; `git ls-files --eol`:
   `i/lf w/lf`), i.e. someone rewrote the whole ledger LF→CRLF on main after the branch merged.
4. After `tr -d '\r'` normalization of main's blob, the set comparison collapses to:
   - seat-only lines absent from main: **exactly 1** — the entry quoted above
     (`comm -13 <(sort -u main-lf) <(sort -u worktree)`).
   - main-only lines (main ahead): **53** newer entries appended on main after the branch merged
     (main's ledger runs to `2026-10-11T16:47:07+00:00`).
5. `grep -c 'two-consecutive-pushes-291'` on main's blob = **0** — confirms the sig is absent
   from main.

## Note on the CRLF divergence itself

Main's `.gov/surprises.jsonl` blob is a CRLF copy while the repo stores it as LF elsewhere
(`i/lf w/lf`, no `.gitattributes` entry for the path). Salvaging the line above onto main will
need to match main's current line-ending style or the whole-file churn will show up again in any
diff. Flagging it here since it is a repo-level quirk, not a seat-local one.
