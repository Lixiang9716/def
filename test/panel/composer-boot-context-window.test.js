import { describe, it, expect } from 'vitest';

// The boot carrier's contextWindow forward (the P4 residual, measured on
// device 2026-10-10): PR #429 threaded the capacity through the credential
// grammar → the route builders → the rebind/restore seams, and boot.js
// already consumed options.llm.contextWindow into the adapter's
// resolveModel context — but composer-web-live's bootOptions() did not
// FORWARD the route's capacity, so the INITIAL boot adapter (a byok route
// resurrected from the keychain at boot, or a staged credential) stayed
// windowless and compaction warned "no context capacity" until a save or
// clear happened to rebind. This suite pins the forward at the pure module
// (web-live/boot-options.js — split from composer-web-live.js for exactly
// this testability: the composer module runs main() at import): the boot
// options carry the route's contextWindow as-is. The defaults live in the
// route builders (byokRoute's credential-override → provider-row →
// fallback; stagedRoute's optional llmContextWindow); the mock route
// stages none and the field stays undefined — no invented capacity here.

import { bootOptions } from '../../runtime/dsh/web-live/boot-options.js';

const CFG = { containerRoot: '/w', fsScopeRoot: '/w', presetJoin: true };
const ROOT = '/w';
const EXTRAS = {
  scenario: 'composer.live-write', agentId: 'main', sessionId: 's-b4-ondevice-0001',
  onEvent: () => {},
};
const byokRoute = { kind: 'byok', baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4',
  apiKey: 'k', provider: 'openai-compatible', model: 'glm-5.3-flash',
  scripted: false, userEndpoint: true, contextWindow: 131072,
  adapterName: 'a', transportLabel: 't' };
const mockRoute = { kind: 'mock', baseURL: 'http://127.0.1:9', apiKey: 'k',
  provider: 'mock', model: 'mock-1', scripted: true, userEndpoint: false,
  adapterName: 'a', transportLabel: 't' };
const stagedRoute = { ...byokRoute, kind: 'staged', model: 'm1', contextWindow: 262144 };

describe('the boot carrier forwards the route contextWindow', () => {
  it('the byok-shaped route capacity reaches options.llm', () => {
    const opts = bootOptions(CFG, byokRoute, ROOT, EXTRAS);
    expect(opts.llm.contextWindow).toBe(131072);
    expect(opts.llm.baseURL).toBe(byokRoute.baseURL);
    expect(opts.llm.provider).toBe('openai-compatible');
    expect(opts.llm.model).toBe('glm-5.3-flash');
    expect(opts.llm.userEndpoint).toBe(true);
    expect(typeof opts.llm.onWire).toBe('function');
    expect(typeof opts.llm.onSse).toBe('function');
  });

  it('a route without a capacity stays undefined — no invented default here', () => {
    const opts = bootOptions(CFG, mockRoute, ROOT, EXTRAS);
    expect(opts.llm.contextWindow).toBeUndefined();
    expect(opts.llm.model).toBe('mock-1');
  });

  it('the staged route carries its optional capacity through untouched', () => {
    expect(bootOptions(CFG, stagedRoute, ROOT, EXTRAS).llm.contextWindow).toBe(262144);
  });

  it('the boot identity and interactive rows ride the extras shape', () => {
    const opts = bootOptions({ ...CFG, commands: true, creation: true },
      mockRoute, ROOT, EXTRAS);
    expect(opts.scenario).toBe('composer.live-write');
    expect(opts.agentId).toBe('main');
    expect(opts.sessionId).toBe('s-b4-ondevice-0001');
    expect(opts.cwd).toBe('/w');
    expect(opts.commands).toBe(true);
    expect(opts.creation).toBe(true);
    expect(opts.presetJoin).toBe(true);
    expect(opts.container.scopeRoot).toBe('/w');
    expect(opts.container.env.DSH_MOCK_LLM_URL).toBe('http://127.0.1:9');
  });

});

describe('the boot carrier launch env rows (the default-off byte pin)', () => {
  it('the default-off launch env is EXACTLY the two mock rows (byte-identity pin)', () => {
    const opts = bootOptions(CFG, mockRoute, ROOT, EXTRAS);
    expect(Object.keys(opts.container.env).sort())
      .toEqual(['DSH_MOCK_LLM_KEY', 'DSH_MOCK_LLM_URL']);
  });

  it('a pi-ai-served route adds ONLY its credential-ref row (deriveByokRef mirror)', () => {
    const piaiRoute = { ...byokRoute, provider: 'anthropic', model: 'claude-sonnet-4-5',
      api: 'anthropic-messages',
      piai: { displayName: 'Anthropic', apiKeyEnv: 'ANTHROPIC_API_KEY',
        api: 'anthropic-messages', baseURL: byokRoute.baseURL,
        models: [{ id: 'claude-sonnet-4-5', contextWindow: 131072 }], userEndpoint: true } };
    const opts = bootOptions(CFG, piaiRoute, ROOT, EXTRAS);
    expect(Object.keys(opts.container.env).sort())
      .toEqual(['ANTHROPIC_API_KEY', 'DSH_MOCK_LLM_KEY', 'DSH_MOCK_LLM_URL']);
    expect(opts.container.env.ANTHROPIC_API_KEY).toBe('k');
  });
});

// The SESSION-PERSISTENCE gate (T-0212), pinned at the same pure module: the
// evidence/drive seats' cfg carries no sessionPersistence row, and the boot
// options must stay exactly as before — the key ABSENT (the
// `identity.sessionPersistence; absent = off` gate, boot.js), so every
// ungated boot stays byte-identical. The interactive seat feeds `true`; the
// forward is the gate's config object `{}` — DEFAULTS, deliberately: root
// omitted → `<profileCwd>/dsh/sessions` (inside the pinned profile
// container), compression omitted → the vendored default 'zstd'. Anything
// richer here would invent a path the seat never granted.
describe('the boot carrier carries the session-persistence gate', () => {
  it('a cfg without the persistence flag leaves the key off the boot options', () => {
    const opts = bootOptions(CFG, mockRoute, ROOT, EXTRAS);
    expect(opts.sessionPersistence).toBeUndefined();
    expect('sessionPersistence' in opts).toBe(false);
  });

  it('the interactive persistence flag forwards as the DEFAULTS config object', () => {
    const opts = bootOptions({ ...CFG, sessionPersistence: true },
      mockRoute, ROOT, EXTRAS);
    expect(opts.sessionPersistence).toEqual({});
  });
});
