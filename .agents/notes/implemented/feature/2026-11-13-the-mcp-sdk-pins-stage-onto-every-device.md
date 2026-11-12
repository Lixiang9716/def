# Agent Note: The MCP SDK pins stage onto every device host behind an extension-filtered dist trim

Status: implemented
Related: D21

## Problem

#632 landed the MCP streamable-HTTP transport and promoted its five npm pins
into the product closure (`external/ensure-dsh.sh` NPM_PACKAGES), but the pins
were materialized only as the CLI's dev face — no device host's embed list
carried them, so no phone could reach the SDK the transport dynamic-imports.
The pins' vendored trees are also the fattest in the closure: the client dist
alone ships 6.5 MB of which 4.0 MB is `.map` and 1.7 MB is `.cjs`/`.d.ts`
bytes no device loader consumes. Staging was blocked on deciding WHERE the
trim happens, because every host's embed list is hand-edited and the gates
exist precisely because hand lists lag (the vendor-package skill's #184/#196
trap class): a wrong shape here re-opens it.

## Decision

Every host now stages the five MCP pins' RUNTIME face — `.js`/`.mjs`/`.json`
only, 1.14 MB of the 8.5 MB whole-tree — each through its existing
drift-free-by-construction shape, and the trim is the extension filter
itself (D21):

- **harmony**: one `@walk js-mjs-json` line over the five pin dirs in
  `harmony-closure.rows`; `gen-staging-emit-closure.mjs` recomputes the
  find-span (77 rows) into `vendor-official.sh`'s CLOSURE assignment, whose
  copy loop + cmp twin stage and byte-verify rawfile. The same 77 rows join
  `harmony-BUNDLE_FILES.policy.rows` (Index.ets spliced by `--emit`) because
  `check-bundle-files` judges rawfile vs BUNDLE_FILES in BOTH directions —
  a rawfile file the list does not name is drift, so the CLOSURE and
  BUNDLE_FILES legs must move together.
- **android**: a noble/pi-ai-shaped find-scan block in
  `stage-spine-closure.sh` (five pin dirs, js/mjs/json filter) plus a verify
  twin cmping every found file; `MCP_PIN_DIRS` is defined beside `ZOD_SRC`
  so `--check` mode (staging skipped) still has it. The dist/ face is
  gitignored (untracked, Gradle-materialized — counted SKIPs, never
  silent); the package.json faces commit.
- **ios**: five whole-pin rows in `ios-TREES.rows`
  (noble/pi-ai precedent); `gen_bundle_header.py`'s spine suffix filter
  (`.js/.mjs/.json/.yaml/.yml/.md`) IS the trim — the py TREES block is
  machine-materialized by `--emit`.

The store files (`harmony-closure.rows`, `ios-TREES.rows`,
`harmony-BUNDLE_FILES.policy.rows`) are the hand-owned declarations; the
host blocks are machine-materialized from them (the staging-generated gate
fails on drift). The test corpus face (@modelcontextprotocol/node, /server —
`ensure-dsh-tests.sh` pins) is deliberately NOT staged: product staging
follows the runtime import chain only.

## Alternatives considered

- **Whole pins everywhere** (plan §4.1's option c): rejected by measurement
  — +8.5 MB per host for maps/CJS/typings no device loader reads; ~25 MB
  across the three embeds.
- **Per-file whitelist rows** (option a): rejected — 77 hand rows per host
  re-opens the embed-list-lag failure class the whole-pin mirrors exist to
  prevent; the extension filter keeps the find's automaticity while
  carrying the trim policy.
- **An extract variant in `external/ensure-dsh.sh`** (option b): rejected
  for now — ensure materializes the DEV face, which the CLI and parity legs
  read whole; trimming belongs to the STAGING face, which already owns
  per-host shape policy. Revisit only if a runtime face grows past tens of
  MB.
- **A derived `ios-mcp.rows`** like `ios-zod.rows`: rejected — the SDK's
  dist chunks are hash-named build artifacts (`src-D_zzAWoS.mjs`); the
  whole-pin TREES row + suffix filter needs no derivation and cannot drift
  from the pin tree.

## Consequences

The harmony app-bundle graph derivation still does not reach
`upstream/mcp-http-transport.js` (nothing in the boot graph imports it yet;
only scenario/mcp-streamable-http.js does, and no host stages that
scenario) — the transport + scenario rows land with plan §4.2's mount
wiring, at which point the graph derivation picks them up automatically.
Devices can now resolve every `/vendor/npm/@modelcontextprotocol/...`,
`/vendor/npm/jose/...`, `/vendor/npm/eventsource/...` and
`/vendor/npm/pkce-challenge/...` face the npm-bridges-pi-ai-all.js rows
serve; a pin bump is a pin row + `@walk` re-emit in the same commit (the
flip contract).
