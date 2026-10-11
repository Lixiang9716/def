# The calendar-live runner cleans its staged credential and keeps failing evidence

## Problem

The review round measured two defects in `hosts/android/ci/run-calendar-live.sh`:

- A green run stages the real API key into the app container
  (`files/profiles/default/llm/config.json`, resolution source 2) and never
  removes it. A later credential-less run then silently inherits it through
  source 2 and runs a REAL turn where the honest blocked verdict was
  expected — the reviewer had to `pm clear` to reproduce the blocked
  receipt at all — and the key lingers in plaintext in a debuggable
  container on a shared emulator.
- The evidence dir is per-run overwrite-style, and the failure paths
  (`die` after a red checker, a watchdog exhaustion, a key-leak hit) leave
  it in place for the NEXT run to overwrite. The round's one checker-red
  run left no evidence to diagnose: an unattributable failure, forever.

## Decision

- After the staging step succeeds, the runner installs its exit trap to
  remove the staged credential on every exit path (`rm -f` via `run-as`,
  failures swallowed — the container may already be gone). The header
  documents the invariant: a run leaves the container as it found it.
- A failing run now moves its evidence dir aside to
  `$OUT.failed.<utc-timestamp>` before dying (checker-red, watchdog
  exhaustion, key-leak hit), so the next green run starts a fresh `$OUT`
  and the failing evidence stays examinable.

## Alternatives considered

- Cleaning the credential at the START of the next run (a pm clear in the
  blocked path): rejected — the blocked path must stay launch-free (its
  receipt says "not launched"), and the leak window between runs remains.
- Timestamped evidence dirs for EVERY run (green included): rejected — the
  receipts convention is one evidence dir per leg path; the green path
  overwriting its own predecessor is the documented behavior, only the
  failure path needs preservation.
- Preserving evidence by copying instead of moving: rejected — a copy
  leaves the original in place for the next run to overwrite anyway, and
  the dir can carry megabytes of logcat dumps.

## Consequences

The blocked verdict is reproducible again without manual `pm clear`, and a
flaky red run can now be diagnosed after the fact. The A4 stability claim
should be read as "N-of-M green + preserved failing evidence for the rest",
never as an unconditional green.
