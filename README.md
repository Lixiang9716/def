# dsh-mobile

English | [简体中文](README.zh.md)

## What is this?

dsh-mobile is a **mobile host** for the DSH (DeepSeek Harness) ecosystem: it runs an
upstream DSH agent — the desktop Harness runtime — on a phone, on all three mobile
platforms (Android, iOS, HarmonyOS). Everything happens on the device: a
single-threaded QuickJS runtime carries the Harness core in-process, a capability
gateway wraps each OS's native services behind one narrow primitive contract, and the
UI is a pluggable Web Client, not a hardcoded screen. In-app shell, plugin marketplace,
real LLM sessions, even agent-driven plugin creation — all local; there is no cloud
relay.

**Why it exists.** Phones have no Linux shell ecosystem for an agent to stand on, and a
desktop agent cannot simply be installed on a phone. Under the community Fabric
interoperability model, dsh-mobile demonstrates an isomorphic port route: the upstream
packages run **verbatim** on QuickJS (pinned and sha256-verified, never vendored edits),
and every platform difference is expressed as capability negotiation against a frozen
contract — one core, three hosts.

> Community project, not an official DeepSeek product. Upstream ecosystem:
> [anywhere-labs/dsh-desktop](https://github.com/anywhere-labs/dsh-desktop) and the DSH
> Community Fabric draft RFCs.

## What works today

Every line below is backed by committed evidence — receipts under
`hosts/*/artifacts/` and `runtime/dsh/artifacts/`, consolidated in
[doc/e2e-matrix.md](doc/e2e-matrix.md):

- **An agent session in the app, on all three hosts** — the interactive seat serves the
  official Web Client over a loopback carrier; a composer prompt streams token deltas,
  runs tools, renders tool cards, and lands a durable session journal
  (`hosts/{ios,android,harmony}/artifacts/shell-turn/`, all pass).
- **A real in-app shell** — `dsh-shell-js`, one bash-subset executor (pipelines,
  redirects, a coreutils surface) over the frozen fs primitives, shared by all three
  hosts; shell emulation stated as such — no kernel identity, no ELF execution, no
  package manager (#457; CLI leg 35/35 in `runtime/dsh/artifacts/macos-cli-dsh-shell-js/`).
- **Creation mode** — a prompt becomes a real plugin: the agent writes the package, you
  approve it, it hot-mounts and its card renders live (`create.card` receipts on all
  three hosts, `hosts/{ios,android,harmony}/artifacts/create-card/`); with a staged or
  BYOK credential the creation turns run against the real LLM.
- **Real LLM streaming on all three hosts** — the `llm.live-stream` legs against
  OpenAI-compatible backends, with the served model logged verbatim and a key-leak audit
  asserted on every log line (`hosts/{ios,android,harmony}/artifacts/`).
- **A plugin marketplace** — a signed catalog (ed25519) installs through the same
  verified, receipt-committed install pipeline
  (`runtime/dsh/artifacts/macos-cli-marketplace-install/`).
- **BYOK** — your key lives in the host keychain; the multi-protocol family
  (OpenAI-compatible + anthropic-messages) dials user-declared endpoints (#467,
  `runtime/dsh/artifacts/macos-cli-byok-piai-anthropic/`).
- **Sessions survive restarts** — the journal reloads and the conversation resumes after
  a force-stop (`hosts/{ios,android,harmony}/artifacts/session-persist-restart/`).
- **The UI is a plugin** — whole-client swap and component slots verified on device
  (`ui.client-swap` 7/7), with a Lynx render-surface client piloting a second face.

Honest boundaries: no host has real subprocesses or a Linux userland (the iSH
experiment was retired in 2026-10 — see the evidence table below); simulators have no
radio, so camera / microphone / BLE negotiate honestly per host and the HarmonyOS faces
of that plane await real-device receipts; background residency is checkpoint/resume,
not desktop-grade.

## Quickstart

```sh
git clone https://github.com/Lixiang9716/dsh-mobile
cd dsh-mobile
build/build.sh --list          # platforms and what each toolchain needs
build/build.sh android         # sync → compile → log-verified e2e on the emulator
```

- One facade drives every platform: a "build" is always **sync → compile → test** — the
  same three things the platform's CI does. iOS compiles only on macOS; a missing
  toolchain fails loud, naming the tool and how to get it.
- No mobile toolchain at hand? The core CLI is the cheapest proof vehicle:
  `build/build.sh compile core` builds the C host the platforms embed.
- Launch the built app on its simulator/emulator and it boots into the interactive
  seat — the official Web Client served on the loopback carrier.

The full facade (CMake layer, the closures gate, the simulator matrix):
[BUILD.md](BUILD.md). When a run misbehaves:
[doc/troubleshooting.md](doc/troubleshooting.md).

## Architecture in one screen

Five layers, one line each:

1. **Presentation** — the UI is a Web Client plugin rendered in the system WebView over
   a loopback HTTP/WS carrier; the host hardcodes no UI.
2. **Harness core** — the upstream DSH runtime runs verbatim on a single-threaded
   QuickJS coroutine engine (one serial JS thread; subprocess semantics are
   re-implemented in-process).
3. **System implementation plugins** — JS plugins compose gateway primitives into
   upstream service contracts (fs, subprocess, shell, credentials…).
4. **Capability gateway** — a narrow, versioned primitive table with capability checks,
   permission flags, and an audit log; host-fixed, never a plugin.
5. **Privileged layer** — a thin native shell (Swift / Kotlin+NDK / ArkTS+NAPI) owning
   entitlements, keychain, pickers, notifications.

Platform differences are capability negotiation, never a `hostType` branch. The full
design: [doc/ARCHITECTURE.md](doc/ARCHITECTURE.md); every flow end to end (boot,
gateway calls, LLM streaming, install, the verification mechanism itself):
[doc/sequence-diagrams.md](doc/sequence-diagrams.md).

## Project status & evidence

The table below is the **per-milestone acceptance evidence index** — it is how this
repository proves its status claims (a status flip travels in the same PR as the work
that earns it). If you are new here, the reader-facing summary is
["What works today"](#what-works-today) above; this table is for auditing. Scenario
ids and artifact paths are quoted verbatim on purpose — they cite records on disk.

| Phase | Scope | Status |
| --- | --- | --- |
| Contract freeze | Primitive contract v0 + data protocols (bundle layout / manifest / receipt) | Done (frozen v1.0.0; additively extended — primitives v1.8.0 the socket seam, data-protocols v1.1.0 §7 the signed catalog behind the plugin marketplace) |
| Runtime & host spikes | quickjs-ng shim over upstream pure-logic packages + iOS host skeleton + local carrier | Done (runtime dsh verified on iOS/Android/HarmonyOS + macOS; local carrier — loopback static files + WS↔QuickJS pump — verified on the iOS simulator) |
| First on-device session | System implementation plugins (fs/subprocess/ui) + Web Client mount + first on-device session + real LLM API | Done (system plugins + Web Client mount + first on-device session: `dsh-fs`/`dsh-subprocess-quickjs`/`dsh-ui` plugins, `session.mock-llm` 23/23 on the CLI and on-device, Web Client `dsh-web-client` mounted and rendered live over the carrier WS — evidence `runtime/dsh/artifacts/macos-cli-m2-session/` and `hosts/ios/artifacts/m2-session/`; the REAL LLM API shipped as scenario `llm.live-stream`: an OpenAI-compatible streaming chat client (`runtime/dsh/llm.js`) over the gateway `httpFetch` shape, leg negotiated from the RuntimeDescriptor — scripted-SSE leg on the CLI `llm.live-stream` 19/19 (`runtime/dsh/artifacts/macos-cli-m2-llm/`), real z.ai streaming on the iOS simulator (`hosts/ios/artifacts/m2-llm/`) and the Android emulator (`hosts/android/artifacts/m2-llm/`) with reasoning+content deltas as an event sequence, the served model logged verbatim, and the API key audited against every log line (fail loud on a leak)) |
| Plugin system | Plugin install pipeline + UI pluggability (three plugin levels, capability negotiation) | Done (install = receipt transaction over the frozen fs primitives — `install.verified-tarball` 22/22 on the CLI: content-addressed blob, trust-record verify, strict manifest validation, install-time capability negotiation against the RuntimeDescriptor, staged integrity read-back, receipt commit, tampered package rejected before unpack; the FETCH-based installer runs the streaming httpFetch body through the same pipeline — CLI with a logged stub `install.full-cycle` 41/41 (`runtime/dsh/artifacts/macos-cli-m3-complete/`), ON DEVICE against the loopback carrier itself with the real `httpFetch` `install.from-http` 46/46 + carrier evidence `install.carrier-evidence` 11/11 (`hosts/ios/artifacts/m3-complete/`), including pending-receipt STARTUP REPLAY over the append-only receipt journal (staged-verifies → committed, staging-incomplete → rolled-back, tree untouched); all three UI-plugin levels verified on device — the config layer (`cordis.patch` overrides) selects the active Web Client and overrides the toolbar slot set, plus whole-client swap and component slot (`ui.client-swap` 7/7, `hosts/ios/artifacts/m3-pluginization/`); regressions `session.mock-llm` 23/23 CLI + on device, `run-ios.sh` 4/4) |
| Android host | Android host (QuickJS-isomorphic) | Done (completion session `android.capability-binding` 35/35 green on the emulator: the loopback carrier serves the embedded Web Client into a real WebView with the session rendered live, and the nine-primitive gateway binding is real — descriptor 9 available / 0 unavailable, mandatory audit re-verified via `gateway.audit` 16/16; the three-scenario regression stays green in the same run — evidence `hosts/android/artifacts/m4-complete/`; the same real httpFetch binding drives the real-LLM streaming session `llm.live-stream` on the emulator — `llm.live-stream` device 14 expected / 171 logged + carrier 7/7, evidence `hosts/android/artifacts/m2-llm/`) |
| HarmonyOS host | HarmonyOS host (ArkTS + NAPI) | Done (isomorphic host verified: loopback carrier — HTTP static serving of the Web Client + RFC 6455 WS pump — with ArkWeb mounting the live session, and ALL NINE contract primitives real on the emulator with descriptor 9 available / 0 unavailable: notify, presentApproval, fsScope, HUKS-sealed keychain (AES-256-GCM; set → get returns identical bytes, set null deletes), presentPicker over DocumentViewPicker (dismissal → null; grant → user scope with fsScope persist/resolve and content-matching read-back; user-scope surface read-only, matching the Android twin), and streaming httpFetch against the host's own loopback carrier (body settles at headers then streams as chunk events, never a whole result; mid-body abort → `cancelled`) — `harmony.capability-binding` 27/27 plus the `boot.verification`/`gateway.bridge-smoke`/`session.mock-llm` (23/23) regression in one launch — evidence `hosts/harmony/artifacts/m5-host/` and `hosts/harmony/artifacts/m5-primitives/`; the `llm.live-stream` real-LLM leg is WIRED on this host too — launch-selected by `aa start … --ps dsh.e2e.leg llm.live-stream` (the leg runs alone, so the default chain spends no serve quota), the canonical `runtime/dsh/scenario/llm-live-stream.js` negotiating the real leg over the SAME httpFetch binding, with the platform-forced credential handshake (runtime-written 0666 placeholder → runner `hdc file send` → app import, honest seal report, removal after the run) and the carrier mount chain (`client.selected` → `webclient.mounted` → `ws.connected` → `slot.registered`) verified on the emulator; its TRANSPORT round trip is proven end-to-end — the request left the device through this host's httpFetch and a real backend answered it — and with the quota reset the leg re-ran GREEN: the SERVED turn is claimed (`llm.live-stream` 14/130 + `llm.live-stream.carrier` 7/7, evidence `hosts/harmony/artifacts/m5-llm-live-stream/`, produced 2026-09-28, key-leak audit clean on the raw streams)) |
| Render-surface client (Lynx pilot) | `presentation/lynx-client/` — a wholly replaceable render-surface CLIENT plugin (not a system-plugin): a ReactLynx bundle (pure presentation) + a host-side driver over the `RenderSurfaceClient` seam (mount / pushViewEvent / onIntent / teardown), theme tokens single-sourced to web CSS vars + Lynx constants | Done (pilot build + acceptance: the rspeedy bundle (149.6 kB) is committed and sha256-verified at mount; the `lynx.mount` CLI leg runs the FULL mock-LLM driver loop — submit → streaming deltas → tool card through all three phases → collapsed output + creation card → mid-history seed replay → optimistic cancel → fail-loud legs — 34/34 on BOTH faces over one flow, the replaceability proof, evidence `presentation/lynx-client/artifacts/cli-lynx-mount-{lynx,stub}/`; the vitest seam-contract suite 36/36; the bundle also renders for real on the @lynx-js/web-core platform in headless Chrome (human-facing screenshot under the gitignored `artifacts/screens/`); pixels on device remain the LynxExplorer/on-device round) |
| Device plane (contract v1.5.0) | The host's platform-SDK surface: `deviceInfo` / `haptic` / `clipboardRead`+`clipboardWrite` / `presentShare` / `keepAwake` + `presentPicker` `mode:"media"` | Done (one platform-neutral scenario `device.plane` driven live per host over the real privileged layers — descriptor 22 available on iOS / 23 on Android / 15 on HarmonyOS, the clipboard approval ladder (Approve → Approve & Remember → standing grant), the share sheets completing through Copy, the keepAwake latch, and the media picker granting read-through scope over what the user picked; the emulator's dead pasteboard honestly rejects `unavailable` and the ladder still runs; receipts `hosts/{ios,android,harmony}/artifacts/device-plane/`; runners `test/e2e/run-ios-device-plane.sh`, `hosts/android/ci/run-device-plane.sh`, `hosts/harmony/ci/run-device-plane.sh`) |
| Simulator matrix | The release-grade evidence net: one command per host (`tools/test/run-simulator-matrix.sh`) proves both halves of the flavor split — the Release build launches with zero drive choreography and zero debug/info logger records and refuses the drive by name, and the proven e2e runners re-drive the Debug harness unchanged | Done (iOS `simulator-matrix/release/release-proof.json` (the absence + refusal proof) + `simulator-matrix/gateway-drive` `boot.verification` 8/8, `carrier.loopback` 7/7, `gateway.audit` 16/16, `gateway.binding` 19/19, + `simulator-matrix/device-plane` 16/16 + audit; Android `simulator-matrix/release/release-proof.json` + `simulator-matrix/regression` `boot.verification` 8/8, `gateway.bridge-smoke` 6/6, `session.mock-llm` 23/23, + `simulator-matrix/device-plane` 15/15 + audit; receipts machine-authored on the green path only; harmony: honest skip receipt `matrix-skip-receipt.json` while no DevEco/hdc target exists (D-g standby); evidence `hosts/{ios,android,harmony}/artifacts/simulator-matrix/`; deliberately not gate-wired — a release ritual) |
| System capability plane (contract v1.10.0 candidate) | Camera, microphone, and BLE behind one OS-permission consent model — the caller manifest's grant-family flag first (the gateway layer), the OS permission second, refusals audited by layer; one platform-neutral scenario per face driven per host (proposal `contract/proposals/2026-09-30-system-capability-plane.md`, #249; faces #252 / #255 / #254) | Done on iOS + Android (camera `camera.plane` 6/6 + audit on iOS — the simulator's honest capture-unavailable posture — and 8/8 + audit on Android with the emulator's REAL virtual-camera burst (2 frames / 44157 bytes / 457 ms) plus the maxBytes drop leg; microphone `mic.plane` 11/11 iOS / 9/9 Android — the armed ladder with real PCM frames, the stop record's duration/bytes, the exactly-once end, idempotence; BLE `ble.plane` 16/16 (deterministic mock radio) + 8/8 (honest radio-skip) per host — no simulator has a usable radio, so the mock rides the same gateway enforcement, consent layers, and audit, and the real-device leg is the D-g one-click contract; evidence `hosts/{ios,android}/artifacts/{camera-plane,mic-plane,ble-mock,ble-skip}/`; the harmony legs are implemented, receipts await real hardware — D-g scripts staged, no evidence synthesized) |
| In-app shell (`dsh-shell-js`) | One JS shell for all three hosts: a bash-subset executor (pipelines, redirects, a coreutils surface) over the frozen fs primitives — in-process, no kernel identity, no ELF execution, no package manager; a shell emulation, stated as such (ARCHITECTURE.md §12) | Done (CLI leg `dsh-shell-js` 35/35 with the pinned 33-package parser closure — `runtime/dsh/artifacts/macos-cli-dsh-shell-js/`, #457; then the on-device shell turn — a real prompt through the interactive seat's composer wire drives the shell tool, the official UI renders the tool card, and the executor's fsWrite lands on the container disk byte-exact — pass receipts on all three hosts `hosts/{ios,android,harmony}/artifacts/shell-turn/`, #491/#492) |
| iSH userland retirement | The contract v1.3.0 `ishRun` emulated Linux userland (the iSH-arm64 engine, D16) leaves the repository — engine, guest userland, seam, and the last host implementation; the frozen contract entry stays (D5: shapes immutable for the life of major v1), so every host answers `ishRun` with the contract's honest `unavailable` and no descriptor lists it available | Done (three PRs: the `dsh-shell-ish` JS face with its scenario family and marketplace listing #496, the iOS host face #497, the engine and the CI escape hatches #498; the retirement addendum in [doc/decisions.md](doc/decisions.md); the GPL-3.0 distribution question and the guest-outside-the-audit disclosure retire with the guest) |
| Harmony matrix leg goes real | `tools/test/run-simulator-matrix.sh --platform harmony` runs the REAL legs when an hdc target is up — the harness ladder (`run-host-e2e.sh`: 8/8 verdicts + the green-path receipt) and the release leg (the release HAP's plain launch serves the official UI, proven at the socket level — the serve's LISTEN probed through an `hdc fport`; zero drive-machinery records; the drive refusal by name) — with the honest skip receipt kept for machines without a live target | Done (2026-10-12, #475 on the dsh_phone emulator; evidence `hosts/harmony/artifacts/simulator-matrix/{harness,release}/` incl. `release-proof.json`; the first real runs swept four accumulated pin drifts nothing could see while the leg was dead) |

### Upstream port (D9)

The table above records what each milestone proved on its own evidence. Since decision
[D9](doc/decisions.md), the Harness layer itself is no longer an in-house reimplementation:
the upstream DSH runtime runs **verbatim** on quickjs — 26 packages pinned and sha256-verified
by `external/ensure-dsh.sh` (21 upstream DSH packages at 0.1.6-alpha.2 + 5 pinned
npm deps), with in-house code reduced to glue (shims, adapters, the contract carrier). Live
through the carrier on iOS / Android / HarmonyOS: the official client-modules web boot, the
official app shell (the 58-package application tier, #61), real `session.list`/journal, and
the composer write path. The consolidated numbers and per-dir inventory:
[doc/e2e-matrix.md](doc/e2e-matrix.md) — 118 evidence dirs, 237 green verdicts — under
`hosts/{ios,android,harmony}/artifacts/` (`b1-official-web`, `session-live-read`,
`composer-live-write`, `android-upstream`, `android-session-live`, `d9-official-web`,
`d9-session-live`, `d9-write-live`).

## Documentation map

| When you want to… | Read |
| --- | --- |
| understand the layered design and the decisions behind it (D0–D18) | [doc/ARCHITECTURE.md](doc/ARCHITECTURE.md) |
| see any flow end to end — boot, gateway calls, LLM streaming, install | [doc/sequence-diagrams.md](doc/sequence-diagrams.md) |
| build a host, or debug a build | [BUILD.md](BUILD.md) |
| write a plugin for this host | [doc/plugin-dev.md](doc/plugin-dev.md) |
| bring a desktop DSH plugin over | [doc/dsh-desktop-plugins.md](doc/dsh-desktop-plugins.md) |
| check what evidence backs a claim | [doc/e2e-matrix.md](doc/e2e-matrix.md) |
| fix a misbehaving run | [doc/troubleshooting.md](doc/troubleshooting.md) |
| cut a versioned release | [doc/release.md](doc/release.md) |
| propose a change touching a settled decision | [doc/decisions.md](doc/decisions.md) — read it first |

## Governance

This repository is gated by [govrail](https://github.com/Lixiang9716/govrail): pre-commit
content gates, a `gov run` gate DAG before push, CI enforcement
(`.github/workflows/gov.yml`), and the multi-agent development practice its `agent-heavy`
preset describes (`parallel-workers` skill + the `verify-decisions` gate). Run
`gov --help` (installed via `pip install govrail`; entry point is `gov`).

`main` is protected: changes land through a pull request with the `gates` check green,
and commits follow Angular Conventional Commits (`type(scope): subject`).

## License

MIT

## Star History

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Lixiang9716/dsh-mobile&type=Date&theme=dark" />
  <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Lixiang9716/dsh-mobile&type=Date" />
  <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Lixiang9716/dsh-mobile&type=Date" />
</picture>
