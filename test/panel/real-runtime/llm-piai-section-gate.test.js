// dsh:logging-exempt (test: the verdict is the assertion output; the gate is
// silent — its only log line rides the rebind leg, not this seam)
/**
 * llm-piai-section-gate.test.js — the BYOK-models SECTION gate's boot
 * contract. `llm.piaiSection === true` is the boot.js gate line (boot.js:476,
 * `if (llm.piaiSection === true) await mountPiAiSection(ctx, onEvent)`; the
 * seat forwards it from `cfg.byokModels`, web-live/boot-options.js:50), and
 * mountPiAiSection (upstream/llm-piai-mount.js:300) composes exactly three
 * facts: the credentials service (credentials-store.js, the app-scope
 * `credentials.json` twin of web-write-llm.js's STORE_PATH), then the
 * vendored @deepseek-ai/dsh-llm-pi-ai plugin over an EMPTY base layer (the
 * rebind precedent's mountPlugin(ctx, {}), llm-piai-mount.js:211), whose own
 * apply installs the "llm-pi-ai" settings section through
 * ctx.inject(['settings']).
 *
 * THE HARNESS: the REAL vendored closure at seam level — a real cordis
 * Context + SettingsMemory + the REAL LlmRuntime with its live-route
 * directory row (mountGatewayLlm, boot.js:455's leg) + the REAL pi-ai
 * plugin. This is boot.js minus the rows the gate does not touch
 * (sessions/agent/tools/presets...), the same composition order boot uses
 * (mountGatewayLlm → SettingsMemory → the gate line). One identity per
 * vendored face across the whole graph: the @deepseek-ai faces resolve
 * through the runtime bare-map farm (runtime/dsh/node_modules, provisioned
 * by test/panel/spine/provision-modules.mjs + the vitest globalSetup
 * provision-farm.mjs), so cordis' Service/Context, schemastery's Schema and
 * the dsh-llm classes are module-singletons everywhere.
 *
 * Coverage:
 *   (1) a piaiSection=true boot answers settings.describe with the
 *       "llm-pi-ai" namespace, its schema JSON-serializable (the wire view
 *       the Models page consumes, web-write-settings.js:103), the section
 *       value's providers starting EMPTY (zero routes staged — the empty
 *       base is the point), the catalog directory declared in full, and the
 *       credentials service live UNDER the gate only;
 *   (2) a live route whose provider takes a BUILT-IN catalog id ("deepseek")
 *       fails the boot LOUD and names BOTH sides: pi-ai declares every
 *       installed catalog id the moment it mounts (pi-ai lib
 *       directoryEntries — settingsNs "llm-pi-ai"), the vendored registry
 *       refuses the duplicate (DUPLICATE_DIRECTORY), and
 *       sectionCollision (llm-piai-mount.js:341) rebuilds it naming the
 *       colliding catalog id AND the live row (provider + its llm-* settings
 *       ns) plus the two ways out;
 *   (3) the gate ABSENT → the boot shape is the status quo: no llm-pi-ai
 *       namespace in describe, the configurable-provider directory still
 *       exactly the ONE live-route row, and no credentials service — the
 *       default boot's MOUNTED_SERVICES bytes stay untouched (pinned by the
 *       E2E manifest android-composer-live-write.json's upstream/services
 *       record: eight services, no "credentials").
 */
import { existsSync } from 'node:fs';
import { describe, beforeAll, it, expect, vi } from 'vitest';
import { workspace } from '../gateway-shim.js';

// The dsh host's node:buffer is the repo shim carrying encodeUtf8/decodeUtf8;
// desktop node has neither (the llm-route-context-window.test.js precedent).
vi.mock('node:buffer', async (importOriginal) => ({
  ...await importOriginal(),
  encodeUtf8: (text) => new TextEncoder().encode(String(text ?? '')),
  decodeUtf8: (bytes) => new TextDecoder().decode(bytes),
}));

