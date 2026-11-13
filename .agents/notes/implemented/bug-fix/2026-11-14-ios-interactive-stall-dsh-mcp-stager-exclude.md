# The iOS interactive seat's silent boot stall: the stager exclude hid the def-bundle-mounted dsh-mcp trio

Status: implemented
Date: 2026-11-14 · Class: bug-fix · Issue: #691 (the page-open pin's first catch after the #787 fast-fail)

## Problem

PR #789's iOS page-open pin boots the plain RELEASE product seat (no drive
arguments) and asserts the serving-origin line, a 200 on `GET /api/state`, a
persistent carrier connection, and zero FAIL lines. Past the #787 fast-fail
(the staged tree missing `upstream/boot-permission-presets.js`), the boot went
SILENTLY dead: the carrier bound its loopback port, the keychain audit fired
(the boot's only surviving `dsh.*` emission in the release log regime), the
WebView committed a layer tree ~12s late, and then nothing — no
`dsh.serve: origin token=…`, no `settings.probes.done`, no failure line of any
spelling the pin greps. The same machine drove every evidence leg green, and a
clean CI runner reproduced the stall (no local-load flake).

Every channel that could have named the failure was dark in a release boot:
the runtime half's fail gate emits `scenario.failed` through the unified
logger at info level (stripped by `-DDSH_RELEASE`), the seat's
`onRuntimeSettled` hook is unassigned in the user-facing boot, and the
`onRuntimeFailure` NSLog only fires on WebBootRuntimeDrive drive failures —
a JS-side boot failure never reaches it.

Reproduced on a DEBUG harness seat (`-dsh-serve`, where debug records
survive), the boot died loud at the spine mount:

```
cannot load module 'system-plugins/dsh-mcp/index.js'
```

## Decision

The root cause is a stale hand-owned staging decision, not a runtime bug.
`tools/generated/staging/ios-stager.exclude.rows` excluded the three
`plugin_mcp_*` RESOURCES rows from the BundleStager with the rationale "the
mcp + plugin-manager-tools accessors serve no iOS staging today (their drives
live on the other hosts)". That was true when written; #780 then mounted the
dsh-mcp plugin from the def bundle (`load: () =>
import('system-plugins/dsh-mcp/index.js')`) on EVERY spine boot, which turned
the staged bytes into a boot-time requirement on every host. Android stages
whole `system-plugins/` directories and Harmony's CLOSURE rows carry the
trio, so iOS was the only host left without the file on disk. The dsh-mcp
directory has no TREES mirror row, so with the stager rows excluded the file
was embedded in the binary but staged nowhere: every iOS spine boot — the
interactive release seat, and equally the non-interactive b4 composer drive —
died at `mountDefRows`.

The fix removes the three `plugin_mcp_*` rows from
`ios-stager.exclude.rows` (updating the group comment to record why), lets
`tools/gen-staging-emit.mjs --emit` re-splice the generated
`dsh:stager-rows` block in `hosts/ios/App/Source/BundleStager.swift`
(105 → 108 rows), and regenerates the embedded bundle via
`hosts/ios/gen.sh`. The default-include discipline #667 built ("a new
embedded row stages without a stager edit") is restored for these rows.

## Alternatives considered

- Add a `system-plugins/dsh-mcp=system-plugins/dsh-mcp` TREES mirror row
  instead (the way dsh-ble / dsh-device-plane / dsh-plugin-manager-tools
  reach the device). Rejected: it adds a whole-dir mirror to serve three
  files, and the RESOURCES rows for those files already exist and are
  embedded — un-excluding them is the smaller, derivation-aligned change.
- Fix the fail-silence instead (route the runtime half's JS boot failure
  into an NSLog channel the pin greps). Rejected for this change: it is a
  real observability gap worth its own follow-up, but it would have turned
  the silent stall into a LOUD stall without fixing the boot — the pin
  would still be red. The staging fix is the actual root cause; the
  observability gap is named in the follow-up issue instead.
- Treat the mcp row as unmounted on hosts without the staged tree (a
  capability-negotiation posture). Rejected: def-bundle rows are the def
  seat's content by design (the seat-switch mechanism); a host that cannot
  load a def row should fail loud, not silently boot a thinner seat.

## Consequences

- The iOS staged tree now carries `system-plugins/dsh-mcp/{index,manifest,present}`
  files; the interactive release seat boots to `settings.probes.done` and the
  origin line in ~14s (page-open pin receipt under `hosts/ios/artifacts/page-open/`).
- The blind spot itself is broader than this exclude: the staging-check gate
  reads the EMBEDDER's lists (RESOURCES/TREES), not the BundleStager's
  exclude, so a graph-reached file can be embedded-but-never-staged while
  every gate stays green. That gap is filed as a follow-up issue; the
  exclude file's header documents the default-include rule that must be
  revisited whenever a def-bundle row joins.
