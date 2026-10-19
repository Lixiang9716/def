# Lynx client joins the host client selection (carrier part 1)

Status: implemented
Date: 2026-10-19 · Task: T-0266 (#265 part 1) · Class: feature

## Problem

The dev carrier's `--client` roster was a two-value whitelist (`official`,
`next`). The lynx render surface client existed — RenderSurfaceClient seam
(`driver/render-surface-client.js`), the bundle's seam core
(`shared/surface-core.js`), the committed ReactLynx bundle — but no host
client selection could mount it: the only mount evidence was the standalone
e2e leg (`test/e2e/lynx-mount.mjs`) over the mock serve. #265 part 1 asks
for the selection face (device pixels stay gated: they need a real Lynx
engine, which no CLI/CI host has — the skin refuses honestly, and the
boundary is asserted in the log fields).

## Decision

The roster grows to three: `--client lynx` (dev-carrier.mjs) dispatches to
`tools/dev-web-carrier/lynx-mode.mjs`, which reuses next-mode's fixture
machine — the new `createCarrierMachine` plus the now-exported `serveApi`,
`handleMux`, `muxUpgradeAllowed` — one wire, never a parallel copy. After
listen, the mode mounts the lynx skin (`createLynxSkin({host:'cli'})`) over
the carrier's own serve in-process — `createSessionServe` + `createDriver`,
the same four shapes as `test/e2e/lynx-mount.mjs` — and opens the seeded
fixture session. The mount path needs no npm dependencies: it drives the
bundle's real seam core, not the engine; only rebuilding the bundle needs
@lynx-js, and a missing/too-small bundle fails loud through the existing
`verifyBundleArtifact` → `main().catch` → `[dev-web-carrier] fatal:` + exit 1
route, exactly like roster and argument errors.

Auth: `muxUpgradeAllowed` accepts `?token=` beside the cookie (the same
secret authLite mints cookies with) because the lynx wire's Node WebSocket
sends no Cookie headers; the token rides the ws URL via an additive
`muxUrl` parameter on `createSessionServe` (default unchanged — the fetch
path stays plain, and /api stays unauthenticated as the next-style service
always had it).

The mode's stdout is the render log (AGENTS "E2E by logs"): roster line,
`client.selected` (face + selection source + scenario `lynx.client-select`),
`face.mounted` (mount mechanism + artifact bytes/sha256), mux/connection/
drawer/seed settles, and every transcript change re-printed.
`tmp/lynx-smoke.sh` asserts the three faces — roster offers lynx (unknown
names still fail loud, `--client next` still boots), selection mounts
(artifact facts must match the file on disk, not a hardcoded pin), and the
face really serves the render (a dev-echo turn over the carrier's own /api
lands all markers in the transcript; the cancel face pipelines prompt and
cancel on ONE raw socket, so the cancel bytes reach the carrier before the
turn's first 30ms tick by construction).

## Alternatives considered

- Token-in-baseUrl (the scout's mountPlan): rejected on URL algebra —
  `fetch(\`${baseUrl}/api/…\`)` with a `?token=` base puts the API path
  inside the query string (`pathname=/`, verified in node), breaking both
  the fetch and the ws path. The additive `muxUrl` parameter carries the
  token on the ws URL only.
- A registry-driven roster (read lynx from the package manifest): rejected —
  the roster is deliberately a closed whitelist with a fail-loud unknown
  (`parseArgs`), and part 1 stays minimal; the manifest keeps declaring the
  package for the on-device round.
- Extending the official-mode carrier to serve lynx: rejected — official
  answers only the point-shaped `session.list` envelope and has no live mux
  face; lynx rides the next-style machine by design.
- Prompting the freshly created session in the smoke (as the scout's
  smokePlan wrote): impossible to render — the in-process driver follows
  only the session its mount opened, so the smoke exercises
  `session/create` as the live-claim surface and prompts the followed
  seeded session for the render proof.

## Consequences

- `--client next` behavior is unchanged except that its mux upgrade gate
  now also accepts the `?token=` form (same secret as its authGate — no new
  capability).
- A pre-existing echo-machine property is now visible over HTTP: a cancel
  that lands mid-settle legitimately renders whatever had already settled
  (the fold is append-only), and a cancel landing in the turn's final
  completion window appends a cancelled turn/end after the settled one. The
  smoke's cancel face therefore pipelines prompt+cancel on one socket so
  the cancel lands before the turn's first tick — the run-mock-family
  assertion (已停止, reply never lands as text) holds by construction, not
  by winning an HTTP-latency race. The machine's tail-window behavior is
  follow-up, not part 1.
