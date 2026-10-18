# Agent Note: The durable-fs primitives land natively on all four hosts

Status: implemented
Related: D5, T-0255 item 2

## Problem

v1.11.0 froze `fsPublishAtomic` + `fsSync` (#591), but a contract is only as
real as its serving faces: D5's freeze-then-implement order means every host
now owes the pair, and T-0255 item 2 names all four. The catch: each host's
fs family lives in a different layer (CLI in C, Android's product gateway in
Kotlin beside a C smoke mirror, iOS in Swift, HarmonyOS's app-scope fs in C
behind an ArkTS-declared descriptor), and the binding scenarios plus the
audit-invariant leg pin descriptor counts that all move when the table
grows.

## Decision

- CLI: the #587 fs-port layer wired into the build (src/build.sh all three
  flavors + src/CMakeLists dsh-core) and dispatched behind the fsWrite-mirror
  rejection ladder (`example/main_cli.c`), reason strings naming the failing
  step.
- Android: the product pair in `FsPrimitives.kt` — rename-based over the app
  scope (same-dir temp → write → `fd.sync()` → `renameTo` → `Os.fsync` on the
  directory fd), never `link(2)` (the measured SELinux wall, #587). SAF tree
  scopes reject `io` by name: DocumentContract has no atomic-rename face, and
  a best-effort stand-in would fake exactly the durability this pair exists
  to guarantee. The C smoke mirror (`dsh_gateway_smoke.c`) serves the same
  shapes over the fs-port layer.
- iOS: POSIX-exact in `FSPrimitives+Durable.swift` (the AppDelegate+Drives
  size-gate split precedent): each `fsSync` kind opens with its own mode
  (O_DIRECTORY / O_RDWR) so a mismatch fails the open itself — no
  stat-guessing; both app and user scopes serve under the security-scoped
  bracket.
- HarmonyOS: app-scope pair served in C over the fs-port layer in BOTH serve
  modes; the ArkTS BINDING_DESCRIPTOR and both C descriptors declare the
  rows (descriptor-parity green; 590/2048 of the host_start buffer).

The typed JS face is `runtime/dsh/fs-durable.js` (the surface.js split
precedent — gateway.js sat at 498/500 lines), staged into all three
closures: an iOS RESOURCES row, the harmony BUNDLE policy row + CLOSURE row,
and android's three hand for-lists in the stager.

## Evidence

- gateway-audit-invariant (CLI): +11 cells — success quadrant publish →
  byte-exact readback plus both barrier kinds; rejection quadrant escape /
  bad scope / missing parent / bad kind / absent path / kind mismatch —
  available 8→10, calls 48→59, 64/64 events one-to-one.
- Binding `durableLeg` ×3 hosts: publish → byte-exact readback, file+dir
  barriers, and the missing-parent / kind-mismatch / escape ladder; 7 new
  manifest rows each (gateway-binding, android- and
  harmony-capability-binding).
- Descriptor pins bumped +2 across 18 seat manifests; the harmony official
  seat's narrow 13-row descriptor intentionally unchanged (it is not the
  binding table).
- Local: gov run 27/27, descriptor-parity OK (selftest green), closures
  1230 = 1230 rawfile rows byte-identical, iOS xcodebuild BUILD SUCCEEDED,
  Android mirror C syntax-checked (the NDK build is CI's android-e2e leg).

## Alternatives considered

- **Honest `unavailable` on the device hosts** (legal for v1.11.0): rejected —
  T-0255 item 2 names all four hosts, and #571's cure chain needs the faces
  in place before the boot mount (item 3) rides them.
- **Best-effort publish over SAF tree scopes** (write-through
  DocumentsContract): rejected — it would fake the atomicity the primitive
  exists to guarantee; the honest face is the named `io` refusal, with the
  app scope (where the journal lives) fully served.
- **An ArkTS user-scope face on HarmonyOS** (forwarding non-app scopes like
  fsRead/fsWrite do): deferred — nothing consumes a user-scope durable
  write yet; the forward hook stays the seam for the day one does.
- **Serving the pair from the JS shims** (composing fsWrite + rename across
  gateway round-trips): dead by the contract itself — the sequence's
  atomicity cannot survive round-trips, which is why §4 freezes it as ONE
  host step.

## Notes and honest boundaries

- The iOS ble/mic seat pins are historic matrix values (legs outside CI);
  bumped uniformly, re-pinned by the next live matrix run — the e2e-matrix
  currency caveat applies.
- detekt baseline: the new Kotlin catch shapes may add findings on the
  non-blocking static-analysis leg; regenerate via that workflow's
  update_baselines if it reports.
- Row 16's grow leg and the boot real-fs mount ride the NEXT steps (T-0255
  items 3–4) — this change only gives every host the face.
