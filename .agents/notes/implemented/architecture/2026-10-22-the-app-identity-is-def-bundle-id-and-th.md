# Agent Note: the app identity is def — bundle id and three-platform display names

Status: implemented
Related: D19

## Problem

dsh-mobile is not a DeepSeek product, but every identity surface said otherwise.
The iOS bundle id `org.dsh.DSHHost` reverse-DNS-claims `dsh.org`; the Android
applicationId and Harmony bundleName (`com.dshmobile.host`) claim
`dshmobile.com`; and the home-screen names — iOS "DSH Dsh", Android
"DSH Dsh Host", Harmony "DSH M1 Dsh" — read as the official DSH app on the one
surface users actually see. The owner ruled the impersonation reading
unacceptable: a third-party ecosystem host must not be installable as if it
were DSH-official. The mic usage string carried the brand too ("DSH Dsh records
audio…"), and 30+ runners/tools/docs hardcoded the old id, so the rename had to
be repo-wide to stay coherent.

## Decision

The app identity is def (D19). The iOS bundle id is
`io.github.lixiang9716.def` (bundleIdPrefix `io.github.lixiang9716`), the
CFBundleDisplayName is `def`, and the usage strings are de-branded. Android's
`android:label` and Harmony's `app_name` (plus the entry ability labels) are
`def`. Every runner, tool, and doc now spells `io.github.lixiang9716.def`
(`git grep org.dsh.DSHHost` matches only committed evidence, a historical
note, the AOCI index, and the D19 row's own record of the old id). The iOS
generator is the single source: `gen.sh` regenerates both the Info.plist and
the xcodeproj with the new identity. Internal build identifiers stay
deliberately: target/project/scheme `DSHHost`, the `.app` paths, and the
DerivedData layout are developer-facing, not user-facing, and renaming them
would churn every runner for zero visible gain. The Android applicationId and
Harmony bundleName keep `com.dshmobile.host` until the follow-up change
renames them together with the `transport-tokens` appId row — a cross-layer
rename with device re-install blast radius, kept out of this landing on
purpose (tracked as a follow-up issue).

## Alternatives considered

- Keep `org.dsh.DSHHost` — beat: it claims a namespace we do not own and is
  the exact impersonation reading the owner rejected; personal-device testing
  under it also bakes the id into keychain storage before the fix.
- Unify all three hosts on `com.dshmobile.host` — beat: still claims an
  unowned domain (nobody owns dshmobile.com) and keeps DSH-branded letters in
  the phone-visible identity.
- `dsh-mobile` as the display name — beat: keeps the DSH letters on the home
  screen; the ecosystem association belongs in the README ("a mobile host for
  the DSH ecosystem"), not under the icon. def was already the product name
  (Pages landing + README banner since 2026-09-27), so it costs no new concept.
- Repo rename in the same change — beat for sequencing, not substance: the
  GitHub rename is an owner Settings action; bundling it here would break the
  Pages URL before the rename happens. The reference sweep lands after it.

## Consequences

Keychain storage is scoped to the bundle id, so credentials saved under the
old id are orphaned — first run under def starts with an empty keychain and
BYOK keys are entered again. Devices and simulators keep the old app until it
is uninstalled; the two ids coexist as separate apps, not an upgrade. Anyone
with a locally generated `DSHHost.xcodeproj` must re-run `sh hosts/ios/gen.sh`
once after pulling, or xcodebuild keeps signing the old id.
