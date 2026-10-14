# Agent Note: ishRun retires: the engine, the CI escape hatches, and the honest-unavailable posture

Status: implemented
Related: D16

## Problem

D16 adopted an in-process emulated Linux userland (`ishRun`, contract v1.3.0) so a
real Alpine userland could run inside the app. By 2026-10 the seat it served is gone:
`dsh-shell-js` took the shell seat on all three hosts (2026-10-11), the plugin, local
gate family and marketplace listing retired (PR-1, #496), and the iOS host face
retired (PR-2, #497). What remained was dead weight with live costs: a vendored
engine the repo still fetched and conditionally compiled, a `--no-ish` escape hatch
threaded through two build scripts, three workflows, a gate script and six e2e
runners (all existing only because no Linux runner can assemble the engine's
Apple-syntax AArch64 asm), an Android ishRun call answering the contract-wrong
`denied "primitive not granted"` (the §7.1 deviation the retirement audit names),
and documentation that still promised "the one place a real userland IS supported".

## Decision

The engine goes; the contract entry stays; every host says `unavailable`.

- **Engine + seam (audit §A)**: `external/ensure-ish.sh`, `external/ensure-ish-rootfs.sh`,
  `src/dsh_ish.{c,h}`, `src/dsh_ish_verify.{c,h}`, `src/ish/` (incl. the committed
  pinned vdso), the conditional block in `src/CMakeLists.txt`, `example/ish_smoke.c`,
  the ish-smoke block in `example/CMakeLists.txt`, and `main_cli.c`'s
  `DSH_CLI_WITH_ISH` opt-in face — the row stays registered and answers
  `unavailable "no Linux userland (the iSH engine has been retired)"`.
- **CI escape hatches (audit §4)**: `--no-ish` deleted from `src/build.sh`
  (`-lsqlite3` folded into the fixed link line — it always belonged to the
  node:sqlite seam) and from `build/build.sh`; c-core.yml drops the ish rationale,
  the `--no-ish` args and the cache notes; gov.yml drops the arm64-only
  quickjs-boot-parse job and its ish materialization (the gate rides the gates DAG
  again, arch-neutral); weekly-sweep.yml drops the ish cache path, `ensure-ish.sh`
  and `--no-ish`; `check-quickjs-boot-parse.sh` drops the arch guard and the
  ish-aware miss-build; the six ci runners (`run-security-byok-leak`,
  `run-security-manifest-forgery`, `run-marketplace-install-e2e`,
  `run-upstream-parity`, `run-llm-piai-probe`, `run-llm-piai-e2e`) drop their
  `ensure-ish.sh` preheat. `cmake/Gates.cmake`'s dsh-test-core stopped passing the
  deleted flag (it would exit 2); `cmake/Vendor.cmake`'s stale ish paragraph went.
- **Records/ignores (audit §G)**: the ish/rootfs entries in `.gitignore` and
  `.zcodeignore`; `tools/generated/staging/ios-TREES.rows`' comment now says the
  retired tree left the repo (comment-only; the staging-generated gate re-checked
  green). Evidence dirs and `.gov/surprises.jsonl` untouched.
- **Posture (audit §1.3/§7.1)**: Android registers the retired row —
  `GatewayCore.RETIRED_ROWS` answers `unavailable` before the grant walk
  (audited granted/unavailable), both seat descriptors declare it
  (`PHASED_ROWS + RETIRED_ROWS`), and the seven scenario manifests pinning
  `unavailable: 2` move to 3. Harmony needed **no change**: `smoke_known_absent`
  has answered ishRun `unavailable` on both descriptor faces since #407 — the
  audit's "invalid" measurement was stale; the descriptor-parity gate re-proved
  the faces agree.
- **Docs (audit §F)**: `contract/primitives.md`/`.zh.md` gain a status note —
  ishRun has **no in-service host**, the frozen v1.3.0 entry is kept verbatim
  (D5). `doc/ARCHITECTURE.md` §12 rewritten to the new honest statement — no host
  serves a real Linux userland; what remains is the `dsh-shell-js` bash-subset
  emulation, stated as an emulation — plus the platform-matrix row (all three
  hosts ❌) and the zh mirror; `doc/sequence-diagrams.md` figure 7 becomes the
  retired-row unavailable exchange (+ zh); `doc/dsh-desktop-plugins.md`/zh tool
  rows updated; `doc/decisions.md` D16 gains a retirement addendum (historical row
  unchanged) recording that the GPL-3.0 distribution question evaporates with the
  engine and the §7-point-2 audit-boundary disclosure retires with the guest.

## Alternatives considered

- **Delete the frozen contract entry**: rejected — D5 froze the shapes for the life
  of major v1 and no v2 removal path exists; a missing row would break `gateway@1`
  conformance for every caller. Keeping the entry + all-hosts `unavailable` is the
  path §7 #1 spells out ("absence is information for negotiation, never faked").
- **Re-point the retired `userland.shell` scenario at `dsh-shell-js`**: rejected —
  the executor cannot carry the scenario's guest-identity assertions (real
  `uname -m`→aarch64, `/etc/alpine-release`, real ELF/`apk`, `$()`, enforced
  timeouts); PR-1 already retired the family rather than fake it, and this PR
  keeps that honesty.
- **Keep the engine on a branch "just in case"**: rejected — git history IS the
  keep-it-cheap path; carrying 400k vendored lines, a vendored-binary pin and six
  CI special cases for an unused engine is the cost, and re-adoption would ride
  the same frozen shapes after a deliberate D5-major decision, not a revert.
- **Leave the Android `denied` as-is and only fix docs**: rejected — the audit's
  §7.1 finding is a contract deviation (`denied` implies the primitive exists but
  is ungranted), and the registered-handler `unavailable` is the same minimal
  posture PR-2 gave iOS; descriptor and manifests move together in this change.
