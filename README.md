# dsh-mobile

English | [简体中文](README.zh.md)

**See it in the browser first:** the [project site](https://lixiang9716.github.io/dsh-mobile/)
— what & why, capability cards, and the real Lynx render-surface client rendering live
(static shell, no session).

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
packages run **verbatim** on QuickJS (pinned and verified, never modified), and every
platform difference is expressed as capability negotiation against a frozen contract —
one core, three hosts.

> Community project, not an official DeepSeek product. Upstream ecosystem:
> [anywhere-labs/dsh-desktop](https://github.com/anywhere-labs/dsh-desktop) and the DSH
> Community Fabric draft RFCs.

## What works today

Every claim here is backed by committed evidence — the receipts live in
[doc/e2e-matrix.md](doc/e2e-matrix.md).

- **A full agent session in the app, on all three hosts** — you type, the model streams
  back token by token, tools run and render their own cards, and the conversation
  survives a force-stop and resumes.
- **A real in-app shell** — a bash-subset shell (pipes, redirects, a coreutils surface)
  running entirely in-process. An honest emulation, stated as such: no kernel, no ELF
  binaries, no package manager — and differentially tested against real bash.
- **Creation mode** — describe a plugin in one sentence: the agent writes it, you
  approve it, it mounts and runs on the spot.
- **Real LLM streaming, your key (BYOK)** — OpenAI-compatible and Anthropic-protocol
  endpoints; your key lives in the phone's keychain, never in a log; the streaming
  transport is drilled against hostile wire conditions.
- **A plugin marketplace** — browse and install signed plugins; every install rides the
  same verified, transactional pipeline.
- **The UI is a plugin** — the whole interface is swappable: the official client, a
  compact one, or the Lynx-rendered experimental face demoed live on the project site.

Honest limits: no host has real subprocesses or a Linux userland (an emulated one was
tried and retired); simulators have no radio, so camera, microphone, and Bluetooth
negotiate honestly per device and some receipts await real hardware; background
residency is checkpoint/resume, not desktop-grade.

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
  `build/build.sh compile core` builds the C host the platforms embed. No toolchain at
  all? The [project site](https://lixiang9716.github.io/dsh-mobile/) shows the client
  face in the browser.
- Launch the built app on its simulator/emulator and it boots into the interactive
  seat — the official Web Client served on the loopback carrier.

The full facade (CMake layer, the closures gate, the simulator matrix):
[BUILD.md](BUILD.md). When a run misbehaves:
[doc/troubleshooting.md](doc/troubleshooting.md).

## Architecture in one screen

Five layers, one line each:

1. **Presentation** — the UI is a Web Client plugin rendered in the system WebView over
   a loopback carrier; the host hardcodes no UI.
2. **Harness core** — the upstream DSH runtime runs verbatim on a single-threaded
   QuickJS engine; subprocess semantics are re-implemented in-process.
3. **System implementation plugins** — small JS plugins compose gateway primitives into
   upstream service contracts (fs, shell, credentials…).
4. **Capability gateway** — one narrow, versioned primitive table with permission
   checks and an audit log; host-fixed, never a plugin.
5. **Privileged layer** — a thin native shell (Swift / Kotlin / ArkTS) owning
   entitlements, keychain, pickers, notifications.

Platform differences are capability negotiation, never a code branch. The full design:
[doc/ARCHITECTURE.md](doc/ARCHITECTURE.md); every flow end to end (boot, gateway
calls, LLM streaming, install): [doc/sequence-diagrams.md](doc/sequence-diagrams.md).

## Project status

Every milestone below is done and evidenced. The proof — scenario logs, verdict
counts, artifact receipts — lives in [doc/e2e-matrix.md](doc/e2e-matrix.md).

| Milestone | Where it stands |
| --- | --- |
| Contract freeze (primitives + data protocols) | Frozen; additive extensions only |
| Runtime & host spikes | Done |
| First on-device session | Done |
| Plugin system (install pipeline, UI pluggability) | Done |
| Android & HarmonyOS hosts | Done |
| Device plane (haptics, clipboard, share, picker) | Done |
| Camera / microphone / Bluetooth consent plane | Done on iOS & Android; HarmonyOS awaits real hardware |
| Render-surface client (Lynx pilot) | Pilot done |
| In-app shell | Done, all three hosts |
| iSH emulated Linux userland | Retired — answered honestly as unavailable |
| Simulator matrix (release-grade evidence net) | Done |

## Documentation map

| When you want to… | Read |
| --- | --- |
| understand the layered design and the decisions behind it | [doc/ARCHITECTURE.md](doc/ARCHITECTURE.md) |
| see any flow end to end — boot, gateway calls, LLM streaming, install | [doc/sequence-diagrams.md](doc/sequence-diagrams.md) |
| build a host, or debug a build | [BUILD.md](BUILD.md) |
| write a plugin for this host | [doc/plugin-dev.md](doc/plugin-dev.md) |
| bring a desktop DSH plugin over | [doc/dsh-desktop-plugins.md](doc/dsh-desktop-plugins.md) |
| check what evidence backs a claim | [doc/e2e-matrix.md](doc/e2e-matrix.md) |
| see the testing posture and hardening program | [doc/test-coverage.md](doc/test-coverage.md) |
| fix a misbehaving run | [doc/troubleshooting.md](doc/troubleshooting.md) |
| cut a versioned release | [doc/release.md](doc/release.md) |
| propose a change touching a settled decision | [doc/decisions.md](doc/decisions.md) — read it first |

## Governance

This repository is gated by [govrail](https://github.com/Lixiang9716/govrail):
pre-commit content gates, a pre-push gate DAG, and CI enforcement
(`.github/workflows/gov.yml`). `main` is protected: changes land through a pull
request with the `gates` check green, and commits follow Angular Conventional Commits
(`type(scope): subject`).

## License

MIT

## Star History

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Lixiang9716/dsh-mobile&type=Date&theme=dark" />
  <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Lixiang9716/dsh-mobile&type=Date" />
  <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Lixiang9716/dsh-mobile&type=Date" />
</picture>
