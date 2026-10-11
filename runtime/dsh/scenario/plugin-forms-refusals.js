/**
 * The creation-refusal probe phase for the plugin.forms leg — kept out of
 * the driver so both stay under the code-size cap (the sources.js
 * precedent, one step further; the driver injects its emit/demand/write
 * faces). Every refusal here is a structured in-band value, never a throw:
 *
 *   - bad syntax / a plugin-less export refuse at 'linked' with the
 *     registry adoption rolled back;
 *   - an unknown template kind is refused by plugin_create itself with the
 *     supported list (and the flip: with authored source, any kind is a
 *     free manifest field);
 *   - a same-name remount refuses at 'context' before read/approval, the
 *     live fiber undisturbed;
 *   - an authored source calling setInterval still writes + answers — with
 *     the non-blocking discipline warn riding the result, a clean template
 *     drawing none (the derived write prefix is pinned into the gitignored
 *     scratch and the profile globals restored).
 */
import { createLogger } from 'logger.js';
import { fsScope, fsRead } from 'gateway.js';
import { mountWorkspacePlugin, unmountWorkspacePlugin, isMounted }
  from 'plugin-mount.js';
import { pluginCreateExecute } from 'system-plugins/dsh-create/index.js';
import { BAD_SYNTAX_SOURCE, NO_APPLY_SOURCE, CUSTOM_KIND_SOURCE, MANIFEST }
  from './plugin-forms-sources.js';

const PREFIX = 'tmp/plugin-forms';
const log = createLogger('dsh.scenario.refusals');

/** The registry row for a spec (the rollback side-pin): decode the
 * registry JSON (llm.js utf8Decode; ASCII-safe latin-1 fallback). */
const registryRowFor = async (spec) => {
  log.debug('registry row read', { spec });
  const { bytes } = await fsRead('app', `${PREFIX}/dsh.plugins/1/registry.json`);
  const dsh = await import('llm.js').catch(() => undefined);
  const text = typeof dsh?.utf8Decode === 'function' ? dsh.utf8Decode(bytes)
    : String.fromCharCode(...bytes);
  return JSON.parse(text).plugins.find((row) => row.id === spec);
};

/** One linked-step refusal probe: write the tree, mount, demand the
 * structured refusal + no live fiber + the rolled-back registry row. */
const probeLinkedRefusal = async (faces, spec, source, probe) => {
  const { ctx, emit, demand, writeTree } = faces;
  log.debug('linked-refusal probe begin', { spec });
  await writeTree(spec, MANIFEST(spec), source);
  const outcome = await mountWorkspacePlugin(ctx, spec, { approved: true, prefix: PREFIX });
  demand(outcome.mounted === false && outcome.step === 'linked',
    `${probe} did not refuse at linked: ${JSON.stringify(outcome)}`);
  demand(isMounted(spec) === false, `${probe} left a live fiber behind`);
  const row = await registryRowFor(spec);
  demand(row?.enabled === false, `${probe} left an enabled registry row (adoption not rolled back)`);
  emit('create.refused', { probe, step: outcome.step });
};

/** The kind enum: plugin_create refuses an unknown template kind with the
 * supported list BEFORE any write/mount; the flip mounts a real plugin
 * whose manifest kind is a free field (the author brought source). */
const kindProbe = async (faces) => {
  const { ctx, emit, demand, writeTree, mountOk } = faces;
  log.debug('kind probe begin', {});
  const refused = await pluginCreateExecute(
    { name: 'forms-hologram', title: 'Hologram', kind: 'hologram' });
  demand(typeof refused === 'string' && refused.includes('timer')
    && refused.includes('calendar'),
  `an unknown template kind did not refuse with the supported list: ${JSON.stringify(refused)}`);
  emit('create.kindrefused', { probe: 'unknown-kind', kinds: ['timer', 'calendar'] });
  await writeTree('forms-hologram', { ...MANIFEST('forms-hologram'), kind: 'hologram' },
    CUSTOM_KIND_SOURCE);
  await mountOk(ctx, 'forms-hologram');
  demand(globalThis.__formsHologram?.loaded === true, 'the custom-kind plugin did not run');
  void await unmountWorkspacePlugin('forms-hologram', { prefix: PREFIX });
};

