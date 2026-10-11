# The Android calendar-live drive — a real model turn, the live mount, and the card

## Problem

The iOS host has the `-dsh-mode calendar-live` seat (staged credential +
ONE real model turn + the cordis live mount + the native card); Android had
nothing. Worse, the shared scenario was dead code on every host:
`create-calendar-live.js` waited for the serve seat's web-boot machinery and
guarded its own `main()` behind `if (!booted)` where an inner `const booted`
(the boot RESULT object — truthy) shadowed the module-level flag, so main()
never ran; the guard's true-branch would also have thrown (assignment to a
const). No green calendar-live evidence exists on any host.

## Decision

- `scenario/create-calendar-live.js` rewritten to the DRIVE-SEAT shape: the
  seat delivers one `runtime.config` as the GO trigger (both the serve seat
  and the binding drive deliver it), the staged credential at fs-app
  `llm/config.json` is the model route ({baseUrl, apiKey, model,
  provider?} — the serve seat's own credential file, FsPrimitives'
  profiles/default scope), the profile container resolves from
  `fsScope.resolve('scope://app/')`, then bootUpstream → one real turn on
  the agent (plugin_create authors the plugin) → the live mount (mounted
  already by the product when the tool's own execute ran the pipeline —
  `isMounted` guards the one refusal mountWorkspacePlugin keeps) → the
  plugin's own apply() drives the card. Boot-inventory records ride debug;
  the stream is the chain's own (manifest create-calendar-live.json, 8
  events).
- `BindingHost.startCalendarLive` (extra `dsh.calendarlive`) on the spawn
  seat with a per-drive watchdog (`watchdogSeconds`, 480 s for this leg —
  a reasoning model's minutes-long first byte against the 180 s default)
  and the runtime.config GO delivery. MainActivity gained the extra.
- `run-calendar-live.sh`: credential resolution in order — DSH_CRED_FILE →
  the installed container's `files/profiles/default/llm/config.json` (read
  via run-as on the debug build the leg installs first — no adb root flip
  on the shared emulator) → the repo-root .env (the run-live-llm.sh
  convention, ZAI_* / DSH_LLM_*). The key is NEVER printed, is staged
  into the app container only, and a leak re-check greps the captured log
  at the end. NO source → an HONEST BLOCKED receipt (verdict "blocked",
  the reason names all three sources, exit 0).
- `stage-spine-closure.sh` stages the scenario (both the copy and the
  byte-identity check lists).

## The two defects the leg's first green run exposed (both measured)

- spawn drives carried no card surface: `drive()` attached CardSurface,
  `spawn()` did not — the calendar drive (spawn, for the watchdog) crossed
  the plugin's card.present with `cardSurface` still null and
  `cardSurface?.handle` silently dropped the face. spawn now attaches the
  surface for every drive (a spine-booting drive is exactly where a plugin
  can mount and post card.* lines; drives whose scenario posts none carry
  an empty overlay).
- The scenario's own re-mount refused ("already mounted") on the second
  run shape: the turn's own plugin_create tool call runs the WHOLE product
  pipeline (approval → registry → import → ctx.plugin) inside
  dsh-create's execute, and a spec cannot mount twice. The drive now
  records the truth (`mountedBy: 'plugin_create'`) and mounts only when
  the tool's mount did not land.

## Alternatives considered

- Keep the serve-seat web-boot shape and override the Android
  SessionServe's entry (the iOS structure): rejected — the ask names
  BindingHost.startCalendarLive, the drive seat needs no page plumbing,
  and the web-boot machinery was exactly what dead-coded main().
- adb root for the container credential read: rejected — run-as on the
  debug build the leg installs reads the same file without flipping adbd
  on an emulator other agents share (adb root restarts adbd).
- Pin the model-authored files list in the manifest: rejected — the
  authorship is the model's; the manifest pins the chain (config → spine →
  turn → files non-empty → mounted) and the scenario fails loud when the
  model authors nothing.

## Consequences

- Proven on emulator-5554 with a real backend: 8/8 manifest events, the
  turn settled on glm-4.6 (api.z.ai), the plugin live-mounted by the
  product pipeline, and the card face (2026-10-11, the plugin's own date
  JS) rendered natively — screenshot in
  hosts/android/artifacts/calendar-live/. The blocked path proven too:
  no-credential run exits 0 with the blocked receipt.
- Every spawn drive now carries the card surface — the card.player and
  create-card legs re-ran green on this tree during the diagnosis.
