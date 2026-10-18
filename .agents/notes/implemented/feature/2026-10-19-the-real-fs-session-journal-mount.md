# Agent Note: The real-fs session journal mount — #571's root cure behind a boot-row gate

Status: implemented
Related: D5, T-0255 items 3–4, #571

## Problem

#571 pinned the silent session loss: the vendored jsonl backend's durability
rides the fs shims' real-disk mirror, which is best-effort BY DESIGN
(`wsMirrorWriteReal` swallows ENOSPC) — a full volume truncates the journal
with no named surface. The mitigations (#580 sentinel, #584 watermark
guard) name and refuse the loss but cannot cure it; the cure needs the
journal's real copy written through the v1.11.0 durable primitives
(fsPublishAtomic + fsSync, landed on all four hosts in #593).

## Decision

The gated real-fs publisher lives in `boot-session-persistence.js`
(`sessionPersistence.realFs`, DEFAULT OFF — ungated boots evaluate one falsy
check and stay byte-identical). At every turn boundary it republishes the
session journal through `fsPublishAtomic` (same-directory temp → fsync →
rename → directory fsync, ONE audited gateway step): success makes the
on-disk journal atomic and crash-durable; a full volume REJECTS the publish
with the failing step's name, emitted as `agent/error` — the root-cause
named surface. The sentinel stays mounted as defense-in-depth. The shape
follows the adopted proposal's non-goals exactly: the shim/VFS world does
not change, the vendored backend stays verbatim, whole-journal rewrite per
boundary (§4: "the jsonl append path is served by whole-journal rewrite").

Row 16's disk-full journal face turns green UNDER the mount: the grow leg
(`run-starvation.sh`, runner-owned 5 MB ramdisk) runs real agent turns until
the volume refuses — observed live: 253 turns, journal 2.5 MB, and the loss
named at the write boundary (`journal.starve.named by=durable-publish`), the
#571 silent-loss class ruled out at its root.

## Alternatives considered

- **Fixing the shim mirror** (make wsMirrorWriteReal durable): the proposal
  names it a non-goal — the mirror serves the subprocess seam's "copy may
  drop" consumers; changing its contract for the journal's "copy IS the
  truth" needs would couple two consumers with opposite semantics.
- **Sync publish inside the shim write path**: the shims are synchronous and
  the gateway is async (D8) — a sync bridge would deadlock the serial
  runtime; the turn boundary is the natural async seam.
- **Waiting for an upstream append-durable primitive**: deferred by the
  contract (§8) until a consumer proves the need; whole-journal rewrite
  covers the jsonl backend's real need today.

## Evidence

- `run-starvation.sh` journal leg (macOS CLI + 5 MB ram:// disk): PASS —
  7/7 manifest events, `journal.starve.named by=durable-publish`, receipt in
  `runtime/dsh/artifacts/macos-cli-resource-starvation/`.
- The manifest re-pinned from the live stream (stable keys only — turns and
  byte counts stay out of the pin); doc/test-coverage row 16 flips
  half-landed → landed (en + zh, pairing re-confirmed).
- Local `gov run` 27/27; closures byte-identical across the three host
  mirrors after restage.

## Notes and honest boundaries

- The publisher latches per session: after the first rejected publish the
  row stops republishing that session (the error is named once; the
  watermark guard and sentinel still run).
- The recover leg (space freed → clean flush) stays unrun by the runner —
  the grow face is row 16's named acceptance; recovery rides the next
  matrix pass if wanted.
