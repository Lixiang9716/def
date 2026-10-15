# Agent Note: create-card drive row restored — the #464 salvage missed MainActivity's dispatch branch

Status: implemented
Date: 2026-10-15
Class: bug-fix
Refs: #464, #501, BindingDrives.kt, run-create-card.sh

## Problem

`run-create-card.sh` (scenario `create.card` — the create→approve→hotmount
cordis-plugin chain) timed out on the emulator: the app booted the default
seat and ran `session.mock-llm` while the drive's `--ez dsh.createcard`
extra was never read. The committed evidence (10-11) suggested the leg
worked, so this read as an environment flake for one run before the
second run with full logging proved otherwise: zero `create.card` events
in the captured stream while `session.mock-llm` passed.

## Decision

MainActivity's launch-leg chain has no create-card branch and never did on
main: `BindingHost.startCreateCard` shipped as an uncalled factory. The
#464 salvage ("the fixes main lacks") carried the runner, the scenario and
the green evidence out of the gaps worktree, but the worktree's dispatch
branch did not make the cut — the leg has been uninvokable on main since
(#464's merge). Fix: extract the drive dispatch into
`BindingHost.dispatchDrive` (BindingDrives.kt — the launch table's home,
matching the file's own charter), add the create-card row, and wire
`EXTRA_CREATE_CARD = "dsh.createcard"` into MainActivity's extra chain.
`startBinding`/`startHost` gain the `createCard` flag following the
cardPlayer pattern; MainActivity stays under the 500-line cap because the
dispatch extraction (−16 lines) pays for the additions (+5).

## Alternatives considered

- **Fix the runner to pass a key the app reads** — rejected: the app is
  the contract; the factory existed and only lacked a dispatch row, and
  teaching the runner a second extra spelling deepens the drift.
- **Delete the factory and the leg** — rejected: the create→approve→
  hotmount chain is the cordis custom-plugin acceptance path (#501's
  subject); the committed 10-11 evidence proves it worked when wired.

## Consequences

The create-card leg is invokable on main again (12/12 fresh receipt,
18:06). Any future drive factory must add its row to `dispatchDrive` —
the function's docstring now says so with this incident as the measured
reason. The stale committed evidence (10-11) rode #464's PR undetected
because no CI leg invokes this runner; the emulator run that caught it
was driven by hand.
