import { describe, it, expect, vi } from 'vitest';

// P4 — the BYOK adapter's context capacity. The field evidence: warn
// "step compaction failed: compaction-basic: no context capacity for
// openai-compatible/glm-5.3-flash; configure contextWindow on that adapter
// model" — dsh-compaction-basic sizes its pressure budget from
// llm.resolveModelInfo(provider, model).context.contextWindow, the vendored
// registry sources that from the ADAPTER's resolveModel(), and the gateway
// adapter answered no context at all (runtime/dsh/upstream/llm-transport.js
// resolveModel carried only provider/id/name/reasoning). Every long
// conversation therefore hard-fails once compaction triggers. This suite
// pins the whole chain this fix threads: the provider-row defaults, the
// credential grammar (optional, positive integer, bounded), the stored
// shape, the route resolution, the rebind/restore seams down to the
// registered adapter's resolveModel, and the page-bundle mirror.

vi.mock('../../runtime/dsh/gateway.js', () => ({
  httpFetch: vi.fn(),
  keychainGet: vi.fn(async () => null),
}));

// The dsh host's node:buffer is the repo's own shim (upstream/shims/
// buffer.js), which carries the codec pair encodeUtf8/decodeUtf8; desktop
// node's node:buffer does NOT (node 24 has neither). The runtime modules
// under test import them (llm-route.js, web-write-llm.js), so this file's
// graph patches the pair onto the REAL module — the device shim's exact
// semantics (TextEncoder/TextDecoder over Uint8Array), no global alias.
vi.mock('node:buffer', async (importOriginal) => ({
  ...await importOriginal(),
  encodeUtf8: (text) => new TextEncoder().encode(String(text ?? '')),
  decodeUtf8: (bytes) => new TextDecoder().decode(bytes),
}));

const {
  BYOK_PROVIDERS, DEFAULT_CONTEXT_WINDOW, CONTEXT_WINDOW_MAX,
  validateCredential, encodeCredential, byokRoute, stagedRoute, mockRoute,
  rebindLlmRoute, restoreBootRoute, registerBootRouteFactory, deriveByokRef,
} = await import('../../runtime/dsh/upstream/llm-route.js');
const { mountPiAiProviders } =
  await import('../../runtime/dsh/upstream/llm-piai-mount.js');
const { createGatewayLlmAdapter } =
  await import('../../runtime/dsh/upstream/llm-transport.js');
const {
  PROVIDERS, CONTEXT_WINDOW_MAX: PAGE_CONTEXT_WINDOW_MAX, validateDraft, draftFingerprint,
} = await import('../../presentation/web-client-v2/web/js/onboarding-core.js');

const decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes));

const credential = (overrides = {}) => ({
  provider: 'openai-compatible',
  baseURL: 'https://api.example.com',
  apiKey: 'sk-test-0001',
  model: 'glm-5.3-flash',
  ...overrides,
});

/** One fake runtime ctx around the seam registries: llm-route keys its Maps
 * by the ctx object, so a fresh object per capture isolates each test. */
const fakeCtx = (capture) => ({
  get: (name) => (name === 'llm' ? {
    registerAdapter: (providers, adapter) => {
      capture.providers = providers;
      capture.adapter = adapter;
      return () => { capture.disposed = true; };
    },
  } : undefined),
});

describe('the transport seam answers the capacity (resolveModel)', () => {
  it('exposes context.contextWindow when the route configures one', async () => {
    const adapter = createGatewayLlmAdapter({
      baseURL: 'https://api.example.com', apiKey: 'k', provider: 'openai-compatible',
      userEndpoint: true, contextWindow: 131072,
    });
    const resolved = await adapter.resolveModel('openai-compatible', 'glm-5.3-flash');
    expect(resolved.context).toEqual({ contextWindow: 131072 });
    expect(resolved.provider).toBe('openai-compatible');
    expect(resolved.id).toBe('glm-5.3-flash');
  });

  it('answers no context when the route stages none (the mock shape)', async () => {
    const adapter = createGatewayLlmAdapter({
      baseURL: 'http://127.0.0.1:17890', apiKey: 'k', provider: 'mock',
    });
    const resolved = await adapter.resolveModel('mock', 'mock-1');
    expect('context' in resolved).toBe(false);
  });

  it('rejects a non-positive-integer contextWindow at construction (fail loud)', () => {
    for (const garbage of [0, -1, 1.5, '131072', null]) {
      expect(() => createGatewayLlmAdapter({
        baseURL: 'http://127.0.0.1:17890', apiKey: 'k', provider: 'mock',
        contextWindow: garbage,
      })).toThrow(/contextWindow must be a positive integer/);
    }
  });
});

