// dsh:logging-exempt (boot module; logging happens through the mounted logger)
/**
 * upstream/boot.js — the MOBILE PROFILE BOOT (decision D9).
 *
 * Same entry shape as the desktop: apps/cli profile-boot resolves the profile,
 * stacks its patch layers (dsh.profile.bundles order → profile cordis.patch.yml
 * → overlays) over an EMPTY root, and drives the cordis Loader until the tree
 * settles. On mobile the platform differences live BELOW the upstream
 * contracts, never above them:
 *
 *   - The profile tree is the PINNED VENDOR CLOSURE (vendor/dsh@0.1.6-alpha.2
 *     + vendor/npm), mapped by the dsh host loader; there is no disk Loader
 *     because the gateway fs scopes are not the module filesystem. The layer
 *     composition below mirrors the dsh-base cordis.patch.yml rows the mobile
 *     profile mounts (llm → session → agent → tools → system-prompt →
 *     session-projection → settings → agent-loop), in activation order.
 *   - $DSH_HOME / process.cwd() collapse into the host-granted PROFILE
 *     CONTAINER (caller-provided paths, pinned for the shims).
 *   - `llm` is the VENDORED dsh-llm LlmRuntime (adapter registry), with the gateway
 *     transport adapter (upstream/llm-transport.js) registered for the caller's
 *     provider route — the desktop's service over the mobile seam (gateway httpFetch).
 *
 * Exports bootUpstream(options) → { ctx, services, sessionId, agentId }.
 */
