# Agent Note: ishRun retires from the iOS host face — the engine stops building, the row answers unavailable

Status: implemented
Related: D16

## Problem

The shell seat switched to dsh-shell-js (2026-10-11) and the JS/marketplace
face of dsh-shell-ish is already retired (#496), but the iOS host still built,
linked, and declared the vendored iSH engine end to end: `IshPrimitive.swift`
implemented `ishRun`, `Bridge.h` included `dsh_ish.h`, two pre-build phases
fetched the Alpine rootfs and built `libdsh_ish`/`libishcore` per SDK, and
`CRuntimeFactory` declared `DSH_ISH_ROOTFS` (with the `ish.rootfs.declared`
launch record) so the shell plugin would offer its tool. Every piece is dead
weight once the engine's consumers are gone — and each build paid for a
400k-line engine the app can no longer honestly promise. The contract entry
itself cannot go: `primitives.md` is frozen at v1 (D5) for the life of major
version 1, and §7#1 requires that a host without a surface answers
`unavailable` — "absence is information for negotiation, never faked". The
retirement must therefore remove the implementation while keeping every call's
answer contract-honest.

## Decision

The iOS host stops building and declaring the engine; the row keeps answering:

- Deleted `IshPrimitive.swift`, the `dsh_ish.h` bridge include, both ish
  pre-build phases (`FetchIshRootfs`, `BuildIshEngine`), the engine link face
  (`-ldsh_ish -lishcore -lz -lresolv` and the engine `LIBRARY_SEARCH_PATHS`
  — `-lz`/`-lresolv` are the engine's own deps, "used by nothing else in the
  link" per `src/build.sh`'s `--no-ish` branch), and `gen.sh`'s rootfs fetch
  step. `-lsqlite3` stays: the node:sqlite seam links it directly
  (`DSH_WITH_SQLITE`). `DSH_ISH_ROOTFS` and the `ish.rootfs.declared` record
  are gone from `CRuntimeFactory`; the DSH_-prefixed launch-env passthrough
  (E2E mock endpoint) stays.
- The `ishRun` row is NOT deleted, and this is the measured decision: with no
  handler registered, `GatewayCore.dispatchKnown` settles the call `denied`
  ("primitive not granted") — the same deviation the audit records for Android
  (denied) and Harmony (invalid), not the §7#1 honest answer. The row keeps
  its place in the serving table and answers a minimal `unavailable` from a
  registered handler in `FSPrimitives.register`; the audit line then reads
  truthfully `granted`/`unavailable`.
- The descriptor's disclosure carrier changes accordingly: it was ARCHITECTURE
  §12 prose while the primitive truly served a guest; now the gateway's own
  answer is the disclosure — every `ishRun` call settles `unavailable`
  ("retired: this host ships no guest userland"). The row stays in the
  descriptor's `available` array on purpose: `gateway-binding` pins the
  counts exactly (`available: 35`, `unavailable: 2`,
  `test/e2e/scenarios/gateway-binding.json:16-17`) and pins the `unavailable`
  face to the two phased camera rows
  (`runtime/dsh/scenario/gateway-binding.js:47,104`). Deleting the row would
  make the count 34; moving it would make the face 3 — both red, and both are
  shared runtime/contract changes that belong to the cross-host §7.1
  alignment, not to this host-face removal.

## Alternatives considered

- Delete the row outright (the audit's §6.B default): lost on the measured
  fallback — it answers `denied`, replicating the cross-host deviation the
  retirement is supposed to fix, and it breaks the pinned 35/2 descriptor
  counts.
- Move the row to the descriptor's `unavailable` array (the phased-rows
  shape): the contract-cleanest face, but it widens a face the shared
  scenario pins by name, so it cannot ship from a host-only PR; recorded here
  as the follow-up for the §7.1 alignment change that fixes Android and
  Harmony in the same stroke.
- Keep the build phases but neutralized: dishonest dead weight — the phase's
  own comment makes CMake the freshness authority, and a phase that builds
  nothing is a phase that fails nothing.

## Consequences

- `EXCLUDED_ARCHS[sdk=iphonesimulator*]: x86_64` outlives the engine as
  recorded status quo (the comment now says so); re-enabling the Intel
  simulator slice is untested here and is its own change.
- `dsh_runtime_new_declaring`'s `note:` parameter is currently silent — no
  launch fact has taken the guest's place; it stays as the launch-record
  channel.
- A directly installed dsh-shell-ish tarball (off-marketplace) would still
  install — `ishRun` remains in the available face — and its tool calls now
  settle `unavailable` instead of running anything.
