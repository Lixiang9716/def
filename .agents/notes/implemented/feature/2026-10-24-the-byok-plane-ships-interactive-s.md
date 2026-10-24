# Agent Note: the BYOK plane ships on the interactive seats — census Gap#1 closes

Status: implemented
Related: #674, #679, #684, #685, #686, #687

## Problem

The mock census (2026-10-23) confirmed the official client cannot leave mock: the
Models page's 添加提供方 form was inert (no configurable-provider directory), the
plane behind it unmounted, and no device closure could even load the pi-ai plugin
the BYOK mount needs. A user installing the release APK/IPA had no way to bring
their own key on-device.

## Decision

The plane ships, in four composited landings: the `piaiSection` gate behind the
boot option (#679), the Models-page save composing the serving credential (#684),
the device closure staging the plugin chain's bytes on all three hosts (#687), and
the `byokModels: true` flip on every interactive seat's config (#685). The flip's
acceptance is the Android page-open pin — the only interactive cold-boot leg in the
DAG — green in CI with the flip riding the closure, after it caught the missing
closure in the first place.

Census disposition: Gap#1 closed (this), Gap#2 closed (#684), Gap#3 closed (#682).
The remaining honest-boundary note: the on-device UI-drive of the full add-provider
loop (tap → save → REAL turn on the device screen) has no dedicated E2E leg — the
layers are individually leg-proven (models-byok-add 12/12, onboarding 15/15,
byok-piai-anthropic real-wire turn, page-open pin) and compose by contract, but a
single device-surface leg driving the official UI end to end is the one piece a
future 2.2-adjacent leg could still add.

## Alternatives considered

- **Silent degrade when the package is absent** (#686 review): rejected — an
  interactive surface advertising BYOK while booting without it recreates the
  "mock pretending configured" disease; fail-loud surfaced the gap.
- **Gating the flag per-host on closure presence**: D5-legal but pointless — the
  closure landed in the same stack; the unconditional flip is the honest default.
