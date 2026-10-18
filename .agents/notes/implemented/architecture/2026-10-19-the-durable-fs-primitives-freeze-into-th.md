# Agent Note: The durable-fs primitives freeze into the contract as v1.11.0

Status: implemented
Related: D5

## Problem

Issue #571 pinned the root cause of the silent session loss: the vendored jsonl
backend's durability contract rides on a write path whose real-disk mirror is
best-effort by design (the fs shims' `wsMirrorWriteReal` swallows ENOSPC), so a
full volume truncates the journal to zero with no named surface. The mitigations
(#580 sentinel, #584 watermark guard) name and refuse the loss but cannot cure
it — the cure is a real-fs write path for the sessions root, and the frozen
contract (v1.10.0) had no surface for what that path needs: an atomic durable
publish and an explicit durability barrier. D5 forbids implementing either
before the contract shapes exist.

## Decision

The adopted proposal `contract/proposals/2026-10-18-durable-fs-native.md`
(owner go 2026-10-19) folds into the contract as **v1.11.0 (additive)**:
`fsPublishAtomic` (#32, `fsWrite` flag) and `fsSync` (#33, `fsRead` flag), with
semantics in primitives.md §4 "the durable-fs primitives", typed shapes in
primitives.d.ts, both bilingual pairs re-confirmed, contract/README (en+zh)
brought current through v1.11.0 — it had drifted at v1.8.0 — and the proposal
header flipped to ADOPTED as the rationale record.

The frozen law of the pair: publish is RENAME-based (same-directory temp →
write → fsync(file) → rename → fsync(directory), one host step — the sequence's
atomicity cannot survive gateway round-trips), a `link` primitive is named dead
in §8 (Android SELinux denies link(2) for app domains — measured, #587), and
the directory fsync after rename is mandatory (the crash-durability of the
rename itself). §7 carries the freeze-moment honesty note: no host implements
the pair yet — every host answers `unavailable` until the per-host follow-ups
land. Two fold deltas over the proposal draft, recorded in the fold note and
the proposal header: `bytesB64` → §3's `bytes: Uint8Array` (base64 is the wire
encoding, not the contract shape), and `{ bytes: n }` → `{ written }` mirroring
`fsWrite`, with no empty `opts` (optional fields are a minor bump away, §8).

## Alternatives considered

- **Freezing the draft shapes verbatim (`bytesB64`, `{ bytes: n }`, empty
  `opts`)**: rejected — §3's own law says bytes are `Uint8Array`; one primitive
  with a differently-shaped byte parameter would break the table's coherence
  for a wire-level spelling. The marketplace/socket folds set the precedent of
  documenting draft-shape deltas at fold time.
- **Composing the dance from existing `fsWrite` + `fsRename` from JS**: the
  temp+fsync+rename+dirfsync sequence cannot be atomic across two gateway
  round-trips; a partial-sequence crash is exactly the 0-byte-journal failure
  class of #571.
- **A `link` primitive (the backend's own dance)**: measured dead on Android
  for app domains (#587 battery); a contract primitive a first-class host
  cannot serve is a defect of the contract — named dead in §8, not deferred.
- **Waiting for the per-host implementations to co-design the shapes**: D5 is
  contract-first precisely so implementations negotiate against frozen shapes;
  the #587 battery already measured every platform fact the shapes depend on
  (link policy, dir-fsync availability, rename-base portability).
