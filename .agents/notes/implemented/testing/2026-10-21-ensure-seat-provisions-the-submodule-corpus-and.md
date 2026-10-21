# Agent Note: ensure-seat provisions the submodule corpus and the Node farm; the fingerprint sees them

Status: implemented
Related: dsh-mobile#627 (the seat-completeness finding), the 2026-10-20
note "ensure-seat materializes the cold seat" (the inventory/executor
split this extends), plan §3.4, `test/upstream-suite/generation.mjs`
(the fingerprint this makes honest)

## Problem

A cold seat failed the upstream suite three ways at once, and the failure
was invisible: (1) `external/node_modules` — the parity link farm the
node leg resolves through — was built only by the runners that knew about
it, so a cold seat's node leg died at module load and every cell landed
`TIMEOUT-OR-ERROR`; (2) `third-party/deepseek-harness` (the pinned
submodule) is not auto-initialized in a linked worktree, so transpile
excluded the monorepo-src specs and silently rewrote the TRACKED
manifest.json 681 → 648; (3) worst of all, the generation fingerprint did
not cover the submodule corpus, so the shrunken 648-spec tree carried the
IDENTICAL `.generation` stamp as a full 681 tree — nothing anywhere could
tell freshness from rot.

## Decision

- **`.gov/materialization.json` gains a `provision` array** — seat-BUILT
  dependencies, executed by `build/ensure-seat.sh` after the rsyncs, so
  the inventory stays the single source of what a cold seat must carry.
  Two steps: the submodule corpus and the parity farm.
- **The submodule provision clones the primary's submodule checkout in
  place** (`git clone $PRIMARY/third-party/deepseek-harness`), then
  overlays the primary's working tree with
  `rsync -a --exclude .git`. Two discoveries forced this shape:
  `git submodule update --init` cannot run offline here — the shared
  `.git/modules/third-party/deepseek-harness` is CHECKED OUT by the
  primary, and the submodule machinery refuses a second checkout of the
  same module dir (URL rewrites, `submodule set-url` and `insteadOf` all
  still clone into the owned dir); and the harness repo GITIGNORES its
  vendored `lib/` bytes (`.gitignore:7 lib/` — upstream's own
  materialization writes them), so a pristine clone at the pinned sha
  `ddefc45f` still lacks files the transpile inlines — the overlay
  carries them, under the same trust model as every rsynced tree (the
  primary is the one source).
- **The farm is built IN the seat, never rsynced** —
  `parity-node-modules.sh` links are seat-absolute, so a copied farm
  would silently resolve the seat's node leg against the PRIMARY tree's
  bytes. `tools/test/sweep.mjs` self-materializes it too (weekly CI
  never runs ensure-seat), gated on `external/dsh` existing — the farm's
  links resolve INTO the closure, so hermetic fixtures without one skip.
- **generation.mjs fingerprints the submodule**: the gitlink sha from
  `git ls-tree HEAD` plus the materialized working tree's own HEAD
  (marker `absent` when not provisioned, checked via `.git` existence —
  `rev-parse` on a missing dir walks UP and answers the superproject's
  HEAD). An unprovisioned seat can no longer share a stamp with a
  provisioned one.
- **transpile.mjs warns loud** when the submodule is absent (rule 5):
  the pass still runs, but the reader is told the corpus is partial and
  manifest.json will shrink accordingly.

## Alternatives considered

- **rsync the farm like every other tree** — rejected: it copies
  seat-absolute symlinks, the exact mixed-bytes trap (#627 gap 3).
- **`git submodule update --init` (with network, or via
  `set-url`/`insteadOf` to the primary)** — rejected after measurement:
  the module dir is owned by the primary's checkout; every route still
  tries to clone into it and dies. A per-worktree module checkout is git
  machinery this repo does not need.
- **Fingerprint only the gitlink sha** — insufficient: the sha is
  identical whether or not the working tree is materialized, which is
  the bug. The working-tree HEAD (or `absent`) is the marker that
  moves.

## Consequences

Acceptance measured on a fresh seat: provisioned via these steps,
transpile yields **681 = origin/main with zero missing and zero extra
specs** (and the manifest matches main's byte-for-byte modulo one
pre-existing esbuild-message cwd nondeterminism — the error strings
embed the run's path base, see the restored manifest.json in this
change). The `.generation` stamps of a provisioned seat and the primary
converge; an unprovisioned seat's diverges by construction. `gov task
close`'s vendoring-repro gate and the weekly CI sweep are unaffected
(both materialize their own trees; the sweep's farm step is a no-op
there).

The seat's OWN submodule checkout created by this provision is a plain
clone (embedded `.git` directory, not a registered submodule checkout):
read-only consumers (transpile, `rev-parse`) are exactly right with it,
and `git submodule absorbgitdirs` can formalize it later if ever needed.
