# Seat snapshot: wt-hygiene

Seat `/Users/lixiang/workspace/dsh-mobile-wt-hygiene`, branch `perf/ci-ios-android-hygiene`
(HEAD `8d2674a1`, `origin/main` `98869dd1` — the branch's content merged into main and main has
moved on). 3 dirty paths (`git status --porcelain`, ignored excluded): 2 modified workflow files
+ 1 untracked note. The uncommitted work is the seat's namesake CI-hygiene change (cache the
vendored closure in dev/ios + dev/android, bump `setup-java` v4→v5, make both iOS checkers always
report) plus the agent note documenting it; every piece's substance already landed in main in an
evolved form (`runtime/dsh/vendor` paths, `cache@v6`, `setup-java@v6`, `check_rc`), the non-empty
`diff origin/main` output being mostly the seat's stale base. No `.gov/` paths → no
ledger-residue, no SALVAGE-NOTES.md needed, nothing to salvage. Seat is safe to tear down.

Per-file (commands run: `git status --porcelain`, `git diff HEAD > tracked.patch`,
`git diff origin/main -- <path>` per tracked file, `git show origin/main:<path>` spot-checks):

- `.github/workflows/dev-android.yml` — **substantive-wip** — Real uncommitted work: setup-java
  `@v4`→`@v5` with a rationale comment (tracked.patch lines 9–17) + a new "Cache the vendored
  quickjs-ng + upstream DSH closure" step keyed on the pin scripts over `runtime/spike/vendor/`
  (tracked.patch lines 25–61). Superseded in main, which already carries the evolved form:
  `setup-java@v6` (origin/main line 49) and the cache step as "Cache the vendored upstream
  closure", `cache@v6`, key `vendor-` over `runtime/dsh/vendor/` (origin/main lines 129–143).
  `git diff origin/main` non-empty (rule excludes already-in-main); not a log/draft → not junk.
- `.github/workflows/dev-ios.yml` — **substantive-wip** — Real uncommitted work: same
  vendored-closure cache step for dev/ios (tracked.patch lines 74–105) + the both-checkers fix —
  `rc=0` / `|| rc=1` accumulation so a failing first checker no longer hides the second verdict
  (tracked.patch lines 114–139). Superseded in main, which has the same fix as `check_rc`
  (origin/main dev-ios.yml lines 344–355) and the cache step at line 155. Non-empty vs main,
  not `.gov/`, not logs/drafts.
- `.agents/notes/implemented/process/2026-09-21-dev-ios-and-dev-android-stop-re-fetching.md` —
  **substantive-wip** — Untracked, 7869 bytes (< 5 MB, a prose note, not vendor/build output) →
  copied to the archive at the same relative path (byte-identical per `cmp`). A polished
  implemented-note for exactly the WIP above: problem, decision, measured alternatives
  (restore-keys rejected, tree-hash rejected), consequences. Not present in `origin/main`
  (`git ls-tree origin/main -- <path>` returns empty). Real written work, not a log/draft.

## Archive contents

- `tracked.patch` — full `git diff HEAD` (142 lines, both workflow files).
- `.agents/notes/implemented/process/2026-09-21-dev-ios-and-dev-android-stop-re-fetching.md` —
  the untracked note, unmodified copy.

No `SALVAGE-NOTES.md`: no dirty path starts with `.gov/`, so there is no main-missing ledger
content to record.