describe('BYOK_PROVIDERS row defaults', () => {
  it('carries a positive integer contextWindow on every row', () => {
    for (const row of Object.values(BYOK_PROVIDERS)) {
      expect(Number.isSafeInteger(row.contextWindow)).toBe(true);
      expect(row.contextWindow).toBeGreaterThan(0);
    }
  });

  it('deepseek defaults to deepseek-chat\'s documented 128K', () => {
    expect(BYOK_PROVIDERS.deepseek.contextWindow).toBe(131072);
    expect(BYOK_PROVIDERS['openai-compatible'].contextWindow).toBe(131072);
    expect(DEFAULT_CONTEXT_WINDOW).toBe(131072);
  });

  it('bounds the grammar above every known model context', () => {
    expect(CONTEXT_WINDOW_MAX).toBe(4000000);
  });

  it('carries the Anthropic first-party row with its credential ref', () => {
    expect(BYOK_PROVIDERS.anthropic.displayName).toBe('Anthropic');
    expect(BYOK_PROVIDERS.anthropic.baseURL).toBe('https://api.anthropic.com');
    expect(BYOK_PROVIDERS.anthropic.model).toBe('claude-sonnet-4-5');
    expect(BYOK_PROVIDERS.anthropic.contextWindow).toBe(200000);
    expect(BYOK_PROVIDERS.anthropic.api).toBe('anthropic-messages');
    expect(deriveByokRef('anthropic')).toBe('ANTHROPIC_API_KEY');
  });

  it('carries the Google row on the OpenAI-compatible flavor', () => {
    expect(BYOK_PROVIDERS.google.displayName).toBe('Google');
    expect(BYOK_PROVIDERS.google.baseURL)
      .toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(BYOK_PROVIDERS.google.model).toBe('gemini-2.5-flash');
    expect(BYOK_PROVIDERS.google.contextWindow).toBe(1048576);
    expect(BYOK_PROVIDERS.google.api).toBe('openai-completions');
    expect(deriveByokRef('google')).toBe('GOOGLE_API_KEY');
  });

  it('carries the wire flavor on the historical rows (unchanged serving)', () => {
    expect(BYOK_PROVIDERS.deepseek.api).toBe('openai-completions');
    expect(BYOK_PROVIDERS['openai-compatible'].api).toBe('openai-completions');
  });
});

describe('validateCredential — the contextWindow grammar', () => {
  it('accepts a legacy credential with no contextWindow (stored shape compat)', () => {
    expect(validateCredential(credential())).toBeNull();
  });

  it('accepts a positive integer override, including the bound itself', () => {
    expect(validateCredential(credential({ contextWindow: 131072 }))).toBeNull();
    expect(validateCredential(credential({ contextWindow: CONTEXT_WINDOW_MAX }))).toBeNull();
  });

  it('rejects non-integers, non-positive values, and absurd sizes', () => {
    for (const garbage of [0, -1, 1.5, '131072', null, CONTEXT_WINDOW_MAX + 1, 1e12]) {
      const invalid = validateCredential(credential({ contextWindow: garbage }));
      expect(invalid?.error?.field, `contextWindow=${String(garbage)}`).toBe('contextWindow');
    }
  });
});

describe('encodeCredential — the stored shape', () => {
  it('rides the override into the keychain bytes', () => {
    expect(decode(encodeCredential(credential({ contextWindow: 65536 }))).contextWindow).toBe(65536);
  });

  it('omits the field when the credential carried none', () => {
    expect(decode(encodeCredential(credential())).contextWindow).toBeUndefined();
  });
});

describe('byokRoute — the effective capacity is never absent', () => {
  it('prefers the credential\'s own override', () => {
    expect(byokRoute(credential({ contextWindow: 1048576 })).contextWindow).toBe(1048576);
  });

  it('falls back to the provider row default (the reported symptom row)', () => {
    expect(byokRoute(credential()).contextWindow).toBe(131072);
    expect(byokRoute(credential({ provider: 'deepseek' })).contextWindow).toBe(131072);
  });

  it('falls back to the openai-compatible default for a custom provider id', () => {
    expect(byokRoute(credential({ provider: 'zai' })).contextWindow).toBe(DEFAULT_CONTEXT_WINDOW);
  });
});

