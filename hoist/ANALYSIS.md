# ANALYSIS — seat hoist (feat/hoist-pwsh-terminal-bash)

**Summary:** the seat is effectively clean — its only dirty path is the `deepseek-harness`
submodule carrying a re-materializable nested `vendor/vendor/` mirror with no pointer change
(already-in-main per the ask's rule), `git diff HEAD` is empty, no untracked seat-level files
exist, and every commit the branch ever made is content-verified present on `origin/main`
(98869dd1), so the worktree can be torn down with zero content loss and nothing to salvage.

- Commands run: `git -C /Users/lixiang/workspace/dsh-mobile-hoist status --porcelain`,
  `git diff HEAD`, `git diff origin/main -- <path>`, `git merge-base --is-ancestor`,
  per-file content containment checks (details in SALVAGE-NOTES.md). No fetch performed;
  `origin/main` is the local ref (98869dd1bbf0cd0676ddcf6cc20535bb8481be77, PR #468).

## Dirty paths (git status --porcelain output)

- `third-party/deepseek-harness` — **already-in-main** — `git diff origin/main -- third-party/deepseek-harness`
  output is empty (0 bytes); the submodule pointer is unchanged vs HEAD too (`git diff HEAD`
  on the path: empty). The ` M` comes from *untracked content inside the submodule* (see
  below), not from any seat-tracked change — nothing to commit, nothing main lacks.

## Untracked files

- Seat level: none (`git ls-files --others --exclude-standard` empty; no staged changes).
- Inside submodule: `third-party/deepseek-harness/vendor/vendor/` — **note only, not copied**
  — 1.9 MB / 225 files, an accidental nested mirror of the submodule's own `vendor/` (same 12
  top-level entries: cordis, cosmokit, group, hmr, include, loader, logger-console,
  schemastery, timer, AGENTS.md, CLAUDE.md, README.md) containing `node_modules/`, `.bin/`,
  `lib/` build output, `.js.map`/`.d.ts.map`, `tsconfig.tsbuildinfo` — obvious vendor/build
  artifact, re-materializable by the submodule's own vendor sync; nothing hand-authored.

## Context: branch vs origin/main (committed content, beyond the ask's dirty-path scope)

Verified so teardown loses nothing; full evidence in SALVAGE-NOTES.md:

- Note file `2026-09-29-terminal-bash-local-joins-…md`: byte-identical on main.
- Task card T-0072: on main renumbered as T-0126 (same slug/content) — stale id, not missing.
- `.gov/surprises.jsonl` branch line (sig `full-sweep-green-count-comparison-606`): on main;
  only delta is main's `\r\n` line ending vs branch `\n`.
- forkpty 5-line additions to the 3 `spike/scenario/upstream-suite-leg.js` copies: present on
  main in the renamed `dsh/scenario/` paths (old paths deleted by rename #402).
- Branch tip c8ccfa73 is not an ancestor of origin/main — squash-merge shape, as expected.

## Archive contents

- `tracked.patch` — `git diff HEAD` output; 0 bytes by fidelity (no tracked content changes).
- `SALVAGE-NOTES.md` — salvage verification: empty salvage set.
- `ANALYSIS.md` — this file.
- No copied untracked files (none at seat level; submodule-internal vendor artifact noted above).
