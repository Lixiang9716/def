# Row 15: the app upgrade matrix — install -r across builds; AssetSync stamps

Status: implemented

## Problem

`adb install -r` is the upgrade path every real user takes, and the repo
was burned by exactly its failure class once: an overwrite-only asset copy
let 274 stale directories from an older APK survive forever (loop-g's
finding). Two faces of the upgrade were unproven: does user data (the
session journal) survive, and does the stamped reconciliation actually
wipe what an older build shipped.

## Decision

`hosts/android/ci/run-upgrade-matrix.sh`: two debug builds of the SAME
tree differing by one probe asset (`assets/dsh/upgrade-probe.txt`, which
the runner creates and removes around the builds and never commits), and
one upgrade flow:

- build A (probe shipped) installs FRESH; the persist-restart seat's
  create leg journals a real turn; the runner plants a canary file in
  `files/profiles/default/` via run-as;
- THE UPGRADE: probe removed → build B → `adb install -r` (never
  uninstall), with a deterministic process boundary on both sides;
- launch B runs the resume leg — the journal restored and continued over
  the upgrade is the data-survival proof through the product path, judged
  by the same one-to-one checker manifest the restart leg uses
  (`android-session-persist-restart.json`; the upgrade replaces the
  force-stop of the restart flow, the drive and its log ladder are
  unchanged);
- on-disk assertions via run-as: the stale probe is GONE from
  `files/dsh/` (the stamp wiped it — the 274-dirs class), the canary is
  INTACT in `files/profiles/`, and the stamp exists.

## THE FINDING: the upgrade wiped the session journal

The first green-machine run of this leg FAILED exactly where it should:
after the upgrade the journal was gone and the resumed boot self-staged
as a clean create. Root cause, pinned with on-device instrumentation:
the session journal lives at `<filesDir>/dsh/dsh/sessions` — INSIDE the
asset-reconciled tree (`files/dsh`) — and the reconciler's stamp-mismatch
wipe (`deleteRecursively`) took the journal with the stale probe. The
module doc's claim that the wipe "never takes user data with it" was
false for exactly the CLI-shaped persistence root. Fix in the LIVE
reconciler (`MainActivity.syncAssetDir` — note: AssetSync.kt is the
orphaned loop-g object, zero call sites): journal subtrees
(`dsh/sessions`) rename aside OUTSIDE the wiped tree before the wipe and
rename back after re-materialization. The dead `AssetSync.kt` copy is
untouched (kept for engine-gate parity with its committed bytes).

## Alternatives considered

- Release builds (the shipped artifact): rejected for this leg — release
  is not debuggable, so run-as cannot assert the on-disk faces.
- Repackaging the APK (zip surgery) for the build delta: rejected — the
  probe must ride the REAL asset pipeline so the stamp the device
  computes is the stamp the build shipped (verified: the probe survives
  mergeAssets + stageSpineClosure into the APK).
- Treating the wipe as correct and moving the journal out of `files/dsh`
  in the seat: rejected — that relocates user state to dodge a bug the
  reconciler's own doc says cannot happen; the reconciler is what had to
  change.

Cadence: informational — run on asset-staging, reconciler, or
profile-container changes and before releases; never a gate.
