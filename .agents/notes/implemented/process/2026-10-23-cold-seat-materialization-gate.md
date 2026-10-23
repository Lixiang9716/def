# Agent Note: the cold-seat materialization gate — one fresh worktree, one spec, both legs, exit 0 or a named face

Status: implemented
Related: plan §3.7; `process/2026-10-20-ensure-seat-materializes-the-cold-seat.md`
(the executor this gate drives); the 2026-10-22 cold-seat pty regression (the
failure class that motivated queueing this)

## Problem

A fresh worktree passes every static gate and still cannot run a single
upstream spec: the untracked materialization a seat needs — the vendored
closure, the submodule corpus, the Node resolution farm, the node-pty native
binding, the transpile products, the built CLI — is exactly the surface that
silently rots. `ensure-seat` (2026-10-20) made a seat materializable, but
nothing in CI ever proved the whole chain reaches a green spec from a fresh
worktree; the 2026-10-22 cold-seat pty regression was that chain breaking in
the one place no gate watched. Worse, when the chain does break, the failure
surfaces as a cryptic timeout or a MODULE_NOT_FOUND far from the missing
face — the personDebugging cannot tell a broken farm link from a slow runner.
Plan §3.7 asked for this gate explicitly, with the regression as fresh
evidence of its value.

## Decision

- `build/cold-seat-gate.sh <worktree-root>` drives the full chain in seven
  `[gate k/7]` steps: (1) vendor-closure reachability — only when the primary
  checkout cannot source the sync verbs' inputs (a bare CI checkout) do the
  pinned ensure scripts materialize it in the seat first; (2) `ensure-seat
  --verify` — the manifest's rsync, sync verbs, provisions, and the
  bundle-files+closures probes; (3) the upstream-suite esbuild host (npm ci
  when absent); (4) the materialization faces, each named on failure:
  submodule corpus, dsh-tests vendor (the row read from the manifest — it is
  version-suffixed), farm link integrity (every symlink in
  `external/node_modules` must resolve), node-pty binding; (5) transpile plus
  the gated spec's presence in its products; (6) dsh-cli built when missing
  plus the qjs leg; (7) the node leg. Both legs assert exit 0 AND
  `"failed":0` in the summary line the sweep registry defines (qjs:
  last `suite/summary`; node: first `harness smoke:` line), under the sweep's
  own 90s per-leg cap via a poll watchdog (no coreutils `timeout` on macOS).
  Exit 0 is the only green; every failure names its face — a bare timeout is
  never a verdict. The one gated spec is
  `api__terminal-controller__tests__retention.spec.mjs` (choice argued under
  Alternatives; the first-cut controller was retired on linux-CI evidence —
  see Alternatives).
- The submodule face is fatal at the GATE, not left to transpile: transpile
  only warns on an absent submodule and shrinks `manifest.json` to a partial
  corpus while exiting 0 (transpile.mjs:121), so a shrunk corpus could go
  green silently. The gate checks the corpus structurally before transpiling
  and greps transpile's output for the warning after.
