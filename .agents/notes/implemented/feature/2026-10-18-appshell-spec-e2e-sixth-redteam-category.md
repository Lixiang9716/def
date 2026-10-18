# appshell.spec e2e + the forged-surfaceId red-team gate

Status: implemented

- **Date**: 2026-10-18
- **Class**: feature
- **Related**: PR #574 (app-shell/0.9 contract + validator), PR #576 (web render surface, carrier-synthesized cards), plan `.zcode/plans/appshell-morph-plan.md` §M4/D-6, T-0250

## Problem

The appshell morphing plan's M2-M4 closeout owed five items. Two blocked honest
claims about the plugin itself:

1. **L2 `appshell.spec` e2e did not exist.** The only appshell e2e that ran
   anywhere was the browser morph leg, whose tool cards are synthesized
   carrier-side by `tools/dev-web-carrier/next-mode.mjs` (by design — no
   runtime there). The dsh-appshell plugin had NEVER executed inside a real
   spine: no leg proved generation→validation→tool-call over the real
   ToolRuntime, and nothing registered it anywhere in the product tree
   (`runtime/dsh/system-plugins/` — the loader's single source — did not
   carry it; #574 landed only the marketplace-side copy because nothing
   runtime-side consumed it yet).
2. **The sixth red-team category (forged-surfaceId update) had no surface to
   attack.** `appshell_update` accepted ANY surfaceId string — there was no
   registry of surfaces this process had actually rendered, so
   cross-surface-pollution refusals were unimplementable, let alone tested.

A latent contract bug rode along: the plugin's tools were authored against a
fake `ctx.tools.register` shape (plain `{name, parameters, execute}` returning
strings). The spine's vendored ToolRuntime rejects that at registration
("must declare output { schema, render, presentationMeta? }") — the plugin
could not have mounted on any real seat.

## Decision

- **The plugin now speaks the real vendored defineTool contract**
  (`@deepseek-ai/dsh-tools`): every tool declares `parameters` (the DSL:
  `description`, explicit `additionalProperties` on object params) and
  `output { schema, render }`; `execute` returns the schema-shaped value;
  refusals THROW (structured error outcome). `render` emits the JSON echo as
  the card text — byte-shape parity with the dev-carrier's synthesized tool
  results, so the web client's toolview parsing is unchanged.
- **appshell_render mints a surfaceId** (`appshell-<seq>`, module-scoped
  registry) into every success echo; rejected specs mint nothing.
  **appshell_update refuses an unknown surfaceId BEFORE any spec work**
  (`unknown-surface: <id>`, `log.warn` reason `unknown-surface`) —
  authorization is a distinct gate from validation.
- **Scenario `appshell.spec`** (`runtime/dsh/scenario/appshell-spec.js` +
  `test/e2e/scenarios/appshell-spec.json` + runner
  `runtime/dsh/ci/run-appshell-spec-e2e.sh`, wired into `build.sh test core`):
  boots the mobile profile against the loopback mock, mounts the plugin
  scenario-side (the office.js precedent — dynamic tool visibility, zero
  blast radius on other legs' boot manifests), runs ONE real agent turn whose
  scripted tool call (`DSH_MOCK_TOOL_NAME/ARGS`) dispatches through the real
  ToolRuntime, then drives the forged/live update pair and the catalog.
  **14/14 events one-to-one PASS**; artifacts under
  `runtime/dsh/artifacts/macos-cli-appshell-spec/`.
- **Mirror tax paid**: `runtime/dsh/system-plugins/dsh-appshell/` created
  byte-identical (the loader's single source; the CLI e2e needs it), android
  assets staged (whole-dir rule), one hand row in `ios-TREES.rows` +
  re-emit (the scenario's dynamic import makes the plugin graph-reachable,
  so the iOS embed must carry it). Harmony rawfile correctly does NOT carry
  it — its closure is import-graph-derived and no harmony leg mounts the
  plugin (a CLI-only leg is unreachable from harmony's boot by construction).
- Panel family grows `test/panel/appshell-surfaces.test.js` (12 tests over
  the tool layer, both MODEs; the family config gains aliases resolving
  `logger.js` and the vendored `@deepseek-ai/dsh-tools` for Node-side runs).

## Alternatives considered

- **Boot-mount the plugin beside office/shell-js** (spineInventory row) —
  rejected for this leg: it changes every spine boot, moves seam-inventory
  and other legs' tool-count assertions, and the product integration (which
  seat should serve appshell tools for the real web client) deserves its own
  decision. Scenario-side mount delivers the L2 chain honestly today.
- **Keep string returns / structured ok:false values for refusals** —
  rejected: the ToolRuntime contract wants errors thrown, and a forged-id
  update yielding a non-error value would leave "0 executable outcomes"
  unprovable. The thrown `unknown-surface:` error keeps the refusal visible
  to the model and the journal.
- **Registry keyed per-session/per-agent** — deferred: v0 module state is the
  registry's scope (one plugin module instance per runtime); nothing today
  creates cross-session surface collisions inside one process.

## Consequences

- M4's red-team ledger reaches six-of-six categories; the L2 CI leg is real.
- Remaining M2-M4 debts after this: L4 `appshell.morph` browser-leg wiring
  (file exists, never run green as a wired leg), M3 numbers (≤50ms local /
  ≤15s loop / incremental ≤40%), M4 cost ledger (morph/update P50/P95,
  e2e ≤20s), and the text-safety spot-check table.
- The dev-carrier's synthesized tool cards now also mint no surfaceId — the
  browser leg's update flow will need the carrier mock refreshed when the
  client consumes surfaceId (tracked with the L4 debt).
