# Agent Note: the multi-protocol family dials real endpoints — the gated fetch-gateway bridge and the named-exception user-endpoint gate

Status: implemented
Related: D5

## Problem

The pi-ai mount (the 2026-10-11 note) served exactly one transport face: a
route pointing at an in-process loopback server streamed the vendored
library's REAL wire layer, and any other target kept the loud fetch
rejection — because the runtime's `globalThis.fetch` is the fail-loud +
loopback-only face (`upstream/shims/web-fetch-values.js`), and the gateway
`httpFetch` primitive was invisible to the library. The consequence: a BYOK
user could not actually use the multi-protocol family. The BYOK surface
(`upstream/llm-route.js`) serves user credentials whose flavors the gateway
adapter cannot speak — an anthropic-messages credential had no served path
at all, and the protocol SDK faces the vendored pi-ai lazy-imports
(`@anthropic-ai/sdk`) fail loud at API construction (the prior note's own
consequence). The mobile closure could name a second protocol but could
dial none of them past loopback.

## Decision

Four layers, each the smallest seam that can carry the weight:

1. **The named-exception gate** (`upstream/llm-piai-mount.js`): a route
   whose baseURL dials past loopback must SAY SO with `userEndpoint: true`
   on its provider row — the same named-exception discipline
   `llm-transport.js` keeps at its own construction gate. `demandUserEndpoints`
   fails loud at mount naming every undeclared route; a row with NO baseURL
   declares too (its catalog default is a real endpoint). Loopback rows pass
   unchanged — the probe's face stays byte-identical.
2. **The fetch→gateway bridge** (`upstream/fetch-gateway-bridge.js`): the
   ONE gated upgrade of `globalThis.fetch` from fail-loud+loopback to
   fail-loud+loopback+USER ENDPOINT. The dispatch order is frozen — the
   wrapped fetch consults the PREVIOUS global first and takes over only on
   its loud rejection, so the undici proxy policy and in-process loopback
   keep priority and a loopback host NEVER reaches the gateway. The promise
   settles on response HEADERS and the body streams chunk-by-chunk from
   `httpFetch`'s AsyncIterable (D8 — never a blocking whole-result). No
   policy is invented: no timeout, no retry, no redirect follow. Default-off:
   a boot without a declared non-loopback route never even imports the file,
   and the mount emits the `llm/piai-bridge` honesty event (hostnames only —
   never a path, never key material).
3. **The composed SDK face** (`upstream/shims/anthropic-client.js`): the
   `@anthropic-ai/sdk` surface the pinned pi-ai 0.85.1 dist touches,
   composed over the runtime's own fetch — the openai-client precedent, no
   vendored tarball (D6's outboard-adaptation discipline). Two auth
   spellings (`x-api-key` / Bearer), `anthropic-beta` as a header, raw SSE
   body, non-2xx → the SDK's status/error/message throw shapes;
   `timeout`/`maxRetries` accepted and inert (no wall-clock seam; pi-ai
   passes `maxRetries: 0` expecting no SDK retry).
4. **The BYOK flavor dispatch** (`upstream/llm-route.js`): provider rows
   name their wire flavor `api` (`openai-completions` rides the gateway
   adapter byte-identically; `anthropic-messages` rides the pi-ai mount).
   A non-openai-completions flavor gets its `piaiProviders` route dict —
   the credential rides as the `apiKeyEnv` REFERENCE (deriveByokRef), never
   key material — and `rebindLlmRoute` hands it to the mount's new rebind
   seam (`rebindPiAiProviders`), which mounts the plugin ONCE with an empty
   base layer and drives the route changes through the plugin's OWN settings
   section (the one supported update seam), returning an async revert the
   restore leg calls.

The BYOK credential IS the named user-endpoint decision — the route dict
says `userEndpoint: true`, so a saved credential rides the same bridge a
boot-declared endpoint does; the save path's honesty line logs through the
wired logger (no boot onEvent there). Mirrors land as byte-copies
(android assets, harmony rawfile, presentation webclient), the staging
manifests regenerate (ios RESOURCES + harmony BUNDLE_FILES rows), and the
panel pins grow the `/upstream/` dsh-root alias the bridge's stream import
spells.

Evidence, re-proven on this tree (`sh runtime/dsh/ci/run-llm-piai-e2e.sh`,
4 legs, 0 failed): leg① probe loopback anchor PASS 12/12; leg②
`llm.piai-user-endpoint` PASS — the negative phase (undeclared non-loopback
route fails loud AT MOUNT, deterministic, no network) plus the positive
plane (declared route mounts, bridge installs, the forwarder-carried real
dial returns a STRUCTURED 401/403 — the crossed-the-seam proof) plus the
BYOK save-path phase; leg③ `byok.anthropic-wire` PASS 10/10 — one REAL
anthropic-messages turn over the in-process SSE server, the rebind-over-mount
round, the 401 face, the clear; leg④ `llm.piai-live` PASS skipped-honest
(no served key — the honest skip posture). The key audit is three-layer on
every leg that touches a credential: the scenario never emits key material,
the runner greps the RAW capture, and the matcher proves itself on a seeded
line first.

## Alternatives considered

- Widening the runtime fetch global unconditionally (bridge installed at
  boot): lost because a boot that never declared a user endpoint must keep
  today's fetch byte-identical — the gate is what makes the process-wide
  upgrade honest, and the loopback boundary stays the E2E determinism wall.
- Declaring `userEndpoint` per DIAL instead of per route row: lost because
  the route row is the configuration surface the credential owner already
  controls and the mount can prove at mount time; per-dial policy would
  need a fetch-time caller identity the process-global face cannot carry.
- Vendoring `@anthropic-ai/sdk` verbatim beside pi-ai: lost because the
  openai-client precedent already composed the face over the runtime's own
  fetch — the SDK's transport is exactly the part this runtime must own,
  and an unfetched heavy dep keeps the closure lean (D6).
- Teaching the gateway adapter to SPEAK anthropic-messages: lost because
  per-protocol adapters in our writing speed is exactly the duplication the
  vendored plugin owns; the flavor dispatch keeps `openai-completions` on
  the historical path and hands only the foreign flavors to pi-ai.
- Rebasing the BYOK rebind on a second plugin instance: lost because the
  plugin's settings section is its supported update seam and its own
  reactivity re-registers routes; a second instance would fork registration
  state the registry cannot reconcile (and the directory row would
  DUPLICATE — the boot handle's row withdraws first instead).

## Consequences

The bridge upgrade is PROCESS-wide once installed (globalThis is a process
global; there is no per-caller fetch) — the `hosts` label set is the
DECLARED honesty label, not a dial firewall; the gate at the mount is the
policy surface. The `llm.piai-live` real plane is UNMEASURED pending a
served key: the leg is green in both planes by design, but a real turn
against a served credential (`DSH_PIAI_LIVE_KEY`, owned by the repository
owner) is the acceptance act that remains — an owner-side measurement, not
a CI fact. The served protocol SDK faces beyond anthropic
(`@google/genai`, `@aws-sdk/*`) still fail loud at construction until they
get shim faces; staging the pi-ai family per device host (iOS TREES /
harmony CLOSURE / android embed rows beyond the CLI leg) stays the
follow-up the prior note named.
