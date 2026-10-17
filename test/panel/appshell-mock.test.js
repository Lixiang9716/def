// Contract tests for lib/mock.js — the ONE place the data source is decided.
//   FIXTURES        the three demo specs must be validator-clean (golden specs)
//   fixtureKeys     exactly the three bundled apps, no more
//   mockSpec        unknown key -> null (never a partial spec, never a throw)
//   modeAnnounce    mock -> warn (impossible to miss), real -> info
// MODE is frozen at import time from DSH_APPSHELL_MODE (mock.js:16), so the
// announce legs each re-evaluate the module via vi.stubEnv + dynamic import().
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FIXTURES, mockSpec, fixtureKeys } from '../../system-plugins/dsh-appshell/lib/mock.js';
import { validate } from '../../system-plugins/dsh-appshell/lib/validate.js';

const MOCK_MOD = () => import('../../system-plugins/dsh-appshell/lib/mock.js');

/** Fake log per the contract: warn/info record their payloads for assertion. */
function fakeLog() {
  const calls = { warn: [], info: [] };
  return {
    calls,
    warn: (e) => calls.warn.push(e),
    info: (e) => calls.info.push(e),
  };
}

describe('mock.js FIXTURES — each demo spec passes the app-shell/0.9 validator', () => {
  for (const key of ['wechat', 'netease', 'alipay']) {
    it(`fixture "${key}" validates ok=true with no errors and a non-null expansion`, () => {
      expect(FIXTURES[key], `FIXTURES.${key} must exist`).toBeDefined();
      const r = validate(FIXTURES[key]);
      expect(r.ok, JSON.stringify(r.errors)).toBe(true);
      expect(r.errors).toHaveLength(0);
      expect(r.expanded).not.toBeNull();
    });
  }
});

describe('mock.js fixture registry shape', () => {
  it('fixtureKeys returns exactly the three keys wechat/netease/alipay', () => {
    const keys = fixtureKeys();
    expect(keys).toHaveLength(3);
    expect([...keys].sort()).toEqual(['alipay', 'netease', 'wechat']);
  });

  it('mockSpec with an unknown key returns null (empty string, missing, undefined)', () => {
    expect(mockSpec('nope')).toBeNull();
    expect(mockSpec('')).toBeNull();
    expect(mockSpec(undefined)).toBeNull();
  });

  it('mockSpec with a known key returns that exact fixture object', () => {
    expect(mockSpec('wechat')).toBe(FIXTURES.wechat);
    expect(mockSpec('alipay')).toBe(FIXTURES.alipay);
  });
});

describe('mock.js MODE frozen at import — modeAnnounce picks warn vs info', () => {
  beforeEach(() => {
    vi.resetModules(); // MODE is computed at module evaluation; force re-evaluation
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('DSH_APPSHELL_MODE=mock: MODE="mock" and announce goes to log.warn with mode:"mock"', async () => {
    vi.stubEnv('DSH_APPSHELL_MODE', 'mock');
    const { MODE, modeAnnounce } = await MOCK_MOD();
    expect(MODE).toBe('mock');
    const log = fakeLog();
    modeAnnounce(log);
    expect(log.calls.warn).toHaveLength(1);
    expect(log.calls.warn[0]).toMatchObject({ event: 'appshell.mode', mode: 'mock' });
    expect(log.calls.info).toHaveLength(0);
  });

  it('DSH_APPSHELL_MODE unset: MODE="real" and announce goes to log.info with mode:"real"', async () => {
    vi.stubEnv('DSH_APPSHELL_MODE', undefined); // stubEnv(undefined) deletes the var
    const { MODE, modeAnnounce } = await MOCK_MOD();
    expect(MODE).toBe('real');
    const log = fakeLog();
    modeAnnounce(log);
    expect(log.calls.info).toHaveLength(1);
    expect(log.calls.info[0]).toMatchObject({ event: 'appshell.mode', mode: 'real' });
    expect(log.calls.warn).toHaveLength(0);
  });

  it('DSH_APPSHELL_MODE="production" (anything but mock): MODE="real", announce is info', async () => {
    vi.stubEnv('DSH_APPSHELL_MODE', 'production');
    const { MODE, modeAnnounce } = await MOCK_MOD();
    expect(MODE).toBe('real');
    const log = fakeLog();
    modeAnnounce(log);
    expect(log.calls.warn).toHaveLength(0);
    expect(log.calls.info).toHaveLength(1);
    expect(log.calls.info[0].mode).toBe('real');
  });
});
