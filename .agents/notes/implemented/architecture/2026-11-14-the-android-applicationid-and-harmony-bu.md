# Agent Note: the Android applicationId and Harmony bundleName unify on def

Status: implemented
Related: D19

## Problem

D19 moved the app identity to def but deliberately left the Android
applicationId and Harmony bundleName on `com.dshmobile.host` — a domain nobody
owns, the same impersonation class D19 fixed for iOS, kept behind only because
the rename is cross-layer: the `transport-tokens` gate pins the `appId` row to
every consuming layer (Kotlin, gradle/manifest, shell runners), and the id
change is a NEW APP on every device, not an upgrade — no container, journal,
or keychain-sealed secret migrates. Renaming it therefore needed the token
row, every pinned literal, the runners, the docs, and one device leg proving
the row-15 class (journal survival across an in-place `install -r`) still
holds under the new id, all in one landing.

## Decision

The Android applicationId (`hosts/android/app/build.gradle.kts`) and Harmony
bundleName (`hosts/harmony/AppScope/app.json5`) are
`io.github.lixiang9716.def`, matching the iOS bundle id. The
`transport-tokens` `appId` row moved with them, and every layer literal the
checker pins followed: the share FileProvider authority (manifest +
`ShareFilesProvider.AUTHORITY`), every `PKG=`/`BUNDLE=` runner variable and
inline `am start`/`aa start`/`run-as`/`pidof` argument, the simulator-matrix
and e2e package args, the device-container paths in the panel test fixtures,
and the launch/data-path commands in `doc/windows-test-plan.md` + `.zh.md`
(pairing re-confirmed) and the two host READMEs (single files, no zh
counterpart). The staged mirrors follow via `build/build.sh sync` — never
hand-edited.

The (a)/(b) line the rename rode on: `com.dshmobile.host` appears in two
unrelated roles. Role (a) — app identity, renamed everywhere above. Role (b) —
the Java/Kotlin package namespace, KEPT: the repo directory
`app/src/main/java/com/dshmobile/host/`, every `package` declaration, the JNI
symbol prefixes, and the gradle `namespace` stay, because renaming the
namespace is a source-tree refactor with zero identity effect (a maintainer's
ask, not a device-visible one), and doing it here would have swollen a
device-facing change into a whole-tree one. The split identity has one
mechanical consequence the runners now spell: `am start` resolves a RELATIVE
activity class against the component package (the applicationId), so with
applicationId ≠ namespace every runner spells the class in full —
`am start -n <applicationId>/com.dshmobile.host.MainActivity` (the class is
namespace (b); the package part is identity (a)).

The device-swap boundary is accepted honestly: `adb install -r` of the new id
installs a SEPARATE app — the old `com.dshmobile.host` container (its journal
and Keystore-sealed keychain refs) does not migrate; the new container starts
fresh, and the keychain orphan face is the same class D19 already accepted on
iOS. (Emulator evidence: both packages installed side by side —
`/data/user/0/com.dshmobile.host` and `/data/user/0/io.github.lixiang9716.def`
— the old container's files untouched by the new app's install and upgrade.)

The upgrade-matrix device leg (hosts/android/ci/run-upgrade-matrix.sh) is
BLOCKED, not green: the create leg's journal flush fails with the vendored
backend's "session-persistence-jsonl flush failed" — a breakage PRE-EXISTING
on current main, proven not caused by this rename by a control run of the
same restart family on a clean origin/main tree with the OLD id (identical
failure mode) and by the CLI one-command repro (`sh
runtime/dsh/ci/run-session-persistence-e2e.sh` on clean main: both legs log
pass, the process exit flush fails; filed as a separate issue). The leg's
mechanical path under the NEW id ran to the flush: build A (probe shipped)
installed fresh, the create leg completed a real journaled turn (turn/end in
the canary), so identity, install, launch, and AssetSync faces all work; the
journal-survival proof itself waits on the flush fix.

## Alternatives considered

- Keep `com.dshmobile.host` — beat: it claims an unowned domain and is the
  exact residue D19 left for this landing; the appId token row would keep
  pinning the unowned spelling into every new runner.
- Rename the Java namespace (`com.dshmobile.host` → `io.github.lixiang9716.def`)
  in the same change — beat: it churns ~60 Kotlin files, the JNI symbol
  table, and the source-tree paths for zero device-visible gain; the two
  roles are independent, and the namespace no longer impersonates anything
  (it is invisible to users and to the device identity).
- Derive the share authority from `${applicationId}` (manifest placeholder)
  instead of spelling it — beat: the gate's design is each layer SPELLS the
  token so a count catches drift; a placeholder hides the literal and would
  have needed a layer-map exemption commit for no functional gain.
- Stage the rename per platform (Android first, Harmony later) — beat: the
  appId row is one token across both hosts; a split landing leaves the gate
  red between PRs and doubles the device-re-install blast radius.
