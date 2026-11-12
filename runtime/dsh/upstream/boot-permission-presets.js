// dsh:logging-exempt (boot module; logging happens through the mounted logger)
/**
 * upstream/boot-permission-presets.js — the PERMISSION-PRESETS row (T-0299):
 * the seat-local face for the `permissionPresets` service the vendored
 * subagent's delegation capture reads
 * (`parent.ctx.get("permissionPresets")?.current(parent.session)` —
 * subagent@0.1.6-alpha.2 lib/index.js, captureDelegatedPolicyOverrides).
 *
 * The real @deepseek-ai/dsh-permission-presets is NOT mountable here: it
 * hard-requires a confining `ctx.shell` (a bash executor with sandboxMode)
 * and `ctx.approval` — it throws over an unconfined executor, and the mobile
 * seat's enforcement story is the capability registry, not desktop sandbox
 * modes. This face carries the same READ contract (a preset-name string:
 * `names` / `current` / `catalog` / `resolve`) and the same WRITE vocabulary
 * (the `permission/preset` session event through the `permissions`
 * projection), with the preset table as DATA
 * (upstream/permission-presets-data.js — one posture today).
 *
 * Effect on the one live consumer: `current()` names the recorded selection
 * or the default ("standard"); the subagent propagates only "auto" /
 * "danger-full-access", so a standard posture delegates exactly like the
 * honest absence did. The face's value is the resolved read for the day a
 * provider composition lands, plus the data-ized catalog behind the web
 * `permissionPresets/catalog` leg (the hardcoded empty table is gone).
 */
import { Service } from '@deepseek-ai/cordis';
import { z } from 'zod';
import {
  CUSTOM_PRESET, DEFAULT_PERMISSION_PRESET, PERMISSION_PRESETS,
} from 'upstream/permission-presets-data.js';

/** The permission-state schema (stateVersion 2 — the vendored package's own
 * version for this key, so a future real-package mount replays the same
 * logs). The sandbox/approval knobs stay in the fold: delegated or
 * forked-in sessions may carry those events, and the fold must not lose
 * them even though the mobile seat never appends them itself. */
const permissionStateSchema = z.object({
  preset: z.string().nullable(),
  sandbox: z.union([
    z.literal('read-only'),
    z.literal('workspace-write'),
    z.literal('danger-full-access'),
  ]).nullable(),
  approval: z.union([z.literal('ask'), z.literal('never')]).nullable(),
  seeded: z.boolean(),
}).strict();

/** State for the empty log: every knob at its composition default. */
const EMPTY_KNOBS = { preset: null, sandbox: null, approval: null };

/** One-event permission-state transition (the projection unit's `apply`).
 * Unrelated events return the same reference — the registry's change gate. */
const applyPermissionEvent = (state, event) => {
  switch (event.type) {
    case 'permission/preset': return { ...state, preset: event.data.preset };
    case 'sandbox/mode': return { ...state, sandbox: event.data.mode };
    case 'approval/policy': return { ...state, approval: event.data.policy };
    case 'session/end-seed': return { ...state, seeded: true };
    default: return state;
  }
};

/** The face: registers as the `permissionPresets` service (the name the
 * vendored subagent resolves through `ctx.get`). The one inject is the
 * projection registry — the fold `current()` reads; cordis refuses
 * undeclared property access (fail loud, not silent). */
export class PermissionPresetsFace extends Service {
  static inject = ['sessionProjections'];

  constructor(ctx) {
    super(ctx, 'permissionPresets');
    this.presets = PERMISSION_PRESETS;
    this.defaultPreset = DEFAULT_PERMISSION_PRESET;
    ctx.sessionProjections.register({
      key: 'permissions',
      stateVersion: 2,
      stateSchema: permissionStateSchema,
      init: () => ({ ...EMPTY_KNOBS, seeded: false }),
      apply: applyPermissionEvent,
    });
  }

  /** The advertised preset names (declaration order). */
  get names() {
    return Object.keys(this.presets);
  }

  /** The complete process-level catalog the current-session UI reads (the
   * upstream `catalog()` shape: {options: [{value, name, description?}]}). */
  catalog() {
    return {
      options: this.names.map((name) => ({
        value: name,
        name: this.presets[name].name,
        description: this.presets[name].description,
      })),
    };
  }

  /** The session's effective preset name. A recorded selection that still
   * names an available preset wins; a recorded name matching nothing is the
   * upstream `custom` state; the composition default resolves the fresh
   * log — on this seat that default IS the effective posture (the
   * registry's flag set), so the name is a fact, not an aspiration. */
  current(session) {
    const state = this.permissionState(session);
    if (state.preset !== null) {
      return this.presets[state.preset] !== undefined ? state.preset : CUSTOM_PRESET;
    }
    return this.defaultPreset;
  }

  /** Resolve one available preset's table entry; unknown names fail loud
   * (rule 5) naming the full roster. */
  resolve(name) {
    const spec = this.presets[name];
    if (spec === undefined) {
      throw new Error(`permission: unknown preset "${name}" (known: ${this.names.join(', ')})`);
    }
    return spec;
  }

  /** Record a changed selection as the durable intent event. Selecting the
   * effective preset again appends nothing (the upstream gate). The mobile
   * seat carries no sandbox/approval knobs to write through — the recorded
   * event is the selection's whole effect (the enforcement seam is the
   * staged gap, see the agent note). */
  set(session, name) {
    this.resolve(name);
    if (this.current(session) === name) return;
    session.append('permission/preset', { preset: name });
  }

  /** The projection state behind `current`. A missing registration fails
   * loud — the face registers its own, so absence is a boot regression. */
  permissionState(session) {
    const state = this.ctx.sessionProjections.stateOf(session, 'permissions');
    if (state === undefined) {
      throw new Error('permission: permissions session projection is not registered');
    }
    return state;
  }
}

/** The boot row: mount the face onto the spine (after the projection
 * registry and settings exist — the constructor registers the projection). */
export const mountPermissionPresets = async (ctx) => {
  await ctx.plugin(PermissionPresetsFace, {});
};
