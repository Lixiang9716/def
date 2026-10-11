// dsh:logging-exempt (boot rows split from boot.js at the file-size gate —
// same posture as boot.js itself: logging happens through the mounted logger)
/**
 * upstream/boot-demand.js — the spine demand-FACTS (2026-10-11), split from
 * boot.js at the file-size gate (the boot file sat at both caps; the
 * compaction row's additions pushed it past). Pure data + pure predicates:
 * the layer list the boot reports, the service keys it demands, and the two
 * fail-loud demand checks. Behavior carried verbatim.
 */

/** The dsh-base rows the mobile profile mounts, in base-patch order. */
export const MOBILE_LAYERS = [
  ['session', '@deepseek-ai/dsh-session'],
  ['agent', '@deepseek-ai/dsh-agent'],
  ['system-prompt', '@deepseek-ai/dsh-system-prompt'],
  ['tools', '@deepseek-ai/dsh-tools'],
  ['session-projection', '@deepseek-ai/dsh-session-projection'],
  ['settings', 'in-memory SettingsProvider (no settings-file on mobile)'],
  ['agent-loop', '@deepseek-ai/dsh-agent-loop'],
];

/** The service keys the mobile profile must provide after the spine mounts. */
export const MOUNTED_SERVICES = ['sessions', 'agents', 'systemPrompt', 'tools', 'sessionProjections', 'settings', 'agentLoop', 'llm'];

/** Fail loud naming any spine service that failed to mount (rule 5). */
export const demandServices = async (ctx) => {
  const missing = MOUNTED_SERVICES.filter((name) => ctx.get(name) === undefined);
  if (missing.length > 0) {
    throw new Error(`boot: services failed to mount: ${missing.join(', ')}`);
  }
};

/** The settings-plane services (the Agent 预设 data source) the boot demands
 * BESIDE the spine: demanded separately so the `upstream/services` record
 * keeps its published spine shape (the E2E manifests pin it). */
const PRESET_SERVICES = ['loader', 'agentPresets'];

/** Fail loud when the Agent 预设 mount chain did not land (rule 5). */
export const demandPresetServices = (ctx) => {
  const missing = PRESET_SERVICES.filter((name) => ctx.get(name) === undefined);
  if (missing.length > 0) {
    throw new Error(`boot: preset services failed to mount: ${missing.join(', ')}`);
  }
};