describe('byokRoute — the piaiProviders dict per flavor', () => {
  it('an anthropic credential names its piai dict (ref, protocol, model row)', () => {
    const route = byokRoute(credential({ provider: 'anthropic', baseURL: 'http://127.0.0.1:8442', model: 'claude-sonnet-4-5' }));
    expect(route.api).toBe('anthropic-messages');
    expect(route.piai).toBeDefined();
    expect(route.piai.apiKeyEnv).toBe('ANTHROPIC_API_KEY');
    expect(route.piai.api).toBe('anthropic-messages');
    expect(route.piai.baseURL).toBe('http://127.0.0.1:8442');
    expect(route.piai.models).toEqual([{ id: 'claude-sonnet-4-5', contextWindow: 200000 }]);
    expect(route.piai.userEndpoint).toBe(true);
    expect(route.piai.displayName).toBe('Anthropic');
  });

  it('the piai dict NEVER carries the credential value (the leak the audit hunts)', () => {
    const route = byokRoute(credential({ provider: 'anthropic', apiKey: 'sk-ant-canary-0001' }));
    expect(JSON.stringify(route.piai)).not.toContain('sk-ant-canary-0001');
  });

  it('an openai-completions credential rides the gateway adapter (no piai dict)', () => {
    const route = byokRoute(credential({ provider: 'deepseek' }));
    expect(route.piai).toBeUndefined();
    expect(route.api).toBe('openai-completions');
    const custom = byokRoute(credential({ provider: 'openai-compatible' }));
    expect(custom.piai).toBeUndefined();
  });

  it('a custom provider id defaults to the openai-completions flavor', () => {
    const route = byokRoute(credential({ provider: 'zai-coding-plan' }));
    expect(route.api).toBe('openai-completions');
    expect(route.piai).toBeUndefined();
  });
});

describe('mountPiAiProviders — the userEndpoint gate (the named exception)', () => {
  it('throws naming the route and the declaration a non-loopback row must carry', async () => {
    const providers = {
      anthropic: {
        displayName: 'Anthropic', api: 'anthropic-messages',
        baseURL: 'https://api.anthropic.com',
        models: [{ id: 'claude-sonnet-4-5' }],
      },
    };
    // The gate fires BEFORE the vendored plugin import — no pi-ai load here.
    await expect(mountPiAiProviders({}, providers))
      .rejects.toThrow(/anthropic[\s\S]*userEndpoint: true/);
  });

  it('a loopback row stays exempt (the probe face, byte-identical)', async () => {
    const providers = {
      'piai-test': {
        displayName: 'pi-ai test route', api: 'openai-completions',
        baseURL: 'http://127.0.0.1:9',
        models: [{ id: 'piai-mock-1' }],
      },
    };
    // Loopback passes the gate; the failure comes after it. WHICH failure is
    // environment-dependent — the vendored plugin import is unmapped on a
    // bare checkout (/dsh-llm-pi-ai|Failed to resolve|Cannot find/) while a
    // box that has materialized the closure resolves it and dies at the {}
    // ctx stub (ctx.plugin is not a function). What this face pins is the
    // gate's absence: the rejection never carries the userEndpoint demand.
    const err = await mountPiAiProviders({}, providers).then(
      () => { throw new Error('mountPiAiProviders resolved — the gate was expected to reject'); },
      (e) => e,
    );
    expect(String(err?.message ?? err)).not.toMatch(/userEndpoint: true/);
  });

});

describe('mountPiAiProviders gate — the unprovable shapes', () => {
  it('a row with NO baseURL names an unprovable (catalog-default) target — it declares too', async () => {
    const providers = {
      anthropic: {
        displayName: 'Anthropic', api: 'anthropic-messages',
        models: [{ id: 'claude-sonnet-4-5' }],
      },
    };
    // The catalog default is a real public origin; a row that names no
    // baseURL cannot prove loopback, so the declaration demand covers it.
    await expect(mountPiAiProviders({}, providers))
      .rejects.toThrow(/anthropic[\s\S]*userEndpoint: true/);
  });

  it('declares itself and the gate passes (fails later only on the plugin load)', async () => {
    const providers = {
      anthropic: {
        displayName: 'Anthropic', api: 'anthropic-messages',
        baseURL: 'https://api.anthropic.com', userEndpoint: true,
        models: [{ id: 'claude-sonnet-4-5' }],
      },
    };
    // Same environment split as the loopback face above: the gate passed,
    // and the later failure's flavor moves with the vendored closure's
    // presence — the pinned fact is the userEndpoint demand's absence.
    const err = await mountPiAiProviders({}, providers).then(
      () => { throw new Error('mountPiAiProviders resolved — the gate was expected to reject'); },
      (e) => e,
    );
    expect(String(err?.message ?? err)).not.toMatch(/userEndpoint: true/);
  });
});

describe('stagedRoute / mockRoute — the boot routes', () => {
  const stagedCfg = (extra = {}) => ({
    llmBaseUrl: 'https://api.example.com', llmApiKey: 'sk-1', llmModel: 'glm-5.3-flash',
    ...extra,
  });

  it('carries a staged llmContextWindow when runtime.config stages one', () => {
    expect(stagedRoute(stagedCfg({ llmContextWindow: 200000 })).contextWindow).toBe(200000);
  });

  it('stages no contextWindow by default (the historical shape)', () => {
    expect('contextWindow' in stagedRoute(stagedCfg())).toBe(false);
  });

  it('fails loud on a malformed staged llmContextWindow', () => {
    for (const garbage of ['x', 0, 5000000]) {
      expect(() => stagedRoute(stagedCfg({ llmContextWindow: garbage }))).toThrow(/llmContextWindow/);
    }
  });

  it('the mock route stays the byte-identical windowless shape', () => {
    expect('contextWindow' in mockRoute({ mockLlmUrl: 'http://127.0.0.1:17890', apiKey: 'k' })).toBe(false);
  });
});

