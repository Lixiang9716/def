// dsh:logging-exempt (test: the verdict is the assertion output)
/**
 * producer-registry.test.js — the producer registry's unit contract
 * (proposal 2026-10-24, producer-registry v1): the record shape, the
 * reason policy, and the honest mock face's three join legs. The E2E legs
 * (onboarding-flow 15/15) pin the live bind/rebind/restore rows; this
 * suite pins the shapes those rows are built from.
 */
import { describe, it, expect } from 'vitest';
import {
  producerRecord, reasonOfRoute, mockRoute, stagedRoute, byokRoute,
} from '../../runtime/dsh/upstream/llm-route.js';

const MOCK = mockRoute({ mockLlmUrl: 'http://127.0.0.1:17890/x', apiKey: 'k' });

describe('the producer record', () => {
  it('a mock route carries its census answer: id, face, kind, reason', () => {
    expect(producerRecord(MOCK, reasonOfRoute(MOCK))).toEqual({
      id: 'mock:loopback',
      face: 'llm',
      kind: 'mock',
      provider: 'mock',
      model: 'mock-1',
      userEndpoint: false,
      reason: 'no-credential-fallback',
    });
  });

  it('a staged route answers staged-config; a byok route answers byok-credential', () => {
    const staged = stagedRoute({
      llmBaseUrl: 'https://api.example.com/v1', llmApiKey: 'k',
      llmModel: 'm', llmProvider: 'acme',
    });
    expect(reasonOfRoute(staged)).toBe('staged-config');
    expect(producerRecord(staged, 'staged-config').id).toBe('staged:default');
    const byok = byokRoute({
      baseURL: 'https://api.deepseek.com/v1', apiKey: 'k',
      provider: 'deepseek', model: 'deepseek-chat',
    });
    expect(reasonOfRoute(byok)).toBe('byok-credential');
    expect(producerRecord(byok, 'byok-credential').id).toBe('byok:dsh.llm/byok-route');
    expect(producerRecord(byok, 'byok-credential').userEndpoint).toBe(true);
  });

  it('the record NEVER carries the credential material', () => {
    const byok = byokRoute({
      baseURL: 'https://api.deepseek.com/v1', apiKey: 'sk-secret-0001',
      provider: 'deepseek', model: 'deepseek-chat',
    });
    const record = JSON.stringify(producerRecord(byok, 'byok-credential'));
    expect(record.includes('sk-secret-0001')).toBe(false);
  });
});
