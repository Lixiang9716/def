# One gateway-address derivation, current provider wording, loud cordis posture

Status: implemented

Date: 2026-11-13 · Class: simplification · Seat: feat/p2-hygiene (P2 shell/subprocess seam-audit deferred hygiene; task T-0292)

## Problem

The P2 shell/subprocess seam audit (T-0292) left three pieces of deferred
hygiene:

1. The gateway-address derivation — pinned profile globals
   (`__dshProfileCwd`/`__dshProfileScopeRoot`) → the gateway's `(scope,
   path)` pair inside the `app` scope — existed as three copies with
   identical math: `dsh-shell-js/applets-support.js` (`toGateway`),
   `dsh-fs/cordis.js` (`DshFsProvider.address`), and
   `dsh-office/fschannel.js` (`scopePathFor`). Three copies of a
   security-relevant mapping drift independently; a fourth consumer would
   plausibly have copied one of them again.
2. Ceremony text still described the pre-#762 fs world: the fs-seam-gate
   refusal named `mountWorkspace` as the fs backend, web-write-files'
   header claimed the workspaceFiles reads are "answered from the REAL
   vendored `fs` service (dsh-fs-local)" over "ONE in-memory root", and
   boot-coverage-rows' FILE-REFERENCE comment said "the `fs` service"
   without naming what that service now is. Anyone debugging from these
   strings was pointed at the retired provider.
3. The three providers refused a missing/misshapen profile grant
   differently: the shell throws `GatewayError('unavailable')` (exit 2
   through the executor) and the office channel throws the same family,
   but `DshFsProvider.address` silently degraded to an empty prefix — a
   config error would have surfaced as confusing not-found errors from
   the wrong scope instead of the actual cause.

## Decision

- `runtime/dsh/scope-address.js` (new root module) owns the derivation:
  `scopeRoots(surface)` (the validated pinned roots; the refusal message
  is the one shared string, the surface names the consumer in the
  GatewayError's primitive slot), `workspacePrefix(roots)`, and
  `appScopeAddress(clean, prefix)` (the join the shell and the provider
  share byte-for-byte). The three former copies import it bare and their
  local math is deleted. `scopePathFor` keeps its own one-line join (it
  strips leading slashes and never emits the `.` sentinel — its
  byte-identical edge behavior is kept, not unified).
- `DshFsProvider.address` now refuses loudly through the same
  `scopeRoots('fs')` call: `GatewayError('unavailable', 'fs', …)`, the
  shell's posture. Consumers were checked first: the workspaceFiles
  adapters, office fschannel (gateway primitives, not the provider), and
  tool-fs all run only in boots where the spine pins the profile globals
  (boot.js `pinProfileContainer`); no leg depends on the silent degrade
  (the panel suite never mounts the provider; the parity/suite legs ride
  fs-local, which is untouched).
- The three stale texts now name the post-#762 truth: ctx.fs is the
  DshFsProvider over the gateway fs primitives; the node:fs seam mounts
  the same pinned profile workspace. Pins checked first — the panel
  suites assert only the stable `outside the writable workspace root`
  prefix, never the parenthetical.
- Roster joined per the #765 precedent: android stager's three dsh-root
  for-in lists, harmony-closure.rows (spliced into vendor-official.sh),
  harmony-BUNDLE_FILES.policy.rows (+ emit-spliced BUNDLE_FILES.rows and
  Index.ets), ios-RESOURCES.rows (+ emitted gen_bundle_resources.py row
  and a BundleStager write), and the panel vitest alias.

## Alternatives considered

- One `scopeAddress(rel)` that all three call (fschannel included): would
  have changed fschannel's outputs at the edges (empty relative path with
  a non-empty prefix currently yields `<prefix>/`, not `<prefix>`; no '.'
  sentinel). The brief mandates byte-identical behavior, so the join
  stays per-contract and only the shared math moved.
- Folding the office channel onto `appScopeAddress` with a flag: same
  objection, plus a flag-selects-shape helper is two helpers in a trench
  coat.
- Leaving cordis's silent degrade and only deduping: rejected — the
  audit's point is that a config error must be detected identically
  across providers; the degrade converts a missing grant into
  wrong-scope not-founds, which is exactly the silent-failure class the
  rules forbid.
- Rewording the fs-seam-gate refusal without checking pins: rejected;
  the pins were grepped first (only the stable prefix is asserted), so
  the parenthetical was free to change.

## Consequences

- A fourth consumer of the derivation imports `scope-address.js`; the
  plugin-manager-tools workspace prefix helper keeps its deliberately
  tolerant variant (documented in its source) and was left alone.
- A seat whose spine fails to pin the profile globals now fails every
  provider fs op loudly (`unavailable`) instead of serving wrong-scope
  misses — the failure is immediate, named, and identical in shape to the
  shell's.
- gen-staging-emit's --emit silently pruned a hand-declared
  harmony-BUNDLE_FILES.policy row whose file was not yet in the committed
  rawfile tree (the row must be re-added after `sync harmony` materializes
  it) — recorded as field feedback; check mode fails loud, emit mode did
  not.
