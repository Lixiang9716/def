# Agent Note: Retire the dsh-shell-ish JS face: plugin trees, the local userland-shell gate family, and the marketplace listing

Status: implemented
Related: D16

## Problem

The ishRun primitive's real implementation left the JS surface on 2026-10-11
(D16's seat switch: dsh-shell-js took the `shell` seat on every host; no host
boots or mounts dsh-shell-ish, and CI is already `--no-ish`). What remained
was a pretend supply chain: a plugin tree no host mounts (reachable only by
marketplace install, where every host answers non-`unavailable` per the
recorded deviation), a manual local gate family (driver + scenario + checker)
whose subject is that retired engine, and a signed marketplace listing that
publishes a package which can never serve a session again. Each surviving
artifact claims, by existing, that the emulated userland is still a supported
face — exactly the dishonesty the retirement is supposed to remove. The
contract entry itself stays (v1 frozen, D5): the primitive becomes
honestly `unavailable` everywhere, which is a later PR's surface.

## Decision

This PR removes the JS/marketplace/local-gate face of dsh-shell-ish:

- Both plugin trees are deleted: `system-plugins/dsh-shell-ish/` and
  `runtime/dsh/system-plugins/dsh-shell-ish/` (grep-proven: their only
  importer was the deleted local scenario).
- The local gate family loses its driver and scenario:
  `test/e2e/run-ish-local.sh` and `runtime/dsh/scenario-local/userland-shell.js`
  (the directory's only file). `test/e2e/scenarios/userland-shell-local.json`
  STAYS: the frozen evidence verdicts
  (`runtime/dsh/artifacts/macos-cli-{userland-shell,ish-shell}/verdict-*.json`)
  resolve their manifests through it in the `e2e-matrix` gate, which audits
  the whole tree and fails on `SCENARIO_WITHOUT_MANIFEST` — verified
  empirically (gate red with exactly two unregistered findings when the file
  is removed). The checker retires together with the evidence dirs, which
  are frozen history and out of this PR's scope by order.
- Marketplace: the `dsh-shell-ish` rows leave `catalog.json` and
  `summaries.json`; the tracked `site/packages/dsh-shell-ish@0.1.0.tgz` is
  deleted; the signed sample `site/index.json` is REGENERATED, never
  hand-edited, with the README's throwaway-test-key flow
  (`generate-index.mjs --keygen/--build/--verify`, key id
  `dsh-market-test-1`, the sample's own `marketplace.example.invalid`
  base URL) — 9 entries, signature and all digests verified. The
  regeneration necessarily also adds the missing `dsh-plugin-manager-tools`
  tarball/catalog row: the tool's fail-loud drift check refuses to build a
  catalog that omits a packaged plugin (the committed sample predated that
  plugin, 2026-10-04). `tools/gen-marketplace-index.test.mjs`'s row-linked
  red-leg fixture now uses `dsh-shell-wasm`, another real row.
- `gateway.js`'s `ishRun` wrapper (lines 120–135) STAYS: a grep found a live
  importer the audit's caller inventory missed —
  `runtime/dsh/web-live/composer-web-live.js:395` (`probeIshRun`, staged to
  every host), which honestly records `unavailable` on hosts without the
  userland. Its retirement belongs to the descriptor/host-face PR.
- `hosts/android/ci/stage-spine-closure.sh`'s `RETIRED_PLUGINS` keeps only
  `dsh-shell-wasm` (the ish source tree is gone, so the skip entry was dead);
  `runtime/dsh/upstream/boot.js`'s seat-switch comment now says the ish tree
  retired outright; the staged twins moved by `build/build.sh sync`, never
  by hand.

## Alternatives considered

- Delete the scenario checker `userland-shell-local.json` too: rejected —
  it is load-bearing for frozen-evidence verdict resolution in the
  always-on `e2e-matrix` gate; deleting it turns CI red unless the frozen
  evidence dirs are deleted (forbidden here — history stays) or the two new
  findings are registered as accepted gaps (registering a gap this PR
  itself created is bookkeeping lying to the register).
- Hand-edit `site/index.json` to drop the ish entry: rejected — the file is
  signed; editing an entry invalidates the signature, and the README is
  explicit that the index is generated, never hand-edited.
- Keep the marketplace package but mark it unavailable: rejected — a
  catalog entry whose package can never serve any host is pseudo-supply;
  the honest face is absence from the catalog (the contract primitive
  stays frozen and answers `unavailable`).
- Rewrite `composer-web-live.js`'s `probeIshRun` away in this PR: rejected —
  out of the assigned slice (JS/marketplace/local gates only); touching the
  web-live probe belongs with the descriptor/disclosure pass that updates
  every host's honest-`unavailable` story in one place.
