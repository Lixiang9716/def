---
name: ops-dispatch
description: The operational dispatch table for dsh-mobile — one map from intent
  to the right skill or CLI, with prerequisites, order, and traps. Use whenever
  starting or stuck on operational work in this repo: cutting or materializing a
  worktree seat, running or choosing quality gates, landing a PR, pushing through
  network failures, reproducing an upstream spec, querying which test leg counts,
  closing AOCI cognition, syncing mirrors after a runtime edit, driving a host
  leg, or asking "which script do I use for X" — even if the ask names no tool.
---

# Skill: ops-dispatch
# Skill: ops-dispatch — the operational dispatch table

One map from *intent* to the right skill or CLI, with the prerequisites, the
order, and the traps each move carries. This repo's operational knowledge used
to live in session memory and re-derive itself the hard way (three sessions
burned on cold-seat materialization alone); this table is where it stays.

Base directory for this skill: /Users/lixiang/workspace/dsh-mobile/.agents/skills/ops-dispatch

## The spine (every task walks this order)

1. **Recall before designing** — load the `recall-first` skill; read
   `.gov/rules.md`. A settled question re-opened without its counterarguments
   is the failure this plane exists to prevent.
2. **Cut a seat** — load the `worktree-workflow` skill; `main` is protected.
   Then **`build/ensure-seat.sh [--verify]`** — a cold worktree is red until
   materialized, and bare `sync core` is NOT enough (the inventory lives in
   `.gov/materialization.json`; the script rsyncs it from the primary seat —
   never `cp`, whose interrupted run poisons the target).
3. **Work** — event-driven, no polling; parallel legs lease shared files
   (`parallel-workers` skill).
4. **Verify** — `~/.local/bin/gov run --base origin/main`; pick the smallest
   covering set with the `pre-push-checks` skill. A green claim without the
   command's exit code is not evidence.
5. **Land** — Angular commit → `git-safe push` (NEVER plain `git push`; the
   network flaps) → `gh pr create` → watch the `gates` check → squash merge.
6. **Close** — the AOCI chain (below), update memory facts that outlive the
   task, archive notes (`archive-agent-notes` skill).

## Dispatch table (intent → tool)

| Intent | Use | Notes |
| --- | --- | --- |
| "哪个 runner / 这条腿为什么没数 / 产物叫什么" | `node test/verifications.mjs --why <name\|artifact-stem>` · `--resolve <tests-tree-path>` · `--list` | The verification registry. Counts come from the leg the registry says — do not archaeologize. Unknown names exit 1 with the list. |
| Cold seat / gates red on an untouched tree | `build/ensure-seat.sh --verify` | Base-check reds (`bundle-files`, `closures`, `staging-generated`, self-test's baseline probe) on a fresh seat are ENVIRONMENT, not regression. Read `.gov/materialization.json` before adding a new untracked dependency. |
| Run the quality gates | `~/.local/bin/gov run --base origin/main` | One entry, both pre-push and CI. `--gate` takes ids space-separated and cannot combine with `--base`. |
| AOCI entry submission | `node tools/aoci/fras-lint.mjs --file <entries.json>` FIRST, then `aoci_update_entry` | F≤160 runes, R≤360/8, A≤400/6, S by C-rank (9-8:600, 7-4:200, 3-1:50). Local lint uses the same limits the machine enforces — one round trip saved per mistake. |
| AOCI task closing | `aoci_maintain` → author candidates → `aoci_update_entry` → `aoci verify --json` → `aoci check --json` → `aoci index agent guide --agent host_model --json` | Stop only when guide proves `complete=true, next_action=none`. Land `.aoci/baseline.json` + `aoci.*.txt` writes as a `chore(aoci)` PR. Restore the primary checkout's copies before pulling (they block ff-only). |
| Upstream spec changes | `node test/upstream-suite/transpile.mjs` (after materializing) | Bare imports stay loader-served; identity rewrites live in `transpile-rewrites.mjs`. The manifest is committed — comment-only changes must not drift it. |
| Upstream suite sweep (both legs) | `runtime/dsh/ci/run-upstream-suite-sweep.sh` | Counts come from the **qjs leg**; the Node differential leg is dead for some families — `test/verifications.mjs --why` says which. Staged artifacts are LOCAL-ONLY (untracked): after pulling transpiler changes, re-run `node test/upstream-suite/transpile.mjs` or the qjs leg silently serves the OLD artifact (measured: #614's fix was invisible on main until re-transpiled). |
| HarmonyOS local leg | `sh hosts/harmony/ci/run-host-e2e.sh` (`DSH_CLT=/opt/homebrew/share/harmonyos-commandlinetools/command-line-tools`) | Emulator `bin/Emulator -start dsh_phone`, wait for `hdc list targets`. The runner lives under `hosts/harmony/ci/`, NOT `test/e2e/`. |
| E2E receipts / coverage | `node test/e2e/matrix.mjs` (checker) · `doc/e2e-matrix.md` (the register) | The gate audits COMMITTED evidence only — stale-green artifacts are invisible to CI; the local full rerun is the only net for manifest drift. |
| Runtime/dsh edit landed | `build/build.sh sync <platform>` | The committed host mirrors (android assets, harmony rawfile, ios bundle) must re-stage in the same PR or `closures` goes red. |
| Push/fetch fails with SSL/connect errors | `git-safe` — THE tool for this; plain `git push` is known-flaky (global proxy 7890 + flapping direct path) | Alternate direct/proxy retries with window spacing; `gh api` often survives when git-HTTPS is choked. Never re-pin `http.version HTTP/1.1` globally — it was unpinned 2026-10-20 (h2 green on the direct path); scope per-URL if one path needs it. |
| CI failure that smells known | `.github/flakes.json` | Registered signatures retry ONCE in-step already (gov.yml tools-face). A manual rerun is `gh run rerun <id> --failed`; green-after-retry is visible, never silent. Rows carry expiry — fix flakes, don't normalize them. |
| Editing vendored/pinned upstream | `vendor-package` skill | D6: vendor verbatim, pin by sha256; adaptations live in `system-plugins/`. |

## Skills this table defers to (load, don't restate)

`recall-first` (before any design) · `worktree-workflow` (seats, landing) ·
`pre-push-checks` (smallest gate set) · `govrail` (gates, notes, plane) ·
`parallel-workers` (leases when legs share files) · `code-review` (reviewing
PRs) · `archive-agent-notes` (note lifecycle).

## Never (each earned its place)

- Never `git push` bare, and never `--no-verify` a cold-tree red — materialize
  first (rule: a cold-tree red is an environment finding, not a verdict).
- Never sleep-poll; wait on conditions (the no-sleep feedback is standing).
- Never `cp -R` for materialization — interrupted copies poison the target;
  rsync resumes.
- Never edit generated files (`DSHSpike.xcodeproj`, committed mirror copies)
  by hand — regenerate (`hosts/ios/gen.sh`, `build/build.sh sync`).
- Never claim landed without the receipt (merged PR sha or gate output).
- Never bump/tag/release without the owner's explicit go.
- Never edit a governed file (rules.md, gates.json, decisions.md, pairing
  records) without reading rule set 8 of `.gov/rules.md` first.
