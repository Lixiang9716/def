# The release seat gets its CI leg — build, sign, boot, and assert the state seam
Status: implemented

## Problem

The product seat (bootRelease — no intent extras, no verification drive)
had only manual verification; every Android CI leg drove the debug flavor
with extras. Nothing guarded the release boot end to end: the signed
release APK installing, the SessionServe spine coming up on-device, the
runtime claiming its endpoints, and the /api/state seam answering. The
page-open pin (run-page-open.sh) guards one slice (the webview navigation)
but asserts neither the state seam nor the claimed surface, and it
requires the APK to be built+signed OUT of band.

## Decision

`hosts/android/ci/run-release-seat.sh` — one invocation drives the whole
leg, modeled on the page-open pin and the debug legs' disciplines:

1. `assembleRelease` (or `--skip-build`), then apksigner with the DEBUG
   keystore (`~/.android/debug.keystore`, pass android) — the CI pattern
   from dev-android.yml; not a distribution signature. apksigner is
   discovered (`$ANDROID_HOME/build-tools/35.0.0` first, then any
   build-tools, then the Homebrew SDK path) so both CI and dev machines
   work.
2. No keystore → SKIP LOUD (exit 0, the message names the exact keytool
   line): the leg refuses to mint credentials it was not handed.
3. Boot poll + install (`-r`, with the page-open pin's loud
   uninstall-and-fresh fallback on a cert mismatch), then the DEFAULT
   seat with NO extras — the product boot.
4. Rule 8 everywhere: poll the logcat dump for the
   `dsh.serve: origin token=… port=…` line (deadline 180 s — the spine's
   measured 30-55 s cold boot), forward the port, then poll GET
   /api/state (deadline 90 s) until `claimedEndpoints` is non-empty AND
   the `app` block exists. The line and the seam survive -DDSH_RELEASE:
   both are Kotlin Log.i / HTTP-plane surfaces, not JS logger records.
5. Screenshots (origin, state) and a receipt recording the assertion
   (`stateSeam: {snapshot, claimedEndpoints, appBlockPresent, asserted}`)
   land under hosts/android/artifacts/release-seat/.

## Alternatives considered

- Extend run-page-open.sh into this leg: rejected — the pin has its own
  narrow contract (devtools /json/list) and its own CI step; a second
  concern grafted on would blur both failure surfaces. A sibling runner
  keeps each leg's assertion one-to-one with its name.
- Assert a FIXED endpoint count: rejected — the claimed set grows with
  the composition; the honest assertion is non-empty on a healthy boot
  (measured 76 rows) plus the app block's presence, not a pinned number
  that turns every composition change into a red leg.
- Drive the release build with extras to reuse the debug legs' checker:
  rejected — MainActivity's release boot refuses drive extras LOUD by
  design (the verification machinery is compiled out); the leg asserts
  the product's own seams instead.

## Consequences

- The release seat is CI-guarded for the first time: build → sign →
  install → boot → spine-up → claims → seam, every step deadline-bounded
  and loud on exhaustion.
- A release boot that never opens its origin, or opens it with zero
  claimed endpoints, now fails a named leg instead of only failing the
  page-open pin's narrower navigation check.
- Proven on emulator-5554: single-invocation green, 76 claimed endpoints,
  app block present, screenshots + receipt committed.