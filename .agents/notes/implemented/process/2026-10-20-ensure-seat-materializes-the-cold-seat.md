# Agent Note: ensure-seat materializes the cold seat — an executable inventory, not tribal knowledge

Status: implemented
Related: `2026-10-19-gate-plane-under-materialized-worktrees.md` (the
materialization trap this note retires), worktree-workflow skill §2

## Problem

A cold worktree seat cannot pass the gates' base checks. `bundle-files`,
`closures`, `staging-generated`, and self-test's baseline probe all read
UNTRACKED trees a linked worktree never carries — the vendored closure
(`external/*`, `runtime/dsh/vendor/*`), the pinned engines, the npm pins,
the tools' `node_modules` — and `build/build.sh sync` only re-stages the
committed host mirrors. Three sessions in October 2026 independently
re-derived the fix by hand (which trees to copy, from where, with what
tool), and the knowledge existed only as prose in the worktree-workflow
skill — where it had already gone stale once and could go stale again with
no mechanical way to notice. Worse, the documented copy step used `cp` in
spirit: an interrupted copy poisons the target, and nothing idempotent
repaired it.

## Decision

The inventory becomes a checked-in, executable manifest and the skill
defers to it:

- `.gov/materialization.json` lists the untracked `trees` a seat must carry
  plus the `build/build.sh sync` verbs that follow (`syncVerbs`). When a
  gate gains a new untracked dependency, the manifest is the one place to
  update.
- `build/ensure-seat.sh` is the manifest's only executor. It resolves the
  primary checkout of the worktree graph from the seat's common git dir
  (works from any cwd, and no-ops when the seat is the primary), rsyncs
  each tree — rsync because it resumes cleanly after an interruption and
  the whole flow is offline by design, the primary seat being the only
  source — then runs the sync verbs, and with `--verify` probes
  `bundle-files` + `closures` so "materialized" is a checked claim, not a
  hope. Accepts a seat path, so one seat can materialize a sibling.
- The worktree-workflow skill's §2 now says `build/ensure-seat.sh
  [--verify]` and explains the manifest and rsync properties; the old
  `build/build.sh sync <platform>` entry point is demoted to a
  script-internal step.
- `tools/aoci/fras-lint.mjs` gives the seat a pre-submission lint for AOCI
  batches: same limits as the machine contract (FRAS v2 — F/R/A/S rune
  budgets, R/A item caps, S by the tag's C rank, `[A-Z0-9]{4,5}` tags,
  four ` | `-separated segments), machine-homomorphic findings on stdout,
  exit 1 on any finding. Linting before `aoci_update_entry` turns the
  machine's repair round-trip into a local, instant verdict.

## Alternatives considered

- Only edit the skill document, no script: cheapest diff, but it loses on
  every axis that matters — prose cannot be executed, so materialization
  stays a re-derivation ritual per cold seat; it cannot be idempotent (a
  second run must converge, not duplicate); and a doc drifts silently the
  moment a gate grows a new untracked dependency. An executable manifest
  inverts that: the list is checked in and the script is its single
  interpreter, so the inventory can neither rot unnoticed nor be applied
  half-way, and rsync's resumability makes an interrupted run self-healing
  instead of a poisoned target.
- Put the manifest into govrail's `gates.json` (as gate inputs or a
  first-class "environment requirements" block): attractive because
  govrail already owns "what must exist before gates judge", and as
  govrail's author I have filed it as an upstream evolution candidate — a
  general mechanism would spare every adopting repo this local script. It
  loses for this change because govrail has no such concept today;
  building it is an upstream release, not a local edit, and the seats are
  red now. Landing the local manifest first also gives the upstream design
  a working precedent to generalize from. When govrail ships the feature,
  this manifest migrates and the script shrinks to a caller.
- Encode the tree list inside `ensure-seat.sh` (no separate manifest):
  fewer files, but it splits the authority in two — anyone updating the
  inventory edits a script instead of data, and sibling tooling (the
  skill, future gate wiring) cannot read the list without parsing shell.

## Consequences

Cold seats go gate-capable with one command, and the October 2026
re-derivation ritual ends. The manifest is a new cross-file contract:
a gate that grows an untracked dependency must update it, or cold seats
red-shift again — the script's `SKIP (absent in primary)` warning surfaces
partial materialization loudly. `--verify` only probes the two cheap base
gates; the full DAG still belongs to `gov run`. fras-lint duplicates the
FRAS v2 constants by design (local fail-fast over remote truth), so a
machine-side limit change must be mirrored here the same change — the file
header says so.