- `.github/workflows/cold-seat.yml`: `pull_request` + `workflow_dispatch`;
  two parallel jobs, no `needs`. Each materializes the PRIMARY checkout
  first (`external/ensure.sh`, `external/ensure-dsh.sh`,
  `external/ensure-dsh-tests.sh`, cache as accelerator keyed on the pin
  tables) because a cold primary would turn every manifest row into a
  loud-but-nonfatal SKIP and the rsync materialization would never actually
  be exercised; then cuts the sister worktree from git (`git worktree add
  --detach`), then runs the gate (or `--self-test`). Conventions mirrored:
  `ubuntu-24.04-arm`, node 22, govrail pinned at gov.yml's `0.52.0`
  (ensure-seat's `--verify` needs gov), checkout with `submodules: true` so
  the provision's offline clone has a source. Timeouts: 15/20 minutes —
  local-measured job equivalents ×2 (144s gate, 152s self-test on
  2026-10-23) plus margin for the one case a dev seat cannot produce (a
  cache-cold CI primary fetching ~190 pin faces), under the 25-minute
  ceiling the plan sets. actionlint/shellcheck pins are NOT installed here:
  they serve gov.yml's actionlint gate, which this workflow does not run.
- The rejection case (`--self-test`): run the full gate (green), repoint the
  farm's `node-pty` link at a void, run the gate's CHECK pipeline (steps
  3-7) and require RED naming face 'farm', restore with `build/ensure-seat.sh`
  (the parity provision relinks every stale claim), require GREEN. Exit 0
  only when both directions were actually observed. The red observation
  deliberately skips the repair stages: `ensure-seat`'s provision provably
  heals every named face (parity-node-modules.sh relinks dangling claims;
  the submodule provision reclones when `.git` is gone), so a full run would
  repair the plant before any check could see it. Rule 6 asks the case to
  prove the CHECKS catch the violation — and phase 4 separately proves the
  repair is the recovery story it claims to be.
- `.gov/materialization.json` is unchanged: every face this gate needs is
  already carried — the submodule and the farm by `provision`, the dsh-tests
  corpus and both node_modules by `trees`, the rawfile staging by
  `syncVerbs`. The npm ci, transpile, and CLI build are the gate's own
  steps, not seat materialization (the manifest's documented scope is the
  gates' base checks and the Android host build; `runtime/dsh/build/` is a
  compile product the sweep already names `sh src/build.sh` for).

## Alternatives considered

- The gated spec. Three candidates were measured; the gate v1 gates
  `api__terminal-controller__tests__retention` (13/0 on both legs, the
  smallest same-package spec green on BOTH legs on linux CI — weekly-sweep
  run 39110205498 — and seat-measured on 2026-10-23).
  - `api__terminal-controller__tests__controller`, the first cut (68 KB
    transpiled, 3.05s both legs, 55/0 twice on darwin), exercised the two
    hardest seams for real on BOTH legs: a genuine PTY spawn (node leg
    through the vendored node-pty binding — the exact face of the
    2026-10-22 regression — qjs leg through the forkpty shim) and
    `node:module` createLazyRequire through the shim table. It is RETIRED
    on linux evidence this gate surfaced on its first CI round: its
    interactive-shell case's cleanup path (`terminate` → `stopDescendants`
    → `snapshot`) lists `/proc` through `node:fs`, and the qjs harness's
    real-disk seam deliberately refuses any readdir outside the workspace
    root (`shims/fs-readdir.js:108-141`, the loop-r containment), so the
    vendored package's catch-all (`runner-launch-DGV26RBf.js:422-428`
    turns any throw into "Cannot inspect processes") fails the case —
    54/1 on this PR's CI round and TIMEOUT-OR-ERROR on BOTH legs in
    main's own weekly sweep (run 39110205498): it has never been green on
    linux CI. Pinning it would make this gate permanently red. The gate's
    duty is materialization completeness, not runtime semantics; the live
    PTY-spawn face is a v1 known boundary — retention still crosses the
    node-pty binding's require/resolution face (what #660 broke) and gate
    4 statically probes the binding. Swapping controller back in awaits a
    runtime /proc face (dsh-mobile issue, linked from the PR).
  - `subprocess__subprocess-local__tests__control` (111 KB with its
    fixtures module, 5.16s, 6/0 twice): carries a real fixture-seeding
    face (four `.fixtures.js` files, seeded and consumed by a real child
    process), but its node:module face is dormant on darwin (all
    koffi/resolve call sites are win32/linux-gated) — the classic
    "imported but never executed" trap — and it costs 1.7×. If the gate's
    intent ever shifts to weight fixture seeding, control is the swap.
- Red observation through the FULL gate (repair included): rejected by
  construction — the repair phase provably heals the very faces the gate
  exists to catch, so a planted defect can never survive to a check. The
  honest rejection observes the check pipeline alone, then proves the
  repair story separately (phase 4).
- One combined job (gate, then self-test sequentially): halves nothing —
  the two faces are independent claims (the gate works / the gate can fail),
  and an independent rejection job keeps a vacuous-gate failure visible even
  when the gate itself is green, instead of buried in step two of one log.
  It also keeps each job under a tighter timeout. Cost: one more
  materialization per run — accepted, because the materialization IS the
  thing being verified and both jobs verify it from independent worktrees.
- Gating the full 681-spec sweep instead of one spec: that is weekly-sweep's
  inspection (240-minute budget, continue-on-error by design). A gate on
  every PR needs a deterministic, bounded verdict; one spec through both
  legs bounds the legs at 3s while still crossing every materialization
  face — the faces, not the suite scale, are what this gate verifies.
- Waiting for govrail to grow a first-class materialization concept (the
  2026-10-20 note's upstream candidate): unchanged verdict — the manifest
  and `ensure-seat` already own the inventory; this gate is their first
  CI consumer, which is the precedent that upstream generalization needs.

## Consequences

Every PR now proves a fresh worktree reaches a green spec on both legs, and
the manifest's SKIP warning has a CI reader. The gate trusts the primary:
the rsync materialization is only as honest as the primary checkout's trees
(pin-stamps guard that) — on CI the workflow materializes the primary
explicitly, and a cold primary without that step would SKIP its way to a
meaningless green, which is why the materialize-the-primary step carries a
comment naming exactly that. The farm face is checked structurally (link
resolves), not behaviorally; the node leg's real PTY spawn is the behavioral
half of the same claim. `--self-test` mutates and restores the farm inside
ONE job on a worktree nothing else reads — the concurrency group keeps
superseded runs cancelled, so two self-tests never race one worktree.
