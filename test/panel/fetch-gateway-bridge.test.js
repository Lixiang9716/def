import { describe, it, expect, vi, afterEach } from 'vitest';

// The fetch→gateway bridge's takeover predicate is a CROSS-MODULE contract:
// the bridge takes over a non-loopback dial ONLY when the shim's fail-loud
// fetch rejects with ITS OWN literal ('…no network surface…', web-fetch-
// values.js). This suite pins that seam BEHAVIORALLY — the real
// installWebFetchValues face is installed (fetch deleted first, so the
// absence rule lets it), the real bridge is installed over it, and the
// gateway httpFetch is a mock. If either side's string drifts, the takeover
// silently dies (fail-closed) and the first test here reddens.

vi.mock('../../runtime/dsh/gateway.js', () => ({
  httpFetch: vi.fn(),
  keychainGet: vi.fn(async () => null),
}));

const { installWebFetchValues } =
  await import('../../runtime/dsh/upstream/shims/web-fetch-values.js');
const { installFetchGatewayBridge } =
  await import('../../runtime/dsh/upstream/fetch-gateway-bridge.js');
const { httpFetch } = await import('../../runtime/dsh/gateway.js');

// The bridge installs ONCE per process (module state; a second call only
// unions the label hosts) — so this suite installs one face for all tests
// and never restores the host's real fetch (node's own fetch is not used
// here again).
delete globalThis.fetch;
installWebFetchValues();
installFetchGatewayBridge({ hosts: ['api.example.com'] });
const fetch = globalThis.fetch;
expect(typeof fetch).toBe('function');

afterEach(() => {
  vi.clearAllMocks();
});

describe('the bridge takeover rides the fail-loud literal (cross-module pin)', () => {
  it('a non-loopback dial crosses to the gateway httpFetch and returns a Response', async () => {
    httpFetch.mockResolvedValue({
      status: 418,
      headers: { 'content-type': 'application/json' },
      body: { [Symbol.asyncIterator]: () => ({ next: async () => ({ value: undefined, done: true }) }) },
      abort: () => {},
    });
    const response = await fetch('https://api.example.com/v1/messages', { method: 'POST' });
    expect(httpFetch).toHaveBeenCalledTimes(1);
    expect(httpFetch.mock.calls[0][0]).toBe('https://api.example.com/v1/messages');
    expect(response.status).toBe(418);
  });

  it('a LOOPBACK dial never bridges (the determinism boundary stays loud)', async () => {
    await expect(fetch('http://127.0.0.1:9/v1', { method: 'GET' }))
      .rejects.toThrow(/no network surface/);
    expect(httpFetch).not.toHaveBeenCalled();
  });

  it('an undeclared-host dial still rides the process-wide bridge (the honest scope)', async () => {
    httpFetch.mockResolvedValue({
      status: 200, headers: {},
      body: { [Symbol.asyncIterator]: () => ({ next: async () => ({ value: undefined, done: true }) }) },
      abort: () => {},
    });
    const response = await fetch('https://other-host.example/v1');
    expect(httpFetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });

  it('a second install is idempotent (hosts union, the face keeps working)', async () => {
    const before = globalThis.fetch;
    const second = installFetchGatewayBridge({ hosts: ['api.anthropic.com'] });
    expect(second.installed).toBe(true);
    expect(second.hosts).toEqual(['api.anthropic.com', 'api.example.com']);
    expect(globalThis.fetch).toBe(before);
    httpFetch.mockResolvedValue({
      status: 200, headers: {},
      body: { [Symbol.asyncIterator]: () => ({ next: async () => ({ value: undefined, done: true }) }) },
      abort: () => {},
    });
    const response = await fetch('https://api.example.com/v1');
    expect(response.status).toBe(200);
  });
});
