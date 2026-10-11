# Harmony's card.player drive — the HostPhase leg and the face's full projection

## Problem

The create-approve-hotmount loop's PR-1 scenario (`card.player`) was staged
for every host but HarmonyOS had no way to run it: Index.ets's leg dispatch
table had no `card.player` arm, so `--ps dsh.e2e.leg card.player` died on the
unknown-leg fail-loud branch. The Android host got its deterministic emulator
drive (#454) and iOS its own manifest; Harmony's PiP card face (#455) rendered
through OfficialServe's bus routing only — the HostPhase seat (the one every
drive leg uses) dropped `card.*` bus records on the floor. The gap: Harmony
could not prove the plugin card's bus story, end to end, on the emulator.

## Decision

- `HostPhase.beginCardPlayer` — the device-plane leg's headless shape: the
  card-player scenario as the entry, no web client mounts, carrier-side
  records suppressed, `evalEntryDirect` once the carrier is up. The seat
  provides `__dshGatewayNegotiate`/`__dshBusPost`/`__dshComplete` because the
  C host installs them on every runtime it starts (dsh_runtime_host.c), which
  is the seam the scenario's gateway@1 negotiate and bus posts ride.
- `HostPhase.onBusLine` routes `card.present/state/complete/dismiss` through
  `CardFace.handle` (OfficialServe's routing, mirrored), then fires the new
  `onCardRecord` hook; `Index.runCardPlayerLeg` hooks it to
  `refreshCardFace`, and the dispatch table gained the `card.player` arm.
- `CardFace.faceCard()` — the page's PiP bindings now read the FULL projected
  face; `snapshot()` stays the redacted `/api/state` seam (attached/visible/
  id, the #455 contract). First green run exposed this: the frame rendered
  with blank title/time/label because `refreshCardFace` read the redacted
  snapshot.
- `card.complete` retires the stale tick label so the face shows the complete
  message (the Android sibling's `complete()` shape) — binding-side the
  complete message takes the label row when present.
- `ci/run-card-player.sh` — run-mic-plane.sh's machinery (build → install →
  wake/unlock → verified launch → hilog stream) with snapshot_display shots
  at present/complete/verdict and the card-player-harmony checker; the shot
  checks run on the terminal poll iteration (the scenario completes ~800 ms
  after card.complete.posted; an until-condition poll skipped the complete
  shot on the first green run).

## Alternatives considered

- Riding OfficialServe (the release seat) for the leg — rejected: every drive
  leg lives on HostPhase; OfficialServe is the serving seat with its own
  evidence hooks, and a card leg there would need a second dispatch surface
  for no gain.
- Extending `snapshot()` to carry the full face — rejected: it is the
  /api/state seam whose redacted shape outside consumers already read (#455);
  the page needed a second accessor, not a wider seam.
- Leaving the stale label on complete (log-only proof of the complete leg) —
  rejected: the face is the product statement the leg exists to prove, and
  the Android twin shows the message; a Harmony face that keeps ticking
  "专注中" through the rest message is a divergence, not a platform limit.
