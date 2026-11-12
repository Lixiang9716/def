// dsh:logging-exempt (pure data module)
/**
 * upstream/permission-presets-data.js — the mobile preset table for the
 * permissionPresets face (T-0299). Pure data: each entry names a posture
 * over the capability registry's permission-flag vocabulary
 * (tools/generated/capability-registry.json, T-0296). The flag set itself
 * lives in the registry and is never copied here — a copied list would
 * drift from the one source table; a preset here NAMES a posture over it.
 *
 * The mobile seat carries exactly one enforceable posture: every primitive
 * serves per its own permissionFlag, gated by the host capability layer.
 * There is no session-scoped weakening/tightening seam (adding one is a
 * gateway contract change — contract/proposals first), so a richer roster
 * would be a fabricated control: the desktop table's multi-preset shape is
 * the staged version, pending that seam.
 *
 * The event/state vocabulary mirrors the vendored
 * @deepseek-ai/dsh-permission-presets 0.1.6-alpha.2 (the `permissions`
 * projection folding permission/preset | sandbox/mode | approval/policy
 * events) so a future mount of the real package replays the same sessions.
 */

/** The preset table keyed by preset name — the upstream table's shape minus
 * the sandbox/approval knobs the mobile seat does not carry (no confining
 * shell, no approval service to write through). */
export const PERMISSION_PRESETS = {
  standard: {
    name: 'Standard',
    description: 'The capability registry\'s default flag set — every primitive serves per its own permissionFlag, gated by the host capability layer.',
  },
};

/** The preset new sessions resolve to absent an explicit selection. */
export const DEFAULT_PERMISSION_PRESET = 'standard';

/** The derived not-a-preset state (the upstream constant): the answer when
 * a session's recorded selection names no available preset. */
export const CUSTOM_PRESET = 'custom';