import './web-shims.js';
import process from 'node:process';
import { Context } from '@deepseek-ai/cordis';
import { SessionStore } from '@deepseek-ai/dsh-session';
import { AgentRegistry } from '@deepseek-ai/dsh-agent';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { SettingsMemory } from 'upstream/settings-memory.js';
import { mountSubagentRows } from 'upstream/boot-subagent-rows.js';
import { providerSettingsNs } from 'upstream/web-write-settings.js';
import { mountWebPlane } from 'upstream/web-search-keyless.js';
// The llm row split at the file-size gate (2026-10-11, the llm-pi-ai leg):
// the gateway mount (llm-gateway-mount.js) and the GATED multi-protocol
// mount (llm-piai-mount.js) both register into the ONE vendored LlmRuntime.
import { mountGatewayLlm } from 'upstream/llm-gateway-mount.js';
import { mountPiAiProviders } from 'upstream/llm-piai-mount.js';
import { AgentLoop } from '@deepseek-ai/dsh-agent-loop';
import { mountBootRows } from 'plugin-mount.js';
// The GOAL/COMMAND/FILE-REFERENCE/CREATION rows (split at the code-size gate, 2026-10-03).
import { mountCompositionHostPlane, mountCoverageRows } from 'upstream/boot-coverage-rows.js';
import { maybeMountSessionPersistence } from 'upstream/boot-session-persistence.js'; // the SESSION-PERSISTENCE row (gated, default off)
export { joinDefaultPreset } from 'upstream/boot-coverage-rows.js';
// The COMPACTION row (gated, 2026-10-11): the host-plane token meter plus the
// vendored compaction-basic engine — only when options.compaction is set.
import { mountCompactionPlane } from 'upstream/boot-compaction.js';
// The spine demand-FACTS (the layer list + the fail-loud demand checks), split
// out at the file-size gate (2026-10-11) with the compaction row's landing.
import { MOBILE_LAYERS, MOUNTED_SERVICES, demandServices, demandPresetServices } from 'upstream/boot-demand.js';
// The FIRST ported tool package (D9): its namespace object IS the plugin.
import * as ToolTodo from '@deepseek-ai/dsh-tool-todo';
// The per-tool-run deadline (#323 ring 1): a wall-clock budget around
// every dispatch — a tool that never settles fails in-band.
import * as ToolDeadline from 'upstream/tool-deadline.js';
// The turn-level watchdog (issue #323, ring 2): silence on a running agent
// beyond the budget fails the turn in-band (agent cancel, watchdog cause) —
// covers stalls outside tool dispatch (LLM stream, loop awaits).
import * as TurnWatchdog from 'upstream/turn-watchdog.js';
// The upstream request-retry policy answer (loop-u): a transient LLM stream
// death retries in-turn under the provider's policy. Exports {Config, apply,
// inject, name} and no default — the namespace object IS the plugin.
import * as LlmRetry from '@deepseek-ai/dsh-llm-retry';
import * as RetryTelemetry from 'upstream/retry-telemetry.js';
// The turn-failure supervisor (loop-u): what a retry budget cannot cover —
// an errored turn gets one honest system message and its queued followups
// continue (the desktop controller's api-session/error relay + the followup
// semantics the mobile compose lacked).
import * as TurnRecovery from 'upstream/turn-recovery.js';
// The outboard WebAssembly tool (contract v1.2.0). It is a staged system
// plugin, not a vendored upstream package: the closure has no WebAssembly tool
// to port, and an in-house implementation package is where a host-specific
// capability belongs (D6) — `system-plugins/dsh-fs` beside it is the same
// shape. Mounted after `tools`, which its `inject` waits for.
import * as ShellWasm from 'system-plugins/dsh-shell-wasm/index.js';
// The in-process Linux userland tool (contract v1.3.0): the same shell seam as
// the WebAssembly executor beside it, backed by a real Alpine userland the host
// emulates inside its own process. A host that staged no guest root answers
// nothing here — the plugin declines to register a tool it cannot honour.
import * as ShellIsh from 'system-plugins/dsh-shell-ish/index.js';
// The Open Design client (the design daemon's REST surface over gateway
// httpFetch): projects, BYOK generate, artifact save/lint. A host with no
// configured daemon mounts nothing — the same decline shape as shell-ish.
import * as OpenDesign from 'system-plugins/dsh-open-design/index.js';
// The PLUGIN-MANAGER row (#346): the plugin_manager tool over the
// workspace dsh.plugins/1 registry — outboard implementation (D6). The
// composition's tool-plugin-manager row names the vendored desktop tool
// whose host face this closure lacks; this row makes its Enabled TRUE.
// Mounted after `tools` (inject waits for it).
import * as PluginManagerTools from 'system-plugins/dsh-plugin-manager-tools/index.js';
import * as DshCreate from 'system-plugins/dsh-create/index.js';
// The FILE-TOOLS row: upstream's fs tool family over the vendored
// fs-local backend in ONE in-memory workspace world. The npm bridge that
// registers bare `diff` (tool-fs' structuredPatch dep) is a STATIC
// import so its body runs at graph load; the tool packages themselves resolve
// DYNAMICALLY inside mountSpine — quickjs links a static import graph before
// any module body runs, so a static tool-fs import would demand `diff` before
// the bridge exists (measured 2026-09-22).
import 'upstream/shims/npm-bridges.js';
import { mountWorkspace } from 'upstream/shims/fs.js';
// The Agent 预设 panel's data source (contract parity with the desktop shell):
// the REAL upstream services, verbatim — the cordis Loader service (which the
// presets service `inject`s) and the agent-presets roster over the four shipped
// presets (cordis / minimal / ptc / standard). The presets tree is seed data
// under the staged VFS root (the fs shims serve it; a driver delivers the bytes
// over the bus seam). The Loader ALSO serves the web-boot client composition's
// `entries()`/`internal` face — one loader service, no second claim (the
// conflict that kept this mount off is resolved in upstream/web-boot.js).
import { Group, Loader } from '@deepseek-ai/cordis-plugin-loader';
import { AgentPresets } from '@deepseek-ai/dsh-agent-presets';
// The cordis logger bridge (split from this file at the file-size gate,
// 2026-10-01 — unchanged behavior; see wire-logger.js for the strip policy).
import { wireLogger } from 'upstream/wire-logger.js';

