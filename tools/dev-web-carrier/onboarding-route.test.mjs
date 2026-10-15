// dsh:logging-exempt (test file: assertions ARE the product)
/**
 * onboarding-route.test.mjs — the dev-web-carrier's BYOK onboarding legs'
 * own net (tools/dev-web-carrier/onboarding-route.mjs).
 *
 * SCOPE (honest boundary, the plugins-route.test.mjs precedent): this file
 * covers the PURE, exported face — createOnboarding, statusValue,
 * onboardingOutcome, validateCredential — the in-memory port of the runtime's
 * coverage legs (web-write-onboarding.js over llm-route.js). The server
 * faces that mount it (dev-carrier.mjs starts a server at import;
 * next-mode.mjs likewise) are not importable in tests; their envelopes are
 * pinned by the harmony seat's recorded wire instead
 * (hosts/harmony/artifacts/shell-turn/credential-wire.txt).
 *
 * Behaviors pinned: the status shapes (mock boot face, byok after save,
 * NEVER the key or contextWindow on the wire), the save flip (valid grammar
 * stored, bad grammar rejected with the wire leg's own message shape and the
 * keychain unchanged), the clear reset (idempotent, like the B29 runtime
 * leg), and the fall-through (unknown onboarding verbs stay the carrier's
 * gateway/unimplemented business).
 */
import { describe, expect, it } from 'vitest';
import {
  createOnboarding, onboardingOutcome, statusValue, validateCredential,
} from './onboarding-route.mjs';

/** The canonical valid draft (the page form's DeepSeek preset shape). */
const validDraft = () => ({
  provider: 'deepseek',
  baseURL: 'https://api.deepseek.com',
  apiKey: 'sk-test-0123456789',
  model: 'deepseek-chat',
});

describe('status: the boot face', () => {
  it('a fresh carrier answers the runtime mockRoute shape (mode mock shows the panel)', () => {
    const status = statusValue(createOnboarding());
    expect(status).toEqual({ mode: 'mock', provider: 'mock', model: 'mock-1' });
  });

  it('no key material ever rides the wire, in either mode', () => {
    const state = createOnboarding();
    expect(JSON.stringify(statusValue(state))).not.toContain('apiKey');
    onboardingOutcome(state, 'onboarding/save', validDraft());
    expect(JSON.stringify(statusValue(state))).not.toContain('apiKey');
    expect(JSON.stringify(statusValue(state))).not.toContain('sk-test');
  });
});

describe('save: the flip to byok', () => {
  it('a valid draft answers {} and status flips to byok with provider/baseURL/model', () => {
    const state = createOnboarding();
    expect(onboardingOutcome(state, 'onboarding/save', validDraft()))
      .toEqual({ ok: true, value: {} });
    expect(statusValue(state)).toEqual({
      mode: 'byok',
      provider: 'deepseek',
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    });
  });

  it('a carried contextWindow is stored but never echoed back', () => {
    const state = createOnboarding();
    const draft = { ...validDraft(), contextWindow: 65536 };
    expect(onboardingOutcome(state, 'onboarding/save', draft).ok).toBe(true);
    const status = statusValue(state);
    expect(Object.hasOwn(status, 'contextWindow')).toBe(false);
    // the keychain itself holds it (the runtime encodeCredential shape)
    expect(state.keychain.contextWindow).toBe(65536);
  });

  it('an absent contextWindow stays absent in the keychain (re-defaults downstream)', () => {
    const state = createOnboarding();
    onboardingOutcome(state, 'onboarding/save', validDraft());
    expect(Object.hasOwn(state.keychain, 'contextWindow')).toBe(false);
  });

  it('a save over an existing key replaces it (the manage face re-save path)', () => {
    const state = createOnboarding();
    onboardingOutcome(state, 'onboarding/save', validDraft());
    onboardingOutcome(state, 'onboarding/save', {
      provider: 'openai-compatible',
      baseURL: 'http://127.0.0.1:62626',
      apiKey: 'sk-second',
      model: 'mock-1',
    });
    expect(statusValue(state)).toEqual({
      mode: 'byok', provider: 'openai-compatible',
      baseURL: 'http://127.0.0.1:62626', model: 'mock-1',
    });
  });
});

