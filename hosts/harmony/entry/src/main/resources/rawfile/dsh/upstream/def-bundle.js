// dsh:logging-exempt (pure data — this module mounts nothing and logs nothing)
/**
 * upstream/def-bundle.js — THE DEF BUNDLE DECLARATION (R1 end-state).
 *
 * def's product content at boot is ONE manifest — this data — plus the
 * plugin packages themselves; nothing else. boot.js no longer names a single
 * def plugin: it loads THIS file and mounts rows. Swapping the def seat for
 * another product seat is editing this one file's data — no boot code
 * changes (that is the whole seat-switch mechanism).
 *
 * ROW GRAMMAR — the cordis.patch row semantics (one row = ONE mount; the
 * same import-spec + optional-config shape profiles/<name>/cordis.patch.json
 * speaks for the client plane):
 *
 *   { id, load, pick?, config?, plane? }
 *
 *   load    the row's import thunk. The specifier is spelled LITERALLY
 *           inside the arrow, and that is load-bearing: the hosts' staged
 *           closure is derived from literal import()/from specifiers
 *           (tools/check-staging-graph.mjs — a JSON manifest cannot carry
 *           graph edges), so a row whose specifier lived in a JSON string
 *           would fall out of every host's staging list and die on a fresh
 *           device install. This .js DATA module (not JSON) is that
 *           constraint, the same honesty as config-layer.js's
 *           cordis.patch.json note: the row semantics are format-independent;
 *           the carrying format is chosen so the derivation stays sound.
 *   pick    the named export to mount; absent = the namespace object IS the
 *           plugin (the D9 convention).
 *   config  plain data; a string value of the exact form "$name" resolves
 *           against the mount params (the boot cwd is the ONLY param today —
 *           resolveRowConfig below); any other "$name" fails loud (rule 5).
 *   plane   'ui' marks a UI-surface row (the app-shell face) — inventory
 *           metadata only; the mount itself is a plain tool row either way.
 *
 * SECTIONS:
 *   toolRows       the plain plugin rows, in boot mount order — 1:1 with the
 *                  head of the historical mountToolRows (set unchanged, only
 *                  the wiring moved here);
 *   fileRows       the file-tools family rows, mounted after the web plane —
 *                  exactly where mountFileTools sat;
 *   inventoryRows  the def rows of the spine plugin inventory (what
 *                  spineInventory answers for the settings 插件 screen);
 *   preset         the Agent 预设 deployment data: the default preset and
 *                  the staged vendor root the preset plane serves.
 *   The client plane needs NO section here: the web client choice is already
 *   data (profiles/<name>/cordis.patch.json `webClient` + the staged
 *   web.plugins delivery), and no boot-mounted UI row exists today — none is
 *   invented.
 *
 * STAYS GLUE IN boot.js — honest asymmetry over forced unification:
 *   - mountGatewayLlm: the gateway transport adapter into the vendored
 *     LlmRuntime (route facts, not product rows);
 *   - the mountSpine service layer: the upstream spine rows (session →
 *     agent-loop) in base-patch order — upstream names, service wiring;
 *   - mountWebPlane: the vendored web plane mounts BETWEEN the row sections
 *     (historical order) and injects the gateway transport into the keyless
 *     search provider mid-mount — transport wiring, not a spec+config row;
 *   - the EDITOR row: the vendored str_replace_editor mounts wrapped in the
 *     loop-z3 relative-path anchor (upstream/tool-path-anchor.js) — a plugin
 *     TRANSFORM over the module + the boot cwd, so it is a call, not a row;
 *   - mountCompositionHostPlane (upstream/boot-coverage-rows.js, the gated
 *     presetJoin path) borrows dsh-shell-js's exported `shellExecutor` to
 *     back the vendored shell seam — an export reuse, structurally entangled;
 *   - plugin-mount.js borrows validateWorkspaceManifest from
 *     dsh-plugin-manager-tools — shared validation, never duplicated.
 */

export const defBundle = {
  seat: 'def (the mobile product seat)',
  toolRows: [
    { id: 'tool-todo',
      load: () => import('@deepseek-ai/dsh-tool-todo'),
      config: { allowParallelInProgress: false } },
    { id: 'shell-js',
      load: () => import('system-plugins/dsh-shell-js/index.js') },
    { id: 'open-design',
      load: () => import('system-plugins/dsh-open-design/index.js') },
    { id: 'tool-plugin-manager',
      load: () => import('system-plugins/dsh-plugin-manager-tools/index.js') },
    { id: 'tool-plugin-create',
      load: () => import('system-plugins/dsh-create/index.js') },
    { id: 'office',
      load: () => import('system-plugins/dsh-office/index.js') },
    // The app-shell surface (owner decision 2026-10-18): the spine offers
    // appshell_render/update/catalog on every seat — one-prompt app morphing
    // is a product capability, not a scenario-mounted demo.
    { id: 'appshell',
      plane: 'ui',
      load: () => import('system-plugins/dsh-appshell/index.js') },
  ],
  fileRows: [
    { id: 'fs',
      pick: 'DshFsProvider',
      load: () => import('system-plugins/dsh-fs/cordis.js'),
      config: { cwd: '$cwd' } },
    { id: 'tool-fs',
      load: () => import('@deepseek-ai/dsh-tool-fs') },
  ],
  inventoryRows: [
    { kind: 'tool', entryId: 'shell-js',
      moduleName: 'system-plugins/dsh-shell-js', tool: 'jsshell' },
    { kind: 'tool', entryId: 'open-design',
      moduleName: 'system-plugins/dsh-open-design', tool: 'open_design_projects' },
    { kind: 'tool', entryId: 'tool-plugin-manager',
      moduleName: 'system-plugins/dsh-plugin-manager-tools', tool: 'plugin_manager' },
    { kind: 'tool', entryId: 'tool-plugin-create',
      moduleName: 'system-plugins/dsh-create', tool: 'plugin_create' },
    { kind: 'tool', entryId: 'appshell',
      moduleName: 'system-plugins/dsh-appshell', tool: 'appshell_render' },
    { kind: 'service', entryId: 'fs',
      moduleName: 'system-plugins/dsh-fs/cordis.js (the gateway-fs FileSystem provider)',
      service: 'fs' },
  ],
  preset: {
    default: 'mobile',
    vendorRoot: '/vendor/dsh/agent-presets@0.1.6-alpha.2',
  },
};

/** The row-config grammar: resolve every "$name" against the mount params
 * (deep — objects and arrays walk); every other value passes verbatim. An
 * unknown param fails loud naming it (rule 5) — a silent default here would
 * mount a row against a guessed cwd. */
export const resolveRowConfig = (config, params) => {
  if (Array.isArray(config)) {
    return config.map((value) => resolveRowConfig(value, params));
  }
  if (config !== null && typeof config === 'object') {
    return Object.fromEntries(Object.entries(config)
      .map(([key, value]) => [key, resolveRowConfig(value, params)]));
  }
  if (typeof config === 'string' && config.startsWith('$')) {
    const value = params[config.slice(1)];
    if (value === undefined) {
      throw new Error(`def-bundle: row config names unknown param "${config}"`);
    }
    return value;
  }
  return config;
};
