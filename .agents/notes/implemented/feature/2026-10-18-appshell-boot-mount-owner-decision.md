# appshell enters the spine: the boot-level mount (owner decision)

Status: implemented
Date: 2026-10-18
Class: feature
Related: PR #582 (the L2 leg + the deferred decision), PR #589 (the acceptance table naming this miss), T-0254

## Problem

Since the L2 leg, dsh-appshell was scenario-mounted: the e2e proved the
chain with the real plugin, but no product seat offered the tools — a real
conversation could never say "变成微信" and morph. The M4 acceptance table
named the deferral: "boot 级插件挂载（场景侧挂载为现行形状）". The owner
decided 2026-10-18: the plugin enters the spine (with the streaming-TTFT
companion decision recorded separately).

## Decision

- `runtime/dsh/upstream/boot.js` mounts dsh-appshell in `mountToolRows`,
  beside dsh-office (dynamic import — the row shape); `spineInventory` gains
  the `appshell` tool row (mount-truth claim, the shell-js precedent).
- The L2 scenario (`appshell.spec`) drops its scenario-side mount — boot
  supplies the tools now; its offeredPhase is the proof the boot row
  actually registered. 14/14 still green.
- **The measured ripple, re-pinned from green runs**: every model request
  now carries the three appshell tool definitions — `upstream-session`'s
  `llm/request/built` pin moved 17 → 20 tools. That is the product fact
  this decision buys: any real turn can morph the app, at ~3 tool-schema
  descriptions of standing prompt cost.
- **The staging graph followed the decision**: boot.js's dynamic import
  made dsh-appshell reach the harmony/iOS surfaces — the four code files
  the old CLI-only era had EXCLUDED (harmony-BUNDLE_FILES.exclude.rows,
  the L2-era decision) re-enter via the derivation; manifest.json and the
  three non-imported lib files ride policy rows (the dsh-create
  precedent); the SPINE_OURS hand rows (8 files) splice into
  vendor-official.sh. BUNDLE_FILES 1229 → 1237, both directions verified.
- Everything else re-ran green untouched: seam-inventory 4/4 (services
  unchanged — the plugin adds tools, not services), parity golden intact
  (12/12), office + web-boot legs green.

## Alternatives considered

- **Client-gated mounting** (mount only when the active web client supports
  appshell surfaces, via the config-layer patch) — the token-frugal shape;
  the owner chose the simple, office-consistent boot mount. The gated shape
  remains a config-layer change away if the standing cost ever matters.
- **Keep scenario-side mounting and mount per-seat in the carriers** —
  rejected: three host-specific wirings instead of one spine row, and the
  official client would still never see the tools.

## Consequences

- One-prompt app morphing is a product capability on every seat (CLI,
  iOS, Android, HarmonyOS) — the web-client-v2 toolview already renders
  both render and update cards, and the M3 auto-apply rides the journal
  regardless of who mounted the plugin.
- The standing prompt cost (~3 tool schemas) is now part of every turn's
  wire request — visible and pinned in upstream-session's manifest.
- The L2 leg's Note ("boot-level mount is a separate product decision")
  is now resolved; the streaming-TTFT decision is the remaining open item.
