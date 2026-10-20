# dsh-desktop plugin integration ledger

English | [简体中文](dsh-desktop-plugins.zh.md)

The accounting for "integrate ALL dsh-desktop plugins, except Electron" on
this host: what upstream ships, what this repo integrates, what is staged
next, and what is excluded with reasons. Upstream surface at pin
`0.1.6-alpha.2`: **293 published `@deepseek-ai/dsh-*` runtime/client
packages** (upstream `vendor/dsh-runtime/0.1.6-alpha.2/manifest.json`) plus
**5 desktop-product workspace packages** — 298 total.

"Integrating a plugin" means one of the repo's seven seams: a runtime
service plugin (`upstream/boot.js mountSpine`), a tool package on the
ToolRuntime, a vendor pin (`vendor/ensure-dsh.sh`) + shim rows
(`upstream/shims/`, the bare map), a claimed web API surface
(`upstream/web-write.js`), a staged client bundle
(`presentation/official-web/client-bundles/`), an in-house system plugin
(`system-plugins/`), or a host capability (`hosts/*/`, contract-gated).

## Integrated (this host; refreshed against post-#507 main, 2026-10-15)

| Tier | Packages | How |
| --- | --- | --- |
| Runtime spine | session, agent, system-prompt, tools, session-projection, settings, agent-loop, llm (+ sandbox, scope, brand, invariants, timeout, typert-protocol, util-crypto, util-values transitively) + the subagent control plane (dsh-subagent + session-query) | `mountSpine` over verbatim vendored packages |
| 预设 data source | agent-presets + cordis-plugin-loader (+ home-paths, atomic-write, js-yaml) | REAL upstream services; one Loader serves the presets inject AND the client composition (T-0035) |
| The file-tools row | fs-local, tool-fs, tool-str-replace-editor, attachment (+ npm diff) | in-memory workspace world over the vendored fs-local backend; read/write/edit + str_replace_editor on the ToolRuntime (T-0035) |
| Tool ports | tool-todo; the in-house tool rows — open-design, plugin-manager (`plugin_manager`), create (`plugin_create`), office (the OOXML authoring tools); `dsh-shell-js` holds the `shell` seat (2026-10-11), `dsh-shell-wasm` kept for the engine gates only | ToolRuntime; backed by the contract fs primitives / `wasmRun` (`dsh-shell-ish` retired with the iSH engine, 2026-10) |
| Skill + interactive rows | skills (dsh-skill + skill-filesystem `watch:false` + tool-skill); commands (dsh-commands + command-feedback); goals (dsh-goal + command-goal); file-references (dsh-file-reference-local) | gated boot rows (`options.skills/commands/goals/fileReferences`); wired on the three hosts' serve seats |
| Web plane | dsh-web + tool-web — `web_search` only, over the keyless DuckDuckGo provider | `mountWebPlane` over gateway `httpFetch`; `web_fetch` stays off until a fetch provider exists |
| MCP client (streamable-HTTP) | @modelcontextprotocol/client + core (+ jose, eventsource, pkce-challenge) | product-closure pins (`external/ensure-dsh.sh`, 2026-10-20) + `upstream/mcp-http-transport.js` over gateway `httpFetch`; CLI-proven only — not yet staged into the three platform bundles nor mounted as a tool row; stdio stays excluded |
| Session persistence | dsh-session-persistence-jsonl (verbatim; the desktop's koffi/flock native row answered by the flock shim + compiled-in zstd) | gated boot row, wired `sessionPersistence: true` on all three hosts (#463); force-kill restart proven per host |
| Official web tier | the 58-package application tier + 5 shell-static modules + the built SPA | staged client bundles composed in-runtime; served by the carrier |
| Mirrored API | api-session-controller, api-settings-controller behavior | the write surface (web-write.js) — the real controllers stay unmounted |
| Web API (T-0035 + #335) | pluginInventory/list, agentPresets/list\|read\|copy\|deletePreset\|select; pluginManager list legs AND write legs — installBundle\|removeBundle\|setBundleEnabled\|setPluginEnabled\|inspect over the real §4 pipeline + the receipts journal + the dsh.plugins/1 registry (cancelInstall answers `not-running`); the session deep-page legs (page\|search\|rename\|updateQueue\|fork\|selectModel\|cancel\|delete), subagents/*, workspaceFiles/* (+ the `fs/observed` feed), marketplace/install, the dynamicCordisRunner legs, credentials/describe, session/modelCatalog, `permissionPresets/catalog` (the honest empty table) | claimed endpoints; the workspace tier is the security boundary (bare registry names only) |

## Staged next (refreshed against post-#624 main, 2026-10-20)

The previous single-paragraph list aged in both directions: most of it
landed, and one member turned out to be a wall. The verdicts below were
re-judged item by item against file-level evidence.

### Landed since

- **shell/terminal stack** — `dsh-shell-js` holds the `shell` seat
  (2026-10-11); `ishRun` retired and the dsh-shell-ish tree removed
  outright 2026-10-14 (`upstream/boot.js`, the shell-seat comment;
  `system-plugins/dsh-shell-js/`). #505's `s///` refusal rewording is
  wording only — the dialect boundary did not move.
- **persistence/resume** — the vendored `dsh-session-persistence-jsonl`
  backend mounts behind `options.sessionPersistence`
  (`upstream/boot-session-persistence.js`; default root
  `<cwd>/dsh/sessions`, zstd), wired `sessionPersistence: true` into all
  three hosts' serve seats (#463: `hosts/ios/App/Source/SessionServe.swift`,
  `hosts/android/.../SessionServe.kt`,
  `hosts/harmony/.../OfficialServe.ets`), with force-kill restart legs
  proven per host (`hosts/*/artifacts/session-persist-restart/`,
  `runtime/dsh/web-live/session-persist-restart-core.js`, CLI leg
  `runtime/dsh/artifacts/macos-cli-session-persistence/`). Remaining
  follow-up: the page-session list-merge/re-attach seam (e2e-matrix known
  gaps, 2026-10-12).
- **skills (fs-backed)** — dsh-skill + skill-filesystem (`watch:false` —
  no fs-event seam) + tool-skill mount behind `options.skills`
  (`upstream/boot.js mountSkillPlane`); a staged skills dir on all three
  hosts; E2E `runtime/dsh/scenario/agent-flow.js`.
- **commands/goals (+ file-references)** — the interactive rows mount
  behind `options.commands/goals/fileReferences`
  (`upstream/boot-coverage-rows.js`); wired on the three hosts' serve
  seats; CLI proof `runtime/dsh/artifacts/macos-cli-seam-inventory/`.
- **web tools (the search half)** — dsh-web + tool-web mount with
  `search: true, fetch: false` over the keyless DuckDuckGo provider on
  `httpFetch` (`upstream/web-search-keyless.js mountWebPlane`; the tool-web
  preset row left the mobile-absent set 2026-10-03,
  `upstream/preset-mobile-rows.js`).
- **workspace-files + the Files sidebar** — the workspaceFiles read family
  (stat/list/read/readAll/readBytes/readRelated + the `fs/observed` change
  feed) answers from the REAL vendored `fs` service
  (`upstream/web-write-files.js`); the sidebar mutations + archive set
  ride the workspace registry (`upstream/web-write-workspace.js`); probe
  `runtime/dsh/scenario/api-coverage-probe.js`.
- **plugin-manager** — the `plugin_manager` tool over the workspace
  registry (`system-plugins/dsh-plugin-manager-tools`, #346) AND the write
  legs claimed (#335 A1): install/remove/enable/inspect ride the real §4
  install pipeline + the receipts journal
  (`upstream/web-write-plugin-manager.js`, claimed in
  `upstream/web-write.js`). The old "write legs deliberately unclaimed"
  line is retired.
- **session-quality, first slices** — compaction (token-meter +
  compaction-basic behind `options.compaction`,
  `upstream/boot-compaction.js`; CLI evidence
  `runtime/dsh/artifacts/macos-cli-upstream-compaction/`); the persona
  prefix (SystemPrompt config, `upstream/boot.js`); manual titles
  (`session/rename`, mirroring dsh-session-title semantics,
  `upstream/web-write-session.js` — no automatic generation).
- **approval/questions, the service half** — dsh-user-questions vendored;
  UserQuestionService mounts via the composition host plane under
  `presetJoin` (`upstream/boot-coverage-rows.js
  mountCompositionHostPlane`); the Harmony serve seat joins the preset
  (`hosts/harmony/.../OfficialServe.ets`). Plugin approvals ride the
  gateway `presentApproval` primitive (`system-plugins/dsh-ui`).
- **MCP client over streamable-HTTP** — the vendored
  @modelcontextprotocol/client@2.0.0 (+ core, jose, eventsource,
  pkce-challenge) left the test table for the product closure
  (`external/ensure-dsh.sh`, the MCP CLIENT rows, 2026-10-20); the
  streamable-HTTP transport rides gateway `httpFetch` through
  `upstream/mcp-http-transport.js` (the vendored
  `StreamableHTTPClientTransport` composed over `gatewayFetch`, the
  `upstream/fetch-gateway-bridge.js` export); CLI proof
  `runtime/dsh/artifacts/macos-cli-mcp-streamable-http/` (leg
  `runtime/dsh/ci/run-mcp-streamable-http-e2e.sh`, `build.sh test core`).
  Remaining boundary: host closure staging (iOS TREES / harmony CLOSURE /
  android pin rows + `build/build.sh sync`) and the MCP tool-row mount are
  the next step — today the client is a product-closure/CLI face only; the
  stdio transport stays in the physically-impossible set (below).

### Still staged

- **fs over gateway scopes + tool-fs-search** — the file-tools row still
  runs the in-memory workspace VFS (a real-disk write-through mirror gives
  durability, but the VFS stays the world of record,
  `upstream/shims/fs-workspace.js`); tool-fs-search's engine is the
  @vscode/ripgrep packaged binary — it waits for the subprocess/fs-service
  seam (`external/ensure-dsh.sh`, the tool-fs-search skip;
  `upstream/README.md`, the mapping table's ripgrep row).
- **web fetch + keyed search** — `web_fetch` is disabled (`fetch: false` —
  no fetch provider over `httpFetch` yet); `web-fetch-http` is unvendored;
  a keyed provider beside the keyless one is the recorded gap
  (`upstream/web-search-keyless.js`, the honest-limits header).
- **questions on the remaining seats** — tool-ask-user is probe-proven
  (`runtime/dsh/scenario/interactive-circle-probe.js`) but reaches a seat
  only through the preset join (Harmony); the iOS/Android serve seats do
  not pass `presetJoin`; `dsh-user-approval` stays unvendored (subagent's
  ctx.get()-soft peer, `upstream/README.md`).
- **compaction host wiring** — the boot row is CLI-proven, but no serve
  seat passes `options.compaction` yet; `/compact` UI integration is the
  registered known gap (e2e-matrix, 2026-10-12).
- **titles (auto) / plan-mode / permission-presets** — dsh-plan-mode is
  vendored and load-verified only (the interactive-circle probe mounts it
  nowhere); title auto-generation is not carried (`session/rename` is
  manual only); `permissionPresets/catalog` answers the honest empty
  table (`upstream/web-write.js`) and dsh-permission-presets is
  unvendored.
- **tool-cordis** — the two runtime-side legs answer (#335 B3), but the
  tool's wire needs the `cordisInspect` HOST service that only the
  vendored cordis-host-runner provides (`upstream/preset-mobile-rows.js`).

Each still-staged row is a vendor pin + shim rows + a mount — the
file-tools row (T-0035) is the template.

### Newly understood as excluded

- **the workflow family** — `workflow-ptc` (its confined guest realm IS
  `node:vm` — the subprocess-class seam, `upstream/README.md` shim table),
  `tool-workflow` (its only engine rides the walled PTC host runner; the
  standing mount parks the row — measured 2026-10-08,
  `upstream/preset-mobile-rows.js`), and `tool-presentation` (rides the
  same runner). The old "commands/goals/workflows" item's third member
  cannot land on this pin; the commands and goals halves landed (above).

## Excluded, with reasons

- **Electron tier (the owner's exclusion):** `dsh-plugin-desktop`,
  `dsh-plugin-desktop-beta`, `dsh-desktop-next` (its dep list is the
  integration checklist, not code to port), `dsh-community-market`,
  `dsh-community-fabric` (docs-only).
- **Physically impossible on this host (no contract primitive exists and
  none is implied):** browser/computer-use (drive a desktop GUI); ssh,
  subprocess-ssh, http-proxy, lsp-stdio, mcp stdio (raw TCP sockets —
  gateway has only `httpFetch`); win32/pwsh rows; native-addon rows
  (`session-query-sqlite`, `storage-sqlite` — koffi/sqlite;
  `session-persistence-jsonl` left this set when the vendored verbatim
  backend integrated — see Integrated); external-CLI orchestrators
  (hooks/subagent-claude-code/-codex); worker-thread rows (single
  serial runtime, decision D2); `office-to-pdf` (LibreOffice binary);
  desktop entry machinery (`host-webserver`, `cmdline`, `headless`,
  `app-boot` — already replaced by this repo's carrier + boot).
- **Test/build-time only:** testkits, loaders, replay/mock servers,
  hmr/generator tooling — vendored on demand when a product package
  needs them, never mounted.

## Evidence

- `runtime/dsh/artifacts/macos-cli-settings-surfaces/` — the 预设 roster
  (cordis/minimal/ptc/standard, deployment default marked) and the 插件
  inventory (16 spine rows + 58 client bundles + 4 compositions) answered
  on the CLI, 12/12 expected↔logged.
- `runtime/dsh/artifacts/macos-cli-tool-fs/` — create/read/write/edit/
  view/str_replace through the REAL tool dispatch, boundary refusals
  included.
- `runtime/dsh/artifacts/macos-cli-upstream-compaction/`,
  `macos-cli-session-persistence/`, `macos-cli-seam-inventory/` — the
  gated rows' CLI verdicts (compaction 39/39; create→resume across two
  processes; the presetJoin interactive seat).
- `hosts/ios/artifacts/b4-write-live/` — the same surfaces on device,
  asserted by the b4 drive (logs, not screenshots; screenshots in
  `screens/` are human evidence only).
- `hosts/*/artifacts/session-persist-restart/` — the force-kill restart
  family on all three hosts.
