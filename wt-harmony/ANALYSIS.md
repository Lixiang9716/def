# Seat snapshot — wt-harmony (perf/ci-harmony-and-release)

**Summary:** All 4 dirty paths are one coherent round of uncommitted CI-perf edits (node 20→22
bumps with rationale comments, `setup-java` v4→v5, vendored-tarball cache steps) that main has
since superseded with its own evolved version of the same workflows — the branch's commits are
fully merged, no untracked files and no `.gov/` residue exist, so the seat is safe to tear down;
the only content main lacks is the node-22 bump + rationale comment in `dev-harmonyos.yml` and
`release-harmony.yml` (main pins `'20'` in both).

## Seat facts (all commands run 2026-10-12)

- Seat: `/Users/lixiang/workspace/dsh-mobile-wt-harmony`, branch `perf/ci-harmony-and-release`
  (`git branch --show-current`).
- HEAD `8d2674a1ea760326f00ae4b8eb1f403d1c040815` **is an ancestor** of `origin/main`
  `98869dd1bbf0cd0676ddcf6cc20535bb8481be77` (`git merge-base --is-ancestor HEAD origin/main`
  → exit 0). The branch's PR work is fully in main; main has moved on (#464, #467, #468…).
- Dirty paths (`git status --porcelain -uall`): exactly 4 modified tracked files, 0 staged,
  **0 untracked** (`--porcelain` and `--porcelain -uall` agree). Step 2 had nothing to copy —
  no skipped-oversized/skipped-vendor notes needed.
- `tracked.patch` (10,236 bytes) = `git diff HEAD`, the complete uncommitted delta.
- Extra archive (not asked, kept for resilience): `worktree-files/.github/workflows/` holds the
  4 worktree copies of the modified files (the exact pre-teardown bytes; neither HEAD nor main).
- Stash note for the teardown operator: the repo has 4 stashes
  (`git stash list` — `gaps-integration`, `feat/device-plane`, `fix/tool-rows-integration`,
  `chore/upstream-submodule`). Stash refs live in the shared repo object store, not in this
  worktree, so removal here does not delete them; recorded here only so nobody is surprised.

## Per-file verdicts

| path | verdict | note |
|---|---|---|
| `.github/workflows/dev-harmonyos.yml` | substantive-wip | Uncommitted delta = node `'20'`→`'22'` + rationale comment + a `vendor-quickjs-ng-…` cache step for `runtime/spike/vendor/quickjs-ng` — real deliberate CI work, but main's copy has evolved past it (checkout@v7, cache@v6, a broader "Cache the vendored upstream closure" over `runtime/dsh/vendor/{quickjs-ng,dsh,npm}`, suite-HAP build) and still pins `node-version: '20'` (line 55 of `git show origin/main:…`); only the node-22 bump + comment is content main lacks. |
| `.github/workflows/release-android.yml` | substantive-wip | Uncommitted delta = `setup-java` v4→v5 (with deprecation rationale) + a `vendor-closure-…` cache over `runtime/spike/vendor/*`; main already supersedes both — it runs `setup-java@v6` (line 123 of `git show origin/main:…`, a bigger bump than this WIP's v5), node `'22'` (line 134), and a `vendor-${{ runner.os }}-…` closure cache at cache@v6 (lines 196–202). Superseded substance; nothing main needs. |
| `.github/workflows/release-harmony.yml` | substantive-wip | Uncommitted delta = node `'20'`→`'22'` + rationale comment + `vendor-quickjs-ng-…` cache for `runtime/spike/vendor/quickjs-ng`; main's copy has the evolved closure cache (`vendor-${{ runner.os }}-…`, line 168) but still pins `node-version: '20'` (line 126) — the cache idea landed in main's evolved form, the node-22 bump + comment is content main lacks. |
| `.github/workflows/release-ios.yml` | substantive-wip | Uncommitted delta = only a `vendor-closure-…` cache step for `runtime/spike/vendor/*`; main's copy already implements the same idea in evolved form ("Cache the vendored upstream closure", cache@v6, `runtime/dsh/vendor/*`, `vendor-${{ runner.os }}-…` key, lines 128–142 of `git show origin/main:…`) plus node `'22'` was already present in both — fully superseded substance; nothing main needs. |

## Why the vs-main diffs are large even though the branch merged

`git diff origin/main -- <path>` was run for all 4 files per protocol: 156 / 181 / 152 / 250
lines respectively — none empty, so the `already-in-main` verdict (defined as empty diff) never
fires. The size is NOT unmerged branch work: HEAD is an ancestor of origin/main, and main's own
later evolution of these workflows (action bumps to checkout@v7/setup-node@v7/cache@v6, the
`runtime/spike/vendor` → `runtime/dsh/vendor` layout move, attest-build-provenance +
`environment: release` gate in release-ios) shows up as the bulk of the reverse-delta. The
seat's actual uncommitted contribution is the 10 KB in `tracked.patch`.

## Ledger salvage

- No dirty path starts with `.gov/` → no `ledger-residue` verdicts, and `SALVAGE-NOTES.md` is
  not applicable (it is only written for ledger-residue files).
- `salvageFiles` = [] (empty): the ask scopes salvage to `.gov/` files with main-missing
  content; there are none. For completeness, the main-missing content in the two substantive
  seats above (node-22 + comment in dev-harmonyos.yml and release-harmony.yml) is preserved in
  `tracked.patch` and `worktree-files/` — recoverable there if ever wanted.

## Teardown recommendation (evidence-based, for the operator)

Safe to remove the seat: branch merged (HEAD is ancestor of origin/main), zero untracked files,
all uncommitted work is CI-perf tuning that main has superseded in evolved form
(setup-java@v6 ≥ WIP's v5; cache@v6 closure caches ≥ WIP's cache@v4 spike-path caches), and the
only unique deltas (node-22 in two harmony workflows) are archived in `tracked.patch` /
`worktree-files/`. Stashes are repo-global and unaffected.
