# Row 16: resource starvation — disk-full journal, low memory

Status: implemented

## Problem

The persistence contract's failure half was unproven: what happens when
the journal's volume is FULL (does the failure surface named, does the
on-disk journal stay intact, does the durable prefix stay honest), and
what happens when the engine runs out of heap (is the failure catchable,
or does the process die mid-turn). Test-hardening row 16 asked for both.

## Decision

`runtime/dsh/scenario/resource-starvation.js` +
`runtime/dsh/ci/run-starvation.sh` + two checker manifests, one scenario
id (`resource.starvation`), two faces:

- **journal** (three dsh-cli processes over ONE pinned container on a
  runner-owned 8 MB hdiutil volume, journal written PLAINTEXT via the
  boot row's `compression: 'none'` — a compressed journal would make the
  integrity gate a compression question): `pre` establishes the durable
  baseline AND GROWS the journal past the APFS reserve floor with real
  ballast turns (the fill targets free < J, where J is the journal size —
  the jsonl flush is an atomic temp+rename needing J free bytes, so
  free < J is the exact exhaustion condition; blind filling cannot get
  there because APFS refuses plain writes ~9% above true zero — measured:
  1.6 MB "free" that the backend's temp copy happily absorbed); `full`
  boots on the starved volume and demands the write failure be NAMED — a
  rejected flush, an agent/error record, or a stat refusal; silence is
  the defect; `recover` (space freed) must restore EXACTLY the durable
  prefix the full leg restored — the runner cross-checks the two restored
  counts, so a failed-flush record coming back durable fails the leg —
  and the next turn flushes clean.
- **heap**: `DSH_HEAP_LIMIT_MB`, a new C-host test knob
  (`dsh_runtime_new`, process env, uncapped when unset — the sibling of
  the stack knob): quickjs turns the cap into a CATCHABLE named
  out-of-memory inside the allocation loop, and the scenario demands the
  host still answer a small operation afterwards. A process kill is the
  failure this face rules out. Measured: the 12 MB cap tripped at
  allocation round 44, caught, host alive.

## Alternatives considered

- The Android emulator seat (real devices run full more often):
  rejected for v1 — the CLI host is where heap, journal, and volume are
  all observable and hermetic; a device disk-full fixture needs root or
  a co-app, and the failure surfaces through the same vendored backend.
- Faking ENOSPC at the gateway fs seam (a counting stub that refuses
  after N writes): rejected — rule 6, the wrapper would verify itself;
  the real syscall against a real full filesystem is the evidence.
- Blind volume filling to 100%: rejected after measurement — APFS's
  reserve makes "100%" unfalsifiable from userspace; targeting free <
  journal-size (the flush's own requirement) is the mechanism-true
  condition.

## Landing state (honest)

This landing carries the HEAP face green (the knob + the catchable-OOM
proof) and the disk-full journal face as a WORKING DRAFT — the growth
fixture fights the CLI host's storage mapping (the smoke backend's scope
mapping vs the workspace VFS mirror), and the runs surfaced two real
host/backend findings filed separately (the ~32 KB httpFetch silent kill;
the jsonl backend's silent disk-full loss — events past ENOSPC vanish
without any named surface). Row 16 stays half-landed by this PR: the doc
row says exactly that, and the journal face lands with the fix planes
(upstream named write-errors, or the host-plane disk-space guard).

Cadence: informational — run on persistence-backend or C-host memory
changes; the journal face is macOS-only today (hdiutil), the heap face
runs anywhere the CLI builds.