// The runtime files import the device gateway by the RELATIVE '../gateway.js'
// spelling (realpath runtime/dsh/gateway.js — the __dshGatewayCall seam,
// absent under vitest): the panel suite's answer is the panel gateway-shim,
// mocked BY PATH (the llm-route-context-window precedent, which swaps the
// same module for handler doubles). The shim's in-memory workspace IS the
// seeded store below — the same module instance this file imports directly.
vi.mock('../../../runtime/dsh/gateway.js', async () =>
  await import('../gateway-shim.js'));

// The runtime bare-map farm is the ONE resolution home for the @deepseek-ai
// faces: the staged packages import each other by bare name, so single-file
// aliases can never close their dependency closure. The farm is provisioned
// by the vitest globalSetup (provision-farm.mjs →
// spine/provision-modules.mjs) from the materialized vendored closure.
vi.mock('@deepseek-ai/dsh-llm', async () =>
  await import('../../../hosts/android/app/src/main/assets/dsh/vendor/dsh/llm@0.1.6-alpha.2/lib/index.js'));

// The dsh-root-relative spellings the in-graph runtime modules import (the
// quickjs loader's bare map on device) — re-pointed at the same real files
// the farm links.
vi.mock('upstream/llm-transport.js', async () =>
  await import('../../../runtime/dsh/upstream/llm-transport.js'));
vi.mock('upstream/llm-route.js', async () =>
  await import('../../../runtime/dsh/upstream/llm-route.js'));
vi.mock('upstream/web-write-settings.js', async () =>
  await import('../../../runtime/dsh/upstream/web-write-settings.js'));
vi.mock('upstream/llm-piai-mount.js', async () =>
  await import('../../../runtime/dsh/upstream/llm-piai-mount.js'));

// The suite boots the REAL pi-ai mount over the runtime bare-map farm — it
// needs the materialized vendored closure (external/ensure-dsh.sh;
// provision-farm.mjs in the vitest globalSetup provisions the farm). Bare
// checkouts (fresh clone, the gov pre-push copy) skip loud — the same honest
// posture as the device legs, never a fake pass. The module loads live
// INSIDE the guarded wrapper: a bare checkout must reach the skip, never an
// import error.
const FARM_READY = existsSync(new URL('../../../runtime/dsh/node_modules/@deepseek-ai/dsh-settings/lib/index.js', import.meta.url));
if (!FARM_READY) {
  console.warn('[llm-piai-section-gate] the runtime bare-map farm is not provisioned — run external/ensure-dsh.sh; skipping the real-mount suite');
}
const d = FARM_READY ? describe : describe.skip;

let Context, SettingsMemory, mountGatewayLlm, mountPiAiSection, PIAI_SECTION_NS, CredentialsStore;

if (FARM_READY) {
  beforeAll(async () => {
    ({ Context } = await import('../../../hosts/android/app/src/main/assets/dsh/vendor/npm/cordis@4.0.2/lib/index.js'));
    ({ SettingsMemory } = await import('../../../runtime/dsh/upstream/settings-memory.js'));
    ({ mountGatewayLlm } = await import('../../../runtime/dsh/upstream/llm-gateway-mount.js'));
    ({ mountPiAiSection, PIAI_SECTION_NS } = await import('../../../runtime/dsh/upstream/llm-piai-mount.js'));
    ({ CredentialsStore } = await import('../../../runtime/dsh/upstream/credentials-store.js'));
  });
}

/** The live-route leg (boot.js:455's mountGatewayLlm over the loopback mock
 * shape): registers the gateway adapter AND commits the directory's ONE
 * live-route row (settingsNs = llm-<provider>, providerSettingsNs). */
const bootLlmPlane = async (provider, model) => {
  const ctx = new Context();
  await ctx.plugin(SettingsMemory);
  await mountGatewayLlm(ctx, {
    baseURL: 'http://127.0.0.1:17890/v1', // the loopback E2E boundary — never a user endpoint
    apiKey: 'panel-suite-key',
    provider,
    model,
    adapterName: 'llm-piai-section-gate suite staged route',
  }, () => {});
  return ctx;
};

const seedCredentialStore = (store) => {
  workspace.set('app/credentials.json', new TextEncoder().encode(JSON.stringify(store)));
};