/** Pin the profile container (the $DSH_HOME / cwd / tmpdir equivalents). */
const pinProfileContainer = (container) => {
  globalThis.__dshProfileCwd = container.cwd;
  globalThis.__dshProfileScopeRoot = container.scopeRoot;
  globalThis.__dshProfileTmpdir = container.tmpdir;
  globalThis.__dshProfileHome = container.home;
  globalThis.__dshProfilePlatform = container.platform ?? 'mobile';
  globalThis.__dshProfileLaunch = container.env ?? {};
  globalThis.__dshProfileArgv = container.argv ?? [];
  if (typeof globalThis.process === 'undefined') globalThis.process = process;
};

/** The staged VFS root of the vendored agent-presets package (the same path
 * space the fs shims' VFS serves and the drivers seed): the presets tree is
 * `<root>/presets/**` and the package-health resolution walks `<root>/
 * node_modules/<pkg>/package.json` from here. A `file:` URL — the shape the
 * presets service documents for `ctx.baseUrl` (a composition's package names
 * resolve against it). */
export const AGENT_PRESETS_VENDOR_ROOT = '/vendor/dsh/agent-presets@0.1.6-alpha.2';
export const AGENT_PRESETS_BASE_URL = `file://${AGENT_PRESETS_VENDOR_ROOT}/`;
/** The deployment default preset (the shipped roster: cordis/minimal/ptc/
 * standard; the package README's own deployment example pins `standard`). */
export const AGENT_PRESETS_DEFAULT = 'mobile';

/** The REAL spine mounts, as plugin-inventory rows (the settings 插件 list's
 * global plane). Every row is answered from live context facts, never from
 * the declaration alone: a spine service is enabled when its service is
 * actually mounted on the context, and a tool plugin is enabled when its
 * tool is actually registered in the tool table (the ish tool declines to
 * register when the host stages no Linux guest root — that host sees the
 * row disabled, exactly what the tool layer does). `fiberPhase: 'active'`
 * names the mounted truth (demandServices proved the spine); a declined
 * plugin carries `null` — it has no fiber. */
export const spineInventory = (ctx) => {
  // The tool layer's GLOBAL visibility view — the same resolver the model-
  // facing catalog reads (scoped registrations shadow it; no scope exists at
  // the root). Reading `view().visible` is the registry's own answer to
  // "which tools does this runtime actually serve".
  const visibleTools = ctx.tools?.view?.(undefined)?.visible;
  const service = (entryId, moduleName, serviceName) => ({
    entryId,
    moduleName,
    enabled: ctx.get(serviceName) !== undefined,
    fiberPhase: ctx.get(serviceName) !== undefined ? 'active' : null,
  });
  const tool = (entryId, moduleName, toolName) => {
    const registered = visibleTools !== undefined && visibleTools.has(toolName);
    return { entryId, moduleName, enabled: registered, fiberPhase: registered ? 'active' : null };
  };
  return [
    service('session', '@deepseek-ai/dsh-session', 'sessions'),
    service('agent', '@deepseek-ai/dsh-agent', 'agents'),
    service('system-prompt', '@deepseek-ai/dsh-system-prompt', 'systemPrompt'),
    service('tools', '@deepseek-ai/dsh-tools', 'tools'),
    service('session-projection', '@deepseek-ai/dsh-session-projection', 'sessionProjections'),
    service('settings', 'upstream/settings-memory.js (in-memory SettingsProvider)', 'settings'),
    service('agent-loop', '@deepseek-ai/dsh-agent-loop', 'agentLoop'),
    service('llm', '@deepseek-ai/dsh-llm', 'llm'),
    tool('tool-todo', '@deepseek-ai/dsh-tool-todo', 'todo_write'),
    tool('shell-wasm', 'system-plugins/dsh-shell-wasm', 'shell'),
    tool('shell-ish', 'system-plugins/dsh-shell-ish', 'ish'),
    tool('open-design', 'system-plugins/dsh-open-design', 'open_design_projects'),
    tool('tool-plugin-manager', 'system-plugins/dsh-plugin-manager-tools', 'plugin_manager'),
    // The create-approve-hotmount loop's product face: chat-authored plugin
    // → native Approve → registry install → LIVE native card (PR-2/3).
    tool('tool-plugin-create', 'system-plugins/dsh-create', 'plugin_create'),
    service('fs', '@deepseek-ai/dsh-fs-local', 'fs'),
    tool('tool-fs', '@deepseek-ai/dsh-tool-fs', 'read'),
    tool('tool-str-replace-editor', '@deepseek-ai/dsh-tool-str-replace-editor', 'str_replace_editor'),
    service('web', '@deepseek-ai/dsh-web', 'web'),
    tool('tool-web', '@deepseek-ai/dsh-tool-web', 'web_search'),
    service('loader', '@deepseek-ai/cordis-plugin-loader', 'loader'),
    service('agent-presets', '@deepseek-ai/dsh-agent-presets', 'agentPresets'),
  ];
};

