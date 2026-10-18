// Tool-layer contract tests for index.js — the surfaceId registry and the
// SIXTH red-team category (M4 plan #12: forged-surfaceId update, the
// cross-surface-pollution attack), against the REAL vendored defineTool
// shape the spine's ToolRuntime enforces (output { schema, render };
// execute returns the schema-shaped value; refusals THROW):
//   render    mints + echoes a surfaceId in both modes; a rejected spec mints nothing
//   update    a forged/unknown surfaceId is refused BEFORE any spec work
//   update    a live surfaceId + valid spec succeeds; a live surfaceId +
//             invalid spec gets the validator's rejection (authorization ≠ validation)
// The plugin's MODE is frozen at import from DSH_APPSHELL_MODE (mock.js), so
// the mock-mode legs re-evaluate the module via vi.stubEnv + dynamic import().
import { describe, it, expect, vi, beforeEach } from 'vitest';

const PLUGIN = () => import('../../system-plugins/dsh-appshell/index.js');

/** Registers the plugin into a fake tools context, returning its tool defs. */
const harness = async () => {
  const mod = await PLUGIN();
  mod._resetSurfaces();
  const defs = new Map();
  mod.apply({ tools: { register: (def) => defs.set(def.name, def) } });
  return { mod, defs, tool: (name) => defs.get(name) };
};

const VALID_SPEC = {
  spec: 'app-shell/0.9',
  theme: { accent: '#07C160' },
  tabs: ['首页', '我的'],
  screen: { type: 'column', children: [{ type: 'text', text: '你好' }] },
};
const INVALID_SPEC = { spec: 'app-shell/0.9', tabs: ['only-one'], screen: { type: 'column', children: [] } };

describe('appshell_render mints the surfaceId (real mode)', () => {
  beforeEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('a valid spec returns { ok, title, surfaceId, spec } with a minted id', async () => {
    const { tool } = await harness();
    const out = await tool('appshell_render').execute({ spec: VALID_SPEC });
    expect(out.ok).toBe(true);
    expect(out.surfaceId).toMatch(/^appshell-\d+$/);
    expect(out.spec).toEqual(VALID_SPEC);
    expect(out.title).toBe('app');
  });

  it('the output render emits the JSON echo — the card text the web client parses', async () => {
    const { defs } = await harness();
    const def = defs.get('appshell_render');
    const value = await def.execute({ spec: { ...VALID_SPEC, title: '微信' } });
    const blocks = def.output.render({}, value);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
    expect(JSON.parse(blocks[0].text)).toMatchObject({ ok: true, title: '微信' });
  });

  it('consecutive renders mint distinct ids', async () => {
    const { tool } = await harness();
    const a = await tool('appshell_render').execute({ spec: VALID_SPEC });
    const b = await tool('appshell_render').execute({ spec: VALID_SPEC });
    expect(a.surfaceId).not.toBe(b.surfaceId);
  });

  it('a rejected spec mints nothing — the failed render is not a live surface', async () => {
    const { tool } = await harness();
    await expect(tool('appshell_render').execute({ spec: INVALID_SPEC })).rejects.toThrow('spec rejected:');
    // The surface never existed: an update naming the would-be id must fail
    // authorization, proving no mint happened on the rejected path.
    await expect(tool('appshell_update').execute({ surfaceId: 'appshell-1', spec: VALID_SPEC }))
      .rejects.toThrow('unknown-surface');
  });
});

describe('appshell_update — the sixth red-team category: forged surfaceId', () => {
  beforeEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('a forged surfaceId is refused (thrown) naming the unknown surface', async () => {
    const { tool } = await harness();
    await expect(tool('appshell_update').execute({ surfaceId: 'appshell-999 (someone else)', spec: VALID_SPEC }))
      .rejects.toThrow('unknown-surface: appshell-999 (someone else)');
  });

  it('a forged id is refused even with an INVALID spec — authorization runs first', async () => {
    const { tool } = await harness();
    await expect(tool('appshell_update').execute({ surfaceId: 'forged', spec: INVALID_SPEC }))
      .rejects.toThrow('unknown-surface');
  });

  it('a missing/empty surfaceId is the same refusal, never a crash', async () => {
    const { tool } = await harness();
    for (const args of [{ spec: VALID_SPEC }, { surfaceId: '', spec: VALID_SPEC }, {}]) {
      await expect(tool('appshell_update').execute(args)).rejects.toThrow('unknown-surface');
    }
  });

  it('a LIVE surfaceId + valid spec updates; the same id + invalid spec gets the validator rejection', async () => {
    const { tool } = await harness();
    const rendered = await tool('appshell_render').execute({ spec: VALID_SPEC });
    const updated = await tool('appshell_update').execute({ surfaceId: rendered.surfaceId, spec: VALID_SPEC });
    expect(updated).toMatchObject({ ok: true, surfaceId: rendered.surfaceId });
    await expect(tool('appshell_update').execute({ surfaceId: rendered.surfaceId, spec: INVALID_SPEC }))
      .rejects.toThrow('spec rejected:');
  });

  it('the registry is per plugin instance — a second apply keeps its own counter but shared module state stays coherent', async () => {
    const { mod, tool } = await harness();
    const rendered = await tool('appshell_render').execute({ spec: VALID_SPEC });
    // A second apply (another session's mount of the same module) still sees
    // the live surface — module state IS the registry's scope in v0.
    const defs2 = new Map();
    mod.apply({ tools: { register: (def) => defs2.set(def.name, def) } });
    const updated = await defs2.get('appshell_update').execute({ surfaceId: rendered.surfaceId, spec: VALID_SPEC });
    expect(updated.ok).toBe(true);
  });
});

describe('appshell_render mints the surfaceId (mock mode)', () => {
  beforeEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('DSH_APPSHELL_MODE=mock: the fixture echo carries a minted surfaceId the update path accepts', async () => {
    vi.stubEnv('DSH_APPSHELL_MODE', 'mock');
    const { tool } = await harness();
    const out = await tool('appshell_render').execute({ fixture: 'wechat' });
    expect(out.ok).toBe(true);
    expect(out.surfaceId).toMatch(/^appshell-\d+$/);
    expect(out.title).toBe('wechat');
    const updated = await tool('appshell_update').execute({ surfaceId: out.surfaceId, spec: VALID_SPEC });
    expect(updated.ok).toBe(true);
  });

  it('mock mode: an unknown fixture mints nothing and update on the stale id is refused', async () => {
    vi.stubEnv('DSH_APPSHELL_MODE', 'mock');
    const { tool } = await harness();
    await expect(tool('appshell_render').execute({ fixture: 'nope' })).rejects.toThrow('unknown fixture');
    await expect(tool('appshell_update').execute({ surfaceId: 'appshell-1', spec: VALID_SPEC }))
      .rejects.toThrow('unknown-surface');
  });
});

describe('appshell_catalog serves the authoring rules', () => {
  beforeEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('returns { rules } naming the spec version, rendered as the card text', async () => {
    const { defs, tool } = await harness();
    const out = await tool('appshell_catalog').execute({});
    expect(out.rules).toContain('app-shell/0.9');
    const blocks = defs.get('appshell_catalog').output.render({}, out);
    expect(blocks[0].text).toContain('app-shell/0.9');
  });
});