d('the gate mounts (llm.piaiSection === true) — settings carries the serializable section', () => {
  it('settings.describe carries the llm-pi-ai namespace with a serializable schema', async () => {
    // 'bigmodel' names no built-in catalog id — the seat's live route keeps
    // its row and the catalog declares around it without a collision.
    const ctx = await bootLlmPlane('bigmodel', 'glm-5.3-flash');
    const events = [];
    await mountPiAiSection(ctx, (type, fields) => events.push([type, fields]));

    const view = ctx.get('settings').describe({ redactSecrets: true });
    const section = view.find((d) => d.ns === PIAI_SECTION_NS);
    expect(section, `describe() namespaces: ${view.map((d) => d.ns).join(', ')}`).toBeDefined();
    // The wire view serializes the schema for the page — a schema that does
    // not survive JSON is a broken Models page, not a styling nit.
    const serialized = JSON.stringify(section.schema);
    expect(typeof serialized).toBe('string');
    expect(serialized.length).toBeGreaterThan(0);
    expect(() => JSON.parse(serialized)).not.toThrow();

    // The empty base layer (the rebind precedent's mountPlugin(ctx, {})):
    // the gate stages ZERO routes — the section's providers start empty.
    expect(ctx.get('settings').get(PIAI_SECTION_NS)?.providers).toEqual({});

    // The boot observability hook: llm/piai-section fires exactly once,
    // after the empty-base mount proved clean (llm-piai-mount.js:328).
    expect(events).toEqual([['llm/piai-section', {
      plugin: '@deepseek-ai/dsh-llm-pi-ai',
      namespace: PIAI_SECTION_NS,
    }]]);
  });
});

d('the gate mounts — the catalog declares whole and the live row survives', () => {
  it('declares the whole built-in catalog in the configurable-provider directory', async () => {
    const ctx = await bootLlmPlane('bigmodel', 'glm-5.3-flash');
    await mountPiAiSection(ctx, () => {});

    const directory = ctx.get('llm').listConfigurableProviders();
    const sectionRows = directory.filter((entry) => entry.settingsNs === PIAI_SECTION_NS);
    // The mounted plugin declares EVERY installed catalog id the moment it
    // mounts (pi-ai directoryEntries) — the fact that makes a colliding live
    // route name fail loud instead of quietly shadowing. Pin the catalog ids
    // the seat's BYOK rows join against.
    const declared = sectionRows.map((entry) => entry.provider);
    // The full built-in set, measured on the pinned vendored pi-ai
    // (@earendil-works/pi-ai providers/all getBuiltinProviders → 39): the
    // number mountPiAiSection's own JSDoc names — a vendored catalog drift
    // fails HERE, in the gate's coverage, not on a seat.
    expect(declared).toHaveLength(39);
    for (const id of ['deepseek', 'anthropic', 'google']) {
      expect(declared, `catalog id "${id}" must be declared under ${PIAI_SECTION_NS}`).toContain(id);
    }
    // The live route's own row survives beside the catalog (its settingsNs
    // is the provider route's llm-<provider>, never the section ns).
    expect(directory.filter((entry) => entry.settingsNs === 'llm-bigmodel'))
      .toEqual([{ provider: 'bigmodel', displayName: 'OpenAI 兼容',
        settingsNs: 'llm-bigmodel', settingsPath: ['providers', 'default'] }]);
  });
});