/** The FILE-TOOLS row's mounts (see the import note at the top of this
 * file): the workspace world, the vendored fs-local backend as the `fs`
 * service, the file tools into the REAL ToolRuntime (editor via the loop-z3 path anchor). */
const mountFileTools = async (ctx, cwd) => {
  mountWorkspace(cwd);
  const [{ LocalFileSystem }, ToolFs, StrReplaceEditor] = await Promise.all([
    import('@deepseek-ai/dsh-fs-local'),
    import('@deepseek-ai/dsh-tool-fs'),
    import('@deepseek-ai/dsh-tool-str-replace-editor'),
  ]);
  await ctx.plugin(LocalFileSystem, { cwd });
  await ctx.plugin(ToolFs, {});
  await ctx.plugin((await import('upstream/tool-path-anchor.js')).anchoredEditorPlugin(StrReplaceEditor, cwd), {});
};

/** The SKILL row (2026-09-23, the agent-flow E2E): the upstream skill family
 * over the vendored packages — dsh-skill (the `ctx.skills` provider registry),
 * dsh-skill-filesystem (project/custom/user discovery; on mobile mounted with
 * `watch:false` — the runtime has no fs-event/timer seam for chokidar, which
 * the npm-bridges seam answers with a loud linkage shim), and dsh-tool-skill
 * (the model-facing `skill` tool + the durable session catalog). Mounted only
 * when the caller configures `options.skills` (customSkillDirs), so the
 * existing spine legs boot byte-identically. Dynamic imports here — same
 * reason as the file-tools row: the bridges must register `yaml`/`chokidar`
 * before these specifiers resolve (ESM links static graphs before any module
 * body runs). `dshHome`/`agentsHome` are pinned to the profile container so
 * discovery is deterministic; `includeDefaultRoots` stays on and simply finds
 * nothing (the container has no project `.dsh/skills`/`.agents/skills` and
 * no `$DSH_HOME/skills` unless staged). */
const mountSkillPlane = async (ctx, skills) => {
  const [Skills, SkillFs, ToolSkill] = await Promise.all([
    import('@deepseek-ai/dsh-skill'),
    import('@deepseek-ai/dsh-skill-filesystem'),
    import('@deepseek-ai/dsh-tool-skill'),
  ]);
  await ctx.plugin(Skills.SkillRegistry, {});
  await ctx.plugin(SkillFs, {
    dshHome: skills.dshHome,
    agentsHome: skills.agentsHome,
    customSkillDirs: skills.customSkillDirs ?? [],
    watch: false,
  });
  await ctx.plugin(ToolSkill, {});
};

/** The GOAL/COMMAND/FILE-REFERENCE/CREATION rows: split at the code-size
 * gate (2026-10-03) — carried verbatim in boot-coverage-rows.js. */