describe('save: bad requests rejected (the wire leg grammar)', () => {
  const badDrafts = [
    ['non-object args', null, 'credential'],
    ['array args', [1, 2], 'credential'],
    ['unknown provider', { ...validDraft(), provider: 'DeepSeek' }, 'provider'],
    ['provider with no expressible ref', { ...validDraft(), provider: 'a-b!' }, 'provider'],
    ['non-http baseURL', { ...validDraft(), baseURL: 'ftp://x.example' }, 'baseURL'],
    ['empty apiKey', { ...validDraft(), apiKey: '' }, 'apiKey'],
    ['over-long apiKey', { ...validDraft(), apiKey: 'k'.repeat(513) }, 'apiKey'],
    ['empty model', { ...validDraft(), model: '' }, 'model'],
    ['fractional contextWindow', { ...validDraft(), contextWindow: 1.5 }, 'contextWindow'],
    ['zero contextWindow', { ...validDraft(), contextWindow: 0 }, 'contextWindow'],
    ['over-max contextWindow', { ...validDraft(), contextWindow: 4000001 }, 'contextWindow'],
  ];
  for (const [name, draft, field] of badDrafts) {
    it(`${name} → gateway/bad-request naming the field`, () => {
      const state = createOnboarding();
      const outcome = onboardingOutcome(state, 'onboarding/save', draft);
      expect(outcome.ok).toBe(false);
      expect(outcome.error.code).toBe('gateway/bad-request');
      expect(outcome.error.message.startsWith(`onboarding/save: ${field} — `)).toBe(true);
      expect(outcome.error.details).toEqual({});
      // a rejected save must not touch the keychain
      expect(statusValue(state)).toEqual({ mode: 'mock', provider: 'mock', model: 'mock-1' });
    });
  }
});

describe('clear: the reset (B29 semantics)', () => {
  it('clear deletes the ref and status returns to the mock face', () => {
    const state = createOnboarding();
    onboardingOutcome(state, 'onboarding/save', validDraft());
    expect(onboardingOutcome(state, 'onboarding/clear', {}))
      .toEqual({ ok: true, value: {} });
    expect(statusValue(state)).toEqual({ mode: 'mock', provider: 'mock', model: 'mock-1' });
  });

  it('clear is idempotent — clearing an unset ref is fine', () => {
    const state = createOnboarding();
    expect(onboardingOutcome(state, 'onboarding/clear', {}).ok).toBe(true);
    expect(onboardingOutcome(state, 'onboarding/clear', {}).ok).toBe(true);
    expect(statusValue(state)).toEqual({ mode: 'mock', provider: 'mock', model: 'mock-1' });
  });

  it('after clear a re-save works (the panel setup → manage → clear → setup cycle)', () => {
    const state = createOnboarding();
    onboardingOutcome(state, 'onboarding/save', validDraft());
    onboardingOutcome(state, 'onboarding/clear', {});
    onboardingOutcome(state, 'onboarding/save', validDraft());
    expect(statusValue(state).mode).toBe('byok');
  });
});

describe('dispatch boundaries', () => {
  it('an unknown onboarding verb falls through (null → the carrier answers unimplemented)', () => {
    const state = createOnboarding();
    expect(onboardingOutcome(state, 'onboarding/test', {})).toBeNull();
    expect(onboardingOutcome(state, 'onboarding/unknown', {})).toBeNull();
  });

  it('status tolerates absent args (the page rpc sends payload {})', () => {
    expect(onboardingOutcome(createOnboarding(), 'onboarding/status', undefined).ok).toBe(true);
  });
});

describe('validateCredential: the runtime grammar mirror', () => {
  it('accepts the page-form DeepSeek preset and an openai-compatible row', () => {
    expect(validateCredential(validDraft())).toBeNull();
    expect(validateCredential({
      provider: 'openai-compatible', baseURL: 'http://127.0.0.1:9999',
      apiKey: 'k', model: 'm',
    })).toBeNull();
  });

  it('keeps the boundary values the grammar allows (512-char key, 128-char model, 4M window)', () => {
    expect(validateCredential({ ...validDraft(), apiKey: 'k'.repeat(512) })).toBeNull();
    expect(validateCredential({ ...validDraft(), model: 'm'.repeat(128) })).toBeNull();
    expect(validateCredential({ ...validDraft(), contextWindow: 4000000 })).toBeNull();
  });
});
