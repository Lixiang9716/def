# Agent Note: MCP over streamable-HTTP — the vendored client transport composed over gateway httpFetch

Status: implemented
Related: D5, D6, D8, T-0269

## Problem

The plugin-integration ledger (`doc/dsh-desktop-plugins.md`, "Still staged")
carried one last MCP gap that the rest of the row had already outrun:
`@modelcontextprotocol/client@2.0.0` was pinned (in the TEST table,
`external/ensure-dsh-tests.sh`) and bridged (`shims/npm-bridges-b.js` — the
client, its `_shims`, `core/internal`, `/stdio` and the bare dependency faces
`zod/v4`, `pkce-challenge`, `eventsource`, `jose`), the stdio transport was
linked, yet NO transport could actually reach an MCP server from this
runtime: stdio needs a subprocess (the no-process wall, D2) and the
streamable-HTTP transport was never connected to the gateway. The strategic
value of MCP on a phone is exactly the HTTP leg — a mobile runtime dialing
ANY remote MCP server over plain HTTP(S), with no process to spawn — so the
gap was the one that mattered, and it sat in the ledger as "the remaining
recorded gap" with nothing proving it either way.

## Decision

The streamable-HTTP transport is the VENDORED one, composed over the
gateway's fetch face — no new transport code and no new gateway primitive:

- `upstream/fetch-gateway-bridge.js` exports `gatewayFetch` — the WHATWG
  `fetch` face that the bridge already builds over gateway `httpFetch` (the
  2026-10-12 multi-protocol leg's precedent), now reachable as a named export
  so a transport can be handed a fetch WITHOUT the bridge having to install
  itself as the global.
- `upstream/mcp-http-transport.js` composes the vendored
  `StreamableHTTPClientTransport` with `fetch: gatewayFetch` injected through
  the transport's own option — session headers, the SSE response stream, and
  protocol-version negotiation all ride the upstream bytes verbatim (D6);
  the body is consumed chunk by chunk through the gateway's streaming face
  (D8); `httpFetch` is the only primitive touched (D5, zero new rows).
- The PRODUCT boot gains the link-time globals the vendored graph needs
  (`upstream/web-shims.js`, installed only when absent): the first probe run
  died at the SDK's dynamic import with `Event is not defined`
  (`eventsource@3.0.7/dist/index.js:2` — `class ErrorEvent extends Event`,
  `:64` — `class EventSource extends EventTarget`), then `TransformStream is
  not defined` (`eventsource-parser@3.1.0/dist/stream.js:3`). Those classes
  existed only on the SUITE harness path (`shims/globals.js`); the boot now
  installs the `shims/web-event.js` family through one shared face
  (`installWebEvent`, which `globals.js` calls too) plus `TransformStream` /
  `TextDecoderStream` from `shims/web-streams.js` (the SSE response path's
  `body.pipeThrough(new TextDecoderStream())`). No vendored byte changed.
- A probe leg proves it on the CLI: a Node mock streamable-HTTP MCP server on
  loopback, scenario `mcp.streamable-http`, one-to-one manifest, runner
  `runtime/dsh/ci/run-mcp-streamable-http-e2e.sh`, artifacts under
  `runtime/dsh/artifacts/macos-cli-mcp-streamable-http/`; the leg is the 15th
  `build/build.sh test core` row and is registered in
  `test/verifications.mjs` (`mcp-streamable-http`).
- The client's pins move from the test table to the PRODUCT closure: the
  five rows (`@modelcontextprotocol/client@2.0.0`, `core@2.0.0`,
  `jose@6.2.3`, `eventsource@3.0.7`, `pkce-challenge@5.0.1`) join
  `external/ensure-dsh.sh` NPM_PACKAGES and leave `ensure-dsh-tests.sh` the
  same day — one pin per face, same bytes, same tracked mirror tarballs.
  (`@modelcontextprotocol/node`, `/server` and `@hono/node-server` stay
  test-only: they are the mock's side of the wire.)
- Every status surface says the same thing: the ledger row moves from
  "Still staged" to the landed set (en + zh), `doc/plugin-dev.md`'s
  mcp-memory disposition names the client as vendored with streamable-HTTP
  landed and stdio still the wall (en + zh), and `upstream/README.md`'s shim
  table gains the `@modelcontextprotocol/client` row.

What this does NOT do yet: the transport module itself rides the host embed
lists the staging gate demands (an `ios-RESOURCES.rows` row — the iOS
embedder mirrors `scenario/` whole, so the probe scenario's import edge must
resolve — and the android assets mirror, which carries `upstream/*.js`
wholesale), but no host stages the five vendored MCP trees (iOS TREES /
harmony CLOSURE / android pin rows + `build/build.sh sync`): on a device the
SDK's dynamic import refuses loud today, by name. No MCP tool row is mounted
on the ToolRuntime either — the client is a product-closure/CLI face; both
are the ledger's next step. The stdio transport stays in the
physically-impossible set.

## Alternatives considered

- **A hand-written Transport class over `httpFetch`**: smaller on paper, but
  it would re-implement the streamable-HTTP protocol surface the vendored
  transport already gets right — the `Mcp-Session-Id` header lifecycle, the
  SSE event stream and its reconnection semantics, the
  `MCP-Protocol-Version` negotiation, the POST/GET/DELETE shape. Every one
  of those is a correctness hazard against real servers and a D6 violation
  in spirit (reimplementing Harness-adjacent behavior in-house, D9). The
  vendored transport takes a `fetch` option precisely so a host can inject
  its own fetch — that is the seam, and it costs one composition file.
- **Editing the vendored bytes** (patching the transport to call
  `httpFetch` directly): forbidden outright by D6 — vendored trees are
  verbatim, sha256-pinned, and every adaptation lives in `runtime/dsh/`
  outboard modules. It would also break the pin stamps the ensure scripts
  verify.
- **Waiting to land it together with host staging + the tool-row mount**:
  rejected because a ledger-named gap should land and be verified
  independently — the transport is provable on the CLI against a mock
  today, while host staging is a separate, mechanical sync step and the tool
  row is a product decision (which servers, which tools, which approval
  flow). Bundling them would have parked a proven transport behind two
  unrelated schedules.

## Evidence

- `sh external/ensure-dsh.sh` (SEAT, offline): exit 0 — 114 rows
  `present (pin-stamped)`, the five new rows re-materialized from the
  tracked mirror (`external/dsh-tarballs/`) with sha256 verified and
  re-stamped in the product script's bare-digest format, zero network lines.
- `tools/supply-audit/pins.py` over both tables: 59 NPM_PACKAGES + 60
  DSH_PACKAGES + 302 test rows, zero conflicting pins; the five dirs resolve
  to `ensure-dsh.sh:NPM_PACKAGES` only.
- `node test/verifications.mjs --why mcp-streamable-http` answers; `sh -n
  build/build.sh` parses with 15 core legs.
- The probe's own counts live in its artifacts dir (the leg writes
  `verdict.json` expected↔logged) and in the e2e-matrix row that lands with
  the evidence pass — not restated here.

## Notes and honest boundaries

- The product script's `stamped()` is an exact-match on the bare digest
  while the test script stamps `url=…/sha256=…`, so a tree first
  materialized by the test script is re-extracted ONCE by the product
  script (same bytes, mirror-served). Not a defect, but worth knowing when
  reading the first run's "fetched" lines.
- `cross-spawn` (the client's stdio dependency) stays a test-table pin: the
  stdio face links and refuses at the process seam, as before.