d('the gate mounts — the credentials service is the app-scope credentials.json', () => {
  it('mounts the credentials service under the gate — the store IS the app-scope credentials.json', async () => {
    const ctx = await bootLlmPlane('bigmodel', 'glm-5.3-flash');
    await mountPiAiSection(ctx, () => {});

    // The Service base self-provides as "credentials" (credentials-store.js
    // constructor) — the service pi-ai's resolveApiKey reads BEFORE the
    // launch environment (pi-ai lib resolveApiKey: ctx.get('credentials')
    // first, process env only as the fallback the gate exists to shadow).
    const credentials = ctx.get('credentials');
    expect(credentials).toBeInstanceOf(CredentialsStore);

    // Same-dir wire twin: the flat {ref: value} document the Models page
    // writes through web-write-llm.js (STORE_PATH, app scope) answers the
    // store's reads.
    seedCredentialStore({ DEEPSEEK_API_KEY: 'sk-gate-canary-0001' });
    await expect(credentials.resolve('DEEPSEEK_API_KEY'))
      .resolves.toEqual({ value: 'sk-gate-canary-0001' });
    await expect(credentials.resolve('NOT_STORED_REF')).resolves.toBeUndefined();

    // Rule 5: an out-of-grammar ref fails loud naming the grammar (the
    // write face refuses such refs; one arriving here is a broken caller).
    await expect(credentials.resolve('not a ref')).rejects.toThrow(/ref must match/);

    // credentialStoreFrom's nothing-stored fallbacks (pi-ai asks every
    // catalog provider): a flat ref file holds no records.
    expect(await credentials.readRecord('llm-pi-ai/deepseek')).toBeUndefined();
    await expect(credentials.listRecords()).resolves.toEqual([]);
    workspace.delete('app/credentials.json');
  });
});

d('the gate collides with a live catalog-id route — boot fails loud naming BOTH', () => {
  it('a live route named "deepseek" rejects the section mount naming the catalog id and the live row', async () => {
    // The live route took a BUILT-IN catalog id: the plugin's catalog-wide
    // declaration meets the live route's held row and the vendored registry
    // throws DUPLICATE_DIRECTORY ("configurable provider "deepseek" is
    // already declared") — boot.js awaits the gate verbatim, so this
    // rejection IS the loud boot failure.
    const ctx = await bootLlmPlane('deepseek', 'deepseek-chat');
    await expect(mountPiAiSection(ctx, () => {})).rejects.toThrow(new RegExp([
      'pi-ai section mount collided with the live llm route',
      'pi-ai catalog id "deepseek" is already declared',
      'the live route\'s row \\(provider "deepseek", settings ns "llm-deepseek"\\)',
      'rename the staged provider or turn the pi-ai section gate off',
    ].join('[\\s\\S]*')));
  });

  it('the failure is the rebuilt collision, not the vendored error leaking through', async () => {
    // Rule 5 cuts both ways: the rethrow must carry the GUIDANCE (both names
    // + the two ways out); an unrecognizable error shape is rethrown
    // verbatim (sectionCollision's own contract) — never relabeled.
    const ctx = await bootLlmPlane('anthropic', 'claude-sonnet-4-5');
    const rejection = await mountPiAiSection(ctx, () => {}).then(
      () => { throw new Error('mountPiAiSection resolved — the catalog collision was expected to reject'); },
      (error) => error,
    );
    expect(String(rejection?.message)).toMatch(/anthropic/);
    expect(String(rejection?.message)).toMatch(/llm-anthropic/);
    expect(String(rejection?.message)).toMatch(/turn the pi-ai section gate off/);
  });
});

d('the gate absent — the boot shape is the status quo', () => {
  it('no llm-pi-ai namespace, the directory still the ONE live-route row, no credentials service', async () => {
    // The pinned default-boot shape (android-composer-live-write.json's
    // upstream/services record): provider "mock", eight MOUNTED_SERVICES.
    const ctx = await bootLlmPlane('mock', 'mock-1');

    const view = ctx.get('settings').describe({ redactSecrets: true });
    expect(view.find((d) => d.ns === PIAI_SECTION_NS)).toBeUndefined();

    // The configurable-provider directory holds exactly the live route's
    // row — no catalog declaration without the gate.
    const directory = ctx.get('llm').listConfigurableProviders();
    expect(directory).toHaveLength(1);
    expect(directory[0]).toEqual({ provider: 'mock', displayName: 'OpenAI 兼容',
      settingsNs: 'llm-mock', settingsPath: ['providers', 'default'] });

    // The credentials service mounts ONLY inside the gate (a plugin mount
    // would move the pinned MOUNTED_SERVICES bytes): absent here.
    expect(ctx.get('credentials')).toBeUndefined();
  });
});
