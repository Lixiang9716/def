# Agent Note: AssetSync.kt is the unwired reconciler copy — deleted

Status: implemented
Related: dsh-mobile#628 (the dead-copy finding), the 2026-10-16 row-15
note (where the two reconcilers' history is told), plan §3.11,
`doc/test-coverage.md` row 15

## Problem

`AssetSync.kt` ("the stamped asset-tree reconciler (loop-g) — moved out of
MainActivity at the code-size gate") had **zero call sites** on this tree:
`MainActivity` carries its own `syncAssetDir(assetPath, target)` — the
generic stamped reconciliation over `collectAssetNames`, wired for the
`dsh`, `official-web` and `web-plugins` trees — and row 15's journal-wipe
fix rides *that* path (`JournalKeeper.preserve(target)` before the
`deleteRecursively()`). The extraction was never wired back in, so the
object survived as a second implementation of the same mechanism — one
that still had the pre-row-15 behavior (a bare tree wipe, no journal
preservation). #628's warning is exactly this: **wiring it as-is would
re-introduce the journal wipe** that row 15 exists to prevent.

## Decision

Delete `AssetSync.kt` outright (plan §3.11's recommendation A). The live
mechanism is `MainActivity.syncAssetDir` + `JournalKeeper`; nothing
references the copy. The plan's "detekt baseline shrinks" side effect does
not apply on this tree — no detekt baseline file exists under
`hosts/android/`.

Row 15's title in `doc/test-coverage.md` / `.zh.md` named the dead object
("AssetSync stamps"); it now names the mechanism ("asset-stamp
reconciliation" / "资产 stamp 对账"), consistent with the body #630 already
corrected to `JournalKeeper.kt, called from MainActivity.syncAssetDir`.

## Alternatives considered

- **Complete the extraction (plan §3.11 option B: route
  `MainActivity.syncAssetDir` through `AssetSync` and delete the inline
  copy)** — rejected for now: it is a refactor of the hot boot path with
  row-15 regression exposure for zero behavior change, and the code-size
  gate the original extraction served already passes with the inline form.

## Consequences

The AOCI entries that named `AssetSync.kt` as a relation (the
run-upgrade-matrix row's R field) re-bind at the next cognition
maintenance; the object's own entry becomes an orphan-remove candidate in
the same pass. Any future reconciliation work starts from
`MainActivity.syncAssetDir`, not from git history's tempting copy.
