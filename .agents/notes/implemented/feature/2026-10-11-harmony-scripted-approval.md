# The scripted-approval seam — the approval dialog answers itself, human-shaped

## Problem

The Harmony host's approval is a custom ArkUI dialog (the HostPhase
presenter), and only a human finger could answer it. Every drive leg that
meets an approval needed live UI automation (drive-binding's Approve tap),
and the create-approve-hotmount loop's create-card leg — whose whole point
is an unattended present → approve → registry → face chain — had no way to
run. The Android host has the seam (`--es dsh.script.approval
approve|remember|decline`, UiPrimitives.scriptAnswerIfAsked); Harmony had
none.

## Decision

The Android twin's shape, mirrored:

- The launch want `--ps dsh.script.approval approve|remember|decline`
  stages through EntryAbility.onCreate into E2eLeg (the launch-param
  parking lot) AND into AppStorage under the `dsh.script.approval` key —
  OfficialServe's scriptApprovalFlag already reads that key for the
  /api/state row, so both seats see the same flag. An unknown value fails
  loud (hilog error) and stages NOWHERE — a typo must never auto-approve.
- The dialog still PRESENTS (the native path is exercised), then
  `Index.scriptAnswerIfAsked` self-answers 350 ms after present: the same
  approvalResolve the human onPick takes, the same controller close, the
  same ui-wait → ui-done marker pair around it. 'remember' maps to this
  dialog's Approve (the ArkUI dialog has no remember button).
- One answer per presentation: the seam and a live tap can race, both run
  on the main thread, and whoever takes approvalResolve first wins — the
  other finds null. A human tap after the scripted answer is a no-op.
- hilog carries `dsh.approval: script answered <mode>` (the Android
  Log.i("dsh.approval", …) twin).
- drive-binding.mjs grew `--script-approval <mode>`: the drive STANDS DOWN
  on the Approve tap when the want is staged, so "the approval answered
  with no UI action" is a provable statement — the drive log then carries
  no Approve tap at all.

## Alternatives considered

- Answering in HostPhase.handleApproval without presenting — rejected:
  the native dialog path is the thing under test; the seam must exercise
  it (the Android twin presents too).
- AppStorage only (no E2eLeg) — rejected: E2eLeg is the established
  launch-parameter parking lot every leg reads; AppStorage alone would
  hide the flag from the page-side consumers and split the seam's source
  of truth. Both, one writer (EntryAbility).
- No drive flag (let the 500 ms poll race the 350 ms seam) — rejected:
  the tap would usually lose but the proof would read as a race outcome;
  the stand-down makes the no-UI-action claim exact.