/** Mount the dsh-base bundle's spine rows over the vendored packages, in
 * base-patch order (activation is service-availability driven upstream; here
 * the mount order mirrors the patch rows). */

/** The Agent 预设 data-source mounts — split from mountSpine at the
 * file-size gate; the block's comment carries the WHY of each choice
 * (one Loader, includeUserRoot: false, mounted after agent-loop). */
const mountPresetPlane = async (ctx) => {
  // Agent 预设 data source, contract parity with the desktop shell: the REAL
  // cordis Loader service and the REAL vendored AgentPresets over the staged
  // presets VFS. Composition order is upstream's own demand: the presets
  // service `inject`s `loader` + `sessionProjections` (both mounted above) and
  // reads `ctx.baseUrl` — set below BEFORE either mount. One Loader serves
  // both the presets inject and the web-boot client composition's resolution
  // face (upstream/web-boot.js decorates `entries()`/`internal` on THIS
  // service; it never claims the property a second time). Mounted LAST: this
  // host never joins presets at agent-creation (the staged gap upstream's
  // `agent/created` warning exists for), and mounting after agent-loop keeps
  // the boot agent outside that listener. `includeUserRoot: false` is the
  // honest mobile root set: authoring writes refuse at the fs shim (the
  // staged view is read-only), so there is no user preset root to scan.
  ctx.baseUrl = AGENT_PRESETS_BASE_URL;
  await ctx.plugin(Loader, { baseUrl: AGENT_PRESETS_BASE_URL });
  if (ctx.get('loader') === undefined) {
    throw new Error('boot: the cordis Loader failed to mount under "loader"');
  }
  // The `cordis:group` builtin: the preset documents' grouped rows
  // (planning / compaction / delegation) import it by name — the deployment
  // registers the loader's own Group plugin. Without it every group row
  // fails the standing mount ("invalid plugin ... received undefined").
  ctx.get('loader').builtins.group = Group;
  await ctx.plugin(AgentPresets, {
    default: AGENT_PRESETS_DEFAULT,
    includeUserRoot: false,
  });
};

/** Ring 2's recovery face (loop-u + loop-x2): the request-level retry answer
 * first (transient stream deaths retry in-turn under the provider's policy),
 * then its release-visible retry telemetry, then the turn-failure supervisor
 * (an errored turn closes honestly; queued followups continue). */
const mountRecoveryRings = async (ctx) => {
  await ctx.plugin(LlmRetry, {});
  await ctx.plugin(RetryTelemetry, {});
  await ctx.plugin(TurnRecovery, {});
};


/** Ported tool packages (D9): after `tools`; `allowParallelInProgress: false`
 * is the mobile one-agent shape. The OFFICE and WEB rows are dynamic — bare
 * `fflate`/turndown need the bridges body registered first. */
const mountToolRows = async (ctx, cwd) => {
    await ctx.plugin(ToolTodo, { allowParallelInProgress: false });
    await ctx.plugin(ShellWasm);
    await ctx.plugin(ShellIsh);
    await ctx.plugin(OpenDesign);
    await ctx.plugin(PluginManagerTools);
    await ctx.plugin(DshCreate); // create-approve-hotmount (PR-2/3)
    await ctx.plugin(await import('system-plugins/dsh-office/index.js'));
    await mountWebPlane(ctx);
  await mountFileTools(ctx, cwd);
};