/** The remount refusal: a second mount of the live forms-boot refuses at
 * 'context' BEFORE read/approval, fiber undisturbed. */
const remountProbe = async ({ ctx, emit, demand }) => {
  log.debug('remount probe begin', {});
  const again = await mountWorkspacePlugin(ctx, 'forms-boot', { approved: true, prefix: PREFIX });
  demand(again.mounted === false && again.step === 'context'
    && /already mounted/.test(again.reason ?? ''),
  `a same-name remount did not refuse: ${JSON.stringify(again)}`);
  demand(isMounted('forms-boot') === true && globalThis.__formsBoot?.loaded === true,
    'the remount refusal disturbed the live fiber');
  emit('create.refused', { probe: 'remount', step: again.step });
};

/** The setInterval discipline warn + the already-mounted remediation, on
 * the model-visible result strings: re-creating the LIVE forms-boot name
 * with a setInterval source still writes + refuses IN-BAND at 'context'
 * (before read/approval — the fiber is untouched), the refusal carrying
 * both the non-blocking warn and the honest new-name/user-unload
 * remediation; a clean template draws no warn. execute derives its write
 * prefix from the pinned profile globals, so the probe points them at the
 * gitignored scratch (restoring in finally). */
const warnProbe = async ({ emit, demand }) => {
  log.debug('warn probe begin', {});
  const root = (await fsScope.resolve('scope://app/'))?.path;
  demand(typeof root === 'string' && root.startsWith('/'),
    'profile container not resolved (warn probe)');
  const cwd = globalThis.__dshProfileCwd;
  const scope = globalThis.__dshProfileScopeRoot;
  globalThis.__dshProfileScopeRoot = root;
  globalThis.__dshProfileCwd = `${root}/tmp/plugin-forms`;
  try {
    const dirty = await pluginCreateExecute({ name: 'forms-boot', title: 'Warn probe',
      kind: 'timer', durationMs: 60000,
      indexSource: 'import "upstream/shims/timers.js";\nsetInterval(() => {}, 1000);\n' });
    demand(typeof dirty === 'string' && dirty.includes('挂载未完成(context)')
      && dirty.includes('already mounted')
      && dirty.includes('warn: indexSource calls setInterval')
      && dirty.includes('换一个新名字'),
    `the dirty already-mounted result lost the warn or the honest remediation: `
      + JSON.stringify(dirty));
    const clean = await pluginCreateExecute({ name: 'forms-boot', title: 'Clean',
      kind: 'timer', durationMs: 60000 });
    demand(typeof clean === 'string' && clean.includes('挂载未完成(context)')
      && !clean.includes('warn:'),
    `the clean already-mounted result drew a spurious warn: ${JSON.stringify(clean)}`);
    emit('create.warned', { probe: 'setinterval-warn', warned: true, control: true });
  } finally {
    globalThis.__dshProfileCwd = cwd;
    globalThis.__dshProfileScopeRoot = scope;
  }
};

/** Phase 11 — the creation flow's negative legs. Faces injected by the
 * driver: {ctx, emit, demand, writeTree, mountOk}. */
export const refuseProbesPhase = async (faces) => {
  log.debug('refusal probes phase begin', {});
  await probeLinkedRefusal(faces, 'forms-badsyntax', BAD_SYNTAX_SOURCE, 'bad-syntax');
  await probeLinkedRefusal(faces, 'forms-noapply', NO_APPLY_SOURCE, 'no-apply');
  await kindProbe(faces);
  await remountProbe(faces);
  await warnProbe(faces);
};