describe('rebindLlmRoute / restoreBootRoute — the registered adapter', () => {
  it('registers an adapter whose resolveModel answers the resolved capacity', async () => {
    const capture = {};
    const route = await rebindLlmRoute(fakeCtx(capture), credential());
    expect(route.contextWindow).toBe(131072);
    const resolved = await capture.adapter.resolveModel('openai-compatible', 'glm-5.3-flash');
    expect(resolved.context).toEqual({ contextWindow: 131072 });
  });

  it('the credential override reaches the adapter through the rebind', async () => {
    const capture = {};
    await rebindLlmRoute(fakeCtx(capture), credential({ contextWindow: 65536 }));
    const resolved = await capture.adapter.resolveModel('openai-compatible', 'glm-5.3-flash');
    expect(resolved.context).toEqual({ contextWindow: 65536 });
  });

  it('a staged restore re-registers the staged capacity; a mock restore stays windowless', async () => {
    const staged = {};
    const stagedRouteCtx = fakeCtx(staged); // ONE ctx: the seam registries key on it
    registerBootRouteFactory(stagedRouteCtx, () => stagedRoute({
      llmBaseUrl: 'https://api.example.com', llmApiKey: 'sk-1', llmModel: 'm',
      llmContextWindow: 262144,
    }));
    restoreBootRoute(stagedRouteCtx);
    expect((await staged.adapter.resolveModel('openai-compatible', 'm')).context)
      .toEqual({ contextWindow: 262144 });

    const mock = {};
    const mockCtx = fakeCtx(mock);
    registerBootRouteFactory(mockCtx, () => mockRoute({
      mockLlmUrl: 'http://127.0.0.1:17890', apiKey: 'k',
    }));
    restoreBootRoute(mockCtx);
    expect('context' in (await mock.adapter.resolveModel('mock', 'mock-1'))).toBe(false);
  });
});

describe('the page-bundle mirror (onboarding-core.js)', () => {
  it('mirrors the runtime provider defaults and the grammar bound', () => {
    expect(PROVIDERS.deepseek.contextWindow).toBe(BYOK_PROVIDERS.deepseek.contextWindow);
    expect(PROVIDERS['openai-compatible'].contextWindow)
      .toBe(BYOK_PROVIDERS['openai-compatible'].contextWindow);
    expect(PAGE_CONTEXT_WINDOW_MAX).toBe(CONTEXT_WINDOW_MAX);
  });

  it('mirrors the anthropic and google rows line for line', () => {
    for (const id of ['anthropic', 'google']) {
      expect(PROVIDERS[id].baseURL).toBe(BYOK_PROVIDERS[id].baseURL);
      expect(PROVIDERS[id].model).toBe(BYOK_PROVIDERS[id].model);
      expect(PROVIDERS[id].contextWindow).toBe(BYOK_PROVIDERS[id].contextWindow);
    }
    expect(Object.keys(PROVIDERS)).toEqual(Object.keys(BYOK_PROVIDERS));
  });

  it('validateDraft accepts an absent or in-bound window, rejects garbage', () => {
    const draft = { provider: 'deepseek', baseURL: 'https://api.deepseek.com', apiKey: 'sk-1', model: 'deepseek-chat' };
    expect(validateDraft(draft)).toBeNull();
    expect(validateDraft({ ...draft, contextWindow: 131072 })).toBeNull();
    expect(validateDraft({ ...draft, contextWindow: 0 })?.field).toBe('contextWindow');
    expect(validateDraft({ ...draft, contextWindow: 1.5 })?.field).toBe('contextWindow');
    expect(validateDraft({ ...draft, contextWindow: PAGE_CONTEXT_WINDOW_MAX + 1 })?.field).toBe('contextWindow');
  });

  it('the draft fingerprint covers the window: a probe on one window cannot save another', () => {
    const draft = { provider: 'deepseek', baseURL: 'https://api.deepseek.com', apiKey: 'sk-1', model: 'deepseek-chat' };
    expect(draftFingerprint(draft)).not.toBe(draftFingerprint({ ...draft, contextWindow: 131072 }));
    expect(draftFingerprint({ ...draft, contextWindow: 65536 }))
      .not.toBe(draftFingerprint({ ...draft, contextWindow: 131072 }));
  });
});
