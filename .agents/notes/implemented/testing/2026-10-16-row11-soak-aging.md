# Row 11: the soak/aging leg — heap, fds, and journal integrity under sustained load

Status: implemented

## Problem

The leak canary proves 100 rounds are collectible, but nothing ages a
spine: no leg holds one session (and its by-design lifetime residency)
under sustained load while watching the engine heap trend, the host
process's fd count, and the journal's integrity as it grows to thousands
of records. Test-hardening row 11 asked for exactly that.

## Decision

`runtime/dsh/scenario/soak-aging.js` + `runtime/dsh/ci/run-soak-aging.sh`:
one spine, one LONG-LIVED session, sustained mock rounds for
`DSH_SOAK_MINUTES` (default 90 — the owner ritual; validation runs scale
the env down), sampled as it ages:

- the engine heap, raw every heartbeat, GC-collected at the brackets
  (the leak-canary discipline: collected-vs-collected), verdict PER ROUND
  — an aging session's journal is resident by design, so a fixed byte
  tolerance would red on duration alone; the budget (512 KiB/round) sits
  an order above the validation runs' steady-state reading and below the
  falsification class (a retained ~1 MiB array per round trips it 2x);
- the journal ladder: total events monotonic per round, the tail window
  contiguous every heartbeat, the WHOLE seq ladder contiguous at the
  close — a gap is a dropped record, not a reorder;
- the host-process fd count, sampled by the runner every 30s into
  `fd-samples.jsonl`, gated as final ≤ first + 32 (a climb is the fd-leak
  class; fewer than two samples skips honestly — the darwin spelling is
  lsof, linux /proc).

The captured log is verified one-to-one against
`test/e2e/scenarios/soak-aging.json` (the heartbeat row is `repeat`, the
verdict row pins `status: pass`). Artifacts:
`runtime/dsh/artifacts/macos-cli-soak-aging/`.

## Alternatives considered

- Wiring the soak into build.sh test core: rejected — a 90-minute leg
  would dominate the ~16-minute core suite; the ritual is
  owner-invocable exactly like the simulator matrix, with the committed
  validation receipt as the machinery's proof.
- An emulator seat: rejected for v1 — the CLI host is the cheapest seat
  where heap/fd/journal are all observable; a device soak adds thermal
  and carrier noise the budget discipline would have to re-measure.
- Reusing leak-canary.js with a bigger ROUNDS: rejected — the canary
  creates a fresh session per round and never exercises the aging class
  (one journal growing across the whole run), which is row 11's point.

Cadence: informational — the 90-minute ritual runs before releases or on
dispatch-seam/persistence changes; never a gate.