const mountSpine = async (ctx, identity) => {
  await ctx.plugin(SessionStore);
  await ctx.plugin(AgentRegistry);
  await ctx.plugin(SystemPrompt, { personaPrefix: identity.personaPrefix ?? '' });
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(ToolDeadline, {}); // Ring 1 (inject waits for `tools`).
  await ctx.plugin(SessionProjectionRegistry);
  await ctx.plugin(SettingsMemory);
  await mountSubagentRows(ctx);
  await mountToolRows(ctx, identity.cwd);
  // The SKILL row (agent-flow E2E): after the file tools (its
  // discovery prefers the `fs` service) and before the agent loop (the
  // tool-skill catalog registers its `agent/pre-step` listeners on the
  // context, so every later step sees them). Only when configured.
  if (identity.skills) await mountSkillPlane(ctx, identity.skills);
  // The COMMAND/GOAL/FILE-REFERENCE/CREATION rows (gated) in historical
  // order; presetJoin boots the composition host plane first (same module).
  if (identity.presetJoin) await mountCompositionHostPlane(ctx, identity);
  await mountCoverageRows(ctx, identity);
  // Both gated rows ride before agent-loop: persistence resumes a stored
  // session at config start; compaction arms pressure from the first turn.
  await maybeMountSessionPersistence(ctx, identity);
  if (identity.compaction) await mountCompactionPlane(ctx, identity.compaction);
  // dsh-base row `agent-loop` with ONE configured agent (config.agents create
  // path — no persistence backend is mounted, matching the base default).
  await ctx.plugin(AgentLoop, {
    maxParallelToolCalls: 10,
    agents: [{
      id: identity.agentId,
      sessionId: identity.sessionId,
      provider: identity.provider,
      model: identity.model,
      reasoningEffort: identity.reasoningEffort,
      cwd: identity.cwd,
    }],
  });
  // Ring 2 sits after the loop it watches (its injects: agentLoop, agents).
  await ctx.plugin(TurnWatchdog, {});
  await mountRecoveryRings(ctx);
  await mountPresetPlane(ctx);
};
/**
 * @param options.scenario - E2E scenario id the caller logs under (used for
 *   the boot evidence events the caller emits).
 * @param options.container - profile container {cwd, tmpdir, home, env?, argv?}.
 * @param options.agentId - configured agent id (created by AgentLoop at mount).
 * @param options.sessionId - exact session identity for the configured agent.
 * @param options.cwd - session cwd (mobile-honest: a gateway fs scope label).
 * @param options.llm - the llm route {baseURL, apiKey, provider, model,
 *   onWire?, onSse?, readIdleTimeoutMs? (the loop-u2 attempt-level stall guard; absent = the 120s default),
 *   contextWindow? (the compaction capacity, consumed through resolveModelInfo;
 *   BYOK always carries one, staged only when runtime.config stages llmContextWindow),
 *   piaiProviders? (the vendored @deepseek-ai/dsh-llm-pi-ai plugin's providers
 *   dict — the GATED multi-protocol row: an absent field mounts nothing, a
 *   present one registers one LlmAdapter for every named route besides the
 *   gateway route above)};
 *   required, no transport-free fallback.
 * @param options.systemPrompt - optional override seam: {personaPrefix} —
 *   the vendored SystemPrompt's own config (the prompt's persona section),
 *   mounted verbatim; default '' (the historical boot shape).
 * @param options.commands, options.goals - optional COMMAND/GOAL-row flags
 * (the interactive seat's rows; absent = the historical spine).
 * @param options.fileReferences - optional FILE-REFERENCE-row flag (true mounts
 * the vendored dsh-file-reference-local service under `fileReferences`, the
 * composer's @-mention lexicon). Absent = the historical spine.
 * @param options.creation - optional CREATION-row flag (the present tool).
 * @param options.compaction - optional COMPACTION-row configuration: {config?}
 *   mounts the host-plane token meter (dsh-token-meter) plus the vendored
 *   compaction-basic engine (auto step-pressure + overflow recovery) under
 *   `compaction`; config rides BasicCompactionConfig (thresholdRatio,
 *   retainTokens, ...). Absent = the historical spine (upstream/boot-compaction.js).
 * @param options.skills - optional SKILL-row configuration: {dshHome,
 *   agentsHome, customSkillDirs?} — the vendored skill family. Absent = the
 *   historical spine (the parity/session manifests pin that shape).
 * @param options.presetJoin - optional COMPOSITION flag (true boots the
 *   composition host plane the default preset's rows inject). Absent = the
 *   historical spine.
 * @param options.onEvent - observability hook: (event, fields) => void; boot
 *   emits `upstream.profile`, `llm/runtime`, `upstream.services`.
 */

