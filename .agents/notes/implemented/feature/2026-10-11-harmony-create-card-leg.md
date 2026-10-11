# The create.card leg — riding the spine seat, and the eval trigger that had to be the seat's own web.boot

## Problem

The create-approve-hotmount loop's PR-2/PR-3 scenario (`create.card`) had
no Harmony arm: the dispatch table died fail-loud, and nothing on HarmonyOS
had ever exercised plugin_create against a live cordis spine — write the
workspace package, answer the approval, install the registry row, mount the
plugin, render its card. HarmonyOS needed the leg AND an honest answer to
whether the OfficialServe seat exposes the gateway@1 face the scenario
negotiates.

## Decision

- The gateway face needed nothing: `__dshGatewayNegotiate` is a version
  compare (dsh_runtime_host.c js_gateway_negotiate) installed by the C host
  on EVERY runtime it starts, and OfficialServe.startRuntime calls the same
  hostStart — verified before any code.
- `Index.runCreateCardLeg` (LEG_CREATE_CARD): construct an OfficialServe,
  `beginInteractive` (the full vendored spine: commands registry + skill
  plane + the runtime.config workspace/model route), hook
  `serve.onCardRecord` → the PiP face, share the page's approval dialog
  (aboutToAppear already registers it into OfficialServe's static store, so
  the H2 scripted-approval seam answers here too), and EVAL the canonical
  scenario when the seat's own `web.boot` lands (`onWebBoot`, one-shot).
- The web.boot trigger is the whole decision. Measured on-device: an eval
  keyed on the runtime.config delivery raced the composition —
  plugin_create answered "no cordis spine on this seat" because
  composer-web-live's bootPhase (bootUpstream → the cordis Loader →
  dsh-create's apply/spine capture) resolves AFTER the config lands and
  BEFORE web.boot. web.boot is the first bus message that cannot exist
  without the live spine. Two more measured traps: a stale workspace
  (plugins/ + the dsh.plugins registry row persist in the app files dir)
  replays at the spine boot and the leg's mount answers "already mounted"
  — the runner sweeps with `bm clean -d` (a shell rm cannot: the
  app-created plugin files refuse the shell uid); and the canonical
  scenario's success predicate was stale against dsh-create 0.1.6-alpha.2's
  live-mount message (已作为真实 cordis 插件在线插入, not the pre-cordis
  已安装并激活) — it failed the leg AFTER the mount had succeeded; the
  predicate now accepts both spellings.
- `ci/run-create-card.sh` + `create-card-harmony.json` (extracted from the
  actual run): the run-card-player machinery, the approval's hilog line
  echoed, the face shot keyed on the mounted plugin's own `card.posted`
  present marker (the card.present bus line never reaches hilog).

## Alternatives considered

- Eval on the runtime.config delivery (my first trigger) — rejected on the
  measurement above: it is the config handoff, not the composition done
  signal; the race is structural, not timing luck.
- HostPhase seat with a minimal face (the ask's fallback) — unnecessary:
  the OfficialServe seat exposes everything the scenario needs (verified
  gateway seam + evalEntry + the card routing #455 shipped), and the
  bare-seat path would LOSE the spine the mount requires.
- Fixing only the Harmony copy of create-card.js — rejected: the scenario
  is canonical (one file, every host); a stale predicate fails iOS/Android
  the same way, so the fix lands in runtime/dsh.
