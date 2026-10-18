# appshell M3: the action loop-back numbers and the incremental-update seam

Status: implemented
Date: 2026-10-18
Class: feature
Related: PR #582 (the L2 leg + surfaceId registry), PR #585 (the L4 browser leg), plan `.zcode/plans/appshell-morph-plan.md` §M3, T-0252

## Problem

M3 owed four measured rows — local response ≤50ms, loop closure ≤15s,
incremental update ≤40% of a full re-render, post-update DOM parity with
zero stale nodes — but the "incremental" row was unsatisfiable as the
contract stood: appshell_update validated a FULL spec (tabs and all), so an
update payload could never be meaningfully smaller than a re-render. And no
update ever reached a client: the auto-apply path (D-4's single-surface
in-place replace) did not exist — an update card offered only a manual open
button, and the carrier answered action loop-backs with the generic echo
turn.

## Decision

- **The incremental contract seam**: appshell_update now accepts a FULL or
  INCREMENTAL payload — `screen` replaces the tree, `theme`/`tabs`/`actions`
  override when present, everything else stays from the render. The plugin
  merges the payload over the STORED render origin (the surface registry
  became id→spec) and runs the four gates on the merged form; the echo
  returns the payload AS RECEIVED, so the wire and the model's output tokens
  stay small; the stored origin advances to the merged form (updates
  compound). `mergeUpdate` lives in lib/validate.js with a byte-twin in the
  client's appshell-core.js — the lockstep is pinned by a panel test on
  shared inputs.
- **The client auto-apply**: a completed appshell_update item whose echo
  carries a spec re-renders the OPEN surface in place — once per callId
  (structure bumps re-render items), merging the payload over the open
  surface's spec (appshell.js now remembers it; closeSurface clears it).
  The update card's open button remains for surfaces opened later.
- **The carrier's loop-back answer**: a tagged `[appshell:…]` user turn now
  plays an appshell_update script — an incremental screen-only payload plus
  the matching surfaceId (`dev-app-<render turn>`, tracked by the session)
  — exported (`APP_SHELL_UPDATE_SPEC`, `appShellUpdateScriptFor`) so the
  leg measures the very bytes the wire carries.
- **The M3 leg** (`appshell.m3`): `run-appshell-m3.sh` lands the registered
  evidence set (6 milestones) with the measured values in the receipt —
  **local 0.1ms** (≤50ms), **loop 855ms** on the deterministic mock
  transport (≤15s; the real-model tier belongs to the M4 cost ledger),
  **incremental 32.3%** (214B vs 663B, ≤40%), **post-update DOM 8/8 with
  zero stale nodes**. Threshold judgments are in-test assertions, not
  post-hoc reads of the numbers.

## Alternatives considered

- **Echo the merged spec from the plugin** — rejected: the tool result rides
  back into the model's context; echoing the full merged form would re-pay
  the tokens the incremental payload just saved. Both sides merge from the
  same origin bytes (the client rendered from the render echo), so the
  twin-merge design loses nothing.
- **Keep update full-spec-only and measure "incremental" as a smaller full
  spec** — rejected: dishonest — the ratio would measure a smaller APP, not
  a smaller PAYLOAD for the same app.
- **Server-side re-render push (surface events)** — out of scope: specs ride
  session content by the #567 proposal (zero new channels); the fold-driven
  auto-apply is the same events the timeline already consumes.

## Consequences

- M3's four rows are recorded and judged; the remaining M2-M4 debts are M4's
  cost ledger (morph/update P50/P95, e2e ≤20s — the real-model tier) and the
  text-safety spot-check table.
- The L2 spine leg's update phase (full-spec payloads) still passes — full
  payloads merge to themselves by construction.
- The dev-carrier morph leg (L4) is untouched; its milestone counts did not
  move. The carrier's render echo surfaceId and the update script's are the
  same scheme (`dev-app-<turn>`), so a future multi-update scenario compounds
  naturally.
