# The release serving seat's scenario-level boot death reaches no NSLog channel

Status: implemented
Date: 2026-11-14 · Class: bug-fix · Issue: #799 (the observability follow-up PR #797's note named)

## Problem

A JS-side boot failure in the iOS RELEASE interactive seat is invisible —
every failure channel is dark at once:

1. the runtime half's fail gate emits `scenario.failed` through the unified
   logger at info level — stripped by `-DDSH_RELEASE` (rule L4);
2. `SessionServe.onRuntimeSettled` is declared (and invoked by the
   `WebBootRuntimeDrive.onComplete` relay) but never assigned in the
   user-facing boot: `AppDelegate.runServingBoot` wires only `onOrigin`,
   `onCardEvent` and `onRuntimeFailure`;
3. `WebBootRuntimeDrive.onFailure` only fires for DRIVE-level failures
   (eval/pump/settle C-side errors) — a scenario's own `__dshComplete(false)`
   reaches `onComplete`, whose seat hook is nil;
4. no FAIL-spelling NSLog fires, so the page-open pin's FAIL scan
   (`FAIL |runtime failed|bootstrap failed`) sees nothing and the boot
   stalls silently to the pin's 180s deadline — and the user sees the same
   thing from the other side: “正在启动 DSH…” forever.

PR #797 fixed the staging root cause of the #691 stall; its note explicitly
deferred this fail-silence ("it would have turned the silent stall into a
LOUD stall without fixing the boot — the observability gap is named in the
follow-up issue instead"). This change is that follow-up: it does not make
any boot succeed or fail differently, it makes a failing boot speak.

## Decision

`AppDelegate.runServingBoot` assigns `serve.onRuntimeSettled`: on
`passed == false` it NSLogs the unified string
`dsh.session.serve: runtime failed: <message>` — the same grep face the
page-open pin already scans (`runtime failed`) — and hands the reason to
`showBootFailure`, so the boot screen names the failure instead of leaving
the spinner up. The block mirrors the neighboring `onRuntimeFailure` path
exactly (same prefix, same main-thread hop for the label); `passed == true`
is a no-op (a passing settle is the boot succeeding — the overlay is
retired by the page render). NSLog is a HOST channel and survives
`-DDSH_RELEASE`; no JS-logger change ships (the fail gate's release-visible
warn stays as-is per the issue).

The +8 lines pushed `AppDelegate.swift` past the code-size gate's 500-line
budget (it sat at 499), so `runServingBoot` moves to
`AppDelegate+ServingBoot.swift` — the same escape the file's sibling
`AppDelegate+Drives.swift` records ("the E2E drive launchers that outgrew
AppDelegate's file budget"). The body is verbatim; the only other touch is
`showBootFailure` losing its `private` — the navigation delegate already
calls it inside AppDelegate.swift, so it was always a shared boot-screen
helper, and the serving boot's settle channel names its failures there too.

## Alternatives considered

- Re-widen the release log strip so the fail gate's `scenario.failed` info
  record survives. Rejected: the strip IS the release contract (rules.md
  rule L4); carrying info-level boot records again re-opens the volume
  problem L4 closed. The host channel is the one that already carries every
  other serving-seat failure spelling (`runtime failed`, `bootstrap
  failed`, `rt: carrier FAIL`) — the pin greps exactly those.
- Put the NSLog inside `SessionServe` itself (a default behavior on the
  settle hook). Rejected: the seat's hook block is deliberately no-op
  defaults — which record a fact becomes, under which scenario id, is the
  drive's business (SessionServe header; the harmony precedent). A
  seat-side NSLog would fire on every evidence drive's boot too, and the
  screen-label half is not the seat's to own (it has no UI surface).
- Also complete-check after `WebBootRuntimeDrive.start`'s initial pump so a
  death INSIDE the first pump cannot miss a later `pumpAndCheck`. Rejected
  for this change: measured on the manufactured failure (the #797 class,
  `plugin_mcp_js` re-excluded), the boot dies at the spine mount only after
  gateway activity has begun, and the follow-up settle/event `pumpAndCheck`
  observes the sticky `completed` flag — the hook fires. Changing the
  drive's pump/check structure for a case that does not occur would touch
  every evidence drive's verdict path for no measured failure.

## Consequences

- A scenario-level JS boot death in the release seat now produces
  `dsh.session.serve: runtime failed: <reason>` in the unified log — the
  pin's early-verdict grep reds the run with that line instead of burning
  the deadline silently — and the boot screen shows `启动失败：<reason>`.
- The screen label and the log line carry the same reason string, keeping
  the two channels in agreement (`showBootFailure`'s contract).
- Residual (accepted): a scenario death with NO subsequent settle/event or
  page-driven delivery would still not reach `onComplete` (the initial
  pump in `WebBootRuntimeDrive.start` checks only pump errors). The pin
  still reds that case through the origin-line deadline — it just would
  not carry the named reason line.
