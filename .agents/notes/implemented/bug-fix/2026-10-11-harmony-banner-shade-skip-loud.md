# The Harmony notification leg's banner: forensics and the skip-loud shade

## Problem

The binding leg's notification lifecycle (notify.scheduled → background →
notify.response → foreground) was reported dead on the dsh_phone emulator:
after HOME → app.state background the drive watches for the DSH notification
and 90 minutes passed with no banner (measured 2026-10-11). The drive's
shade tap had no diagnosis for that state — it died with a bare
"DSH notification: deadline elapsed after 30s", indistinguishable from a
frozen drive or a host bug. Either the leg needs runner choreography that
works on the emulator, or the degradation must be documented and the
absence made loud.

## Decision

Forensics first (artifacts/banner-forensics/, 2026-10-11, dsh_phone
HarmonyOS 7.0.0.107): the emulator renders NO heads-up banner — the
uitest dumpLayout at notify+1s and +4s while FOREGROUND carries no banner
nodes (only the app title), matching the 90-minute background watch. But
the NOTIFICATION-CENTER ROW renders immediately ("DSH E2E … 刚刚" in
shade.json / shade.jpeg) and its wantAgent tap delivers notify.response +
the foreground edge — the SAME day, the full binding scenario passed
through that path (drive exit 0, C verdict PASS). The banner is cosmetic
degradation; the leg never needed it.

So the shipped disposition is documentation + loudness, not new
choreography:

- drive-binding.mjs documents the measured banner facts in its header and
  the shade branch now treats a missing ROW as a named diagnosis: dump the
  shade, save shade-miss evidence beside the final shot, and die with the
  mirror-degradation message (asleep/locked screen freezes the emulator's
  notification mirror; an image that drops even the row needs a real
  device) — never a silent skip, never a bare deadline death.
- hosts/harmony/README.md carries the same measured facts on the binding
  phase.

## Alternatives considered

- Runner choreography that keeps the app foreground and taps a banner —
  rejected on the evidence: no banner renders even while foregrounded, and
  the scenario itself demands the background edge between notify.scheduled
  and notify.response, so a foreground-only rhythm cannot satisfy it.
- Reporting "the banner leg needs a real device" outright — rejected as
  overstated: the row completes the leg on this very emulator (same-day
  PASS); only a missing row escalates to the real-device verdict, and the
  driver now says exactly that, by name.