/** The post-spine leg (split from bootUpstream at the function-size gate):
 * fail loud on missing mounts, then mount the modelSelection plane (the
 * projection unit + the selection holder, upstream/model-selection-holder.js). */
const mountModelSelectionPlane = async (ctx, agentRoute, sessionId) => {
  await demandServices(ctx);
  demandPresetServices(ctx);
  const Holder = await import('upstream/model-selection-holder.js');
  await Holder.mountModelSelectionHolder(ctx, agentRoute, sessionId);
};

/** Boot the mobile profile: empty root, the dsh-base-equivalent spine over
 * the pinned vendored packages, the vendored LlmRuntime under `llm`. */

/** The mountSpine identity row: the boot options folded into the one spine
 * fact (extracted at the function-size gate — the shape, not the sequence). */
const spineIdentity = (options, agentRoute) => ({
  agentId: options.agentId,
  sessionId: options.sessionId,
  cwd: options.cwd,
  ...agentRoute,
  personaPrefix: options.systemPrompt?.personaPrefix,
  skills: options.skills,
  commands: options.commands,
  goals: options.goals,
  fileReferences: options.fileReferences,
  creation: options.creation,
  // presetJoin boots the composition host plane; the join itself is the
  // seat's runtime half, after the presets seed has landed.
  presetJoin: options.presetJoin,
});

export async function bootUpstream(options) {
  const { container, onEvent } = options;
  const llm = options.llm ?? {};
  if (!llm.baseURL || !llm.apiKey || !llm.provider || !llm.model) throw new Error('boot: options.llm {baseURL, apiKey, provider, model} is required — the profile boots the vendored LlmRuntime over the gateway transport');
  // The loop agent's route as ONE fact (mountSpine's row + the holder's fallback read it).
  const agentRoute = { provider: llm.provider, model: llm.model, reasoningEffort: 'off' };
  pinProfileContainer(container);

  const ctx = new Context();
  wireLogger(ctx);
  // Lifecycle listeners first, so boot-time creation events are observable.
  for (const [type, fn] of Object.entries(options.listeners ?? {})) ctx.on(type, fn);

  await mountGatewayLlm(ctx, llm, onEvent);

  onEvent('upstream/profile', {
    profile: 'mobile',
    root: 'empty (patch layers compose over it)',
    upstream: '0.1.6-alpha.2 (vendored verbatim, sha256-pinned)',
    layers: MOBILE_LAYERS.map(([id]) => id),
  });

  // The mountSpine identity row: persist's spineIdentity fold + compact's
  // gated compaction row + piai's gated multi-protocol adapter row (absent
  // piaiProviders = nothing mounts, the empty boot-list precedent).
  const identity = spineIdentity(options, agentRoute);
  identity.compaction = options.compaction;
  identity.sessionPersistence = options.sessionPersistence; // the resume gate; absent = off
  await mountSpine(ctx, identity);
  await mountModelSelectionPlane(ctx, agentRoute, options.sessionId);
  if (llm.piaiProviders !== undefined) await mountPiAiProviders(ctx, llm.piaiProviders, onEvent);

  onEvent('upstream/services', {
    kernel: '@deepseek-ai/cordis@4.0.2',
    services: MOUNTED_SERVICES,
    llm: `vendored LlmRuntime + gateway adapter (provider "${llm.provider}")`,
  });

  // The cordis.yml-insert equivalent: ENABLED workspace rows mount at boot.
  await mountBootRows(ctx, onEvent);

  return { ctx, sessionId: options.sessionId, agentId: options.agentId };
}
