import { describe, it, expect, vi, afterEach } from 'vitest';

// The section-write hook is a CROSS-MODULE contract: makeSettingsWrite
// (web-write-settings.js) must arm the fetch→gateway egress bridge when —
// and only when — a COMMITTED write lands in the pi-ai section
// (PIAI_SECTION_NS = 'llm-pi-ai') whose NEW row set names a non-loopback
// endpoint. This suite pins that seam BEHAVIORALLY: the real hook chain runs
// (makeSettingsWrite → installEgressBridgeForSection → installEgressBridge →
// the real fetch-gateway-bridge install over the real web-fetch-values face),
// and only the two process edges are doubles — the gateway primitive
// (mocked; the negative arms need no dial) and the settings service (the
// three faces the chain consumes: `get`, the rebind before-capture's face;
// `mutate`, the wire op shape the Models page's pathOps sends; `describe`,
// the wireNamespaceView source, answered synchronously like the real
// service). The bridge install is PROCESS-global (fetch-gateway-bridge.js
// module state; the honest-scope note at its install face), so the negative
// groups run FIRST and the arming group runs LAST — the bridge never comes
// back down.

vi.mock('../../runtime/dsh/gateway.js', () => ({
  httpFetch: vi.fn(),
  keychainGet: vi.fn(async () => null),
  fsRead: vi.fn(async () => {
    throw new Error('cannot read credentials.json');
  }),
}));

// The dsh host's node:buffer is the repo's own shim, which carries the codec
// pair encodeUtf8/decodeUtf8; desktop node's does not. The module graph here
// pulls web-write-llm.js and credentials-store.js, both of which import the
// pair — the same patch the llm-route-context-window suite keeps.
vi.mock('node:buffer', async (importOriginal) => ({
  ...await importOriginal(),
  encodeUtf8: (text) => new TextEncoder().encode(String(text ?? '')),
  decodeUtf8: (bytes) => new TextDecoder().decode(bytes),
}));

const { installWebFetchValues } =
  await import('../../runtime/dsh/upstream/shims/web-fetch-values.js');
const { makeSettingsWrite } =
  await import('../../runtime/dsh/upstream/web-write-settings.js');
const { PIAI_SECTION_NS } =
  await import('../../runtime/dsh/upstream/llm-piai-mount.js');
const { fetchGatewayBridgeInstalled, fetchGatewayBridgeHosts } =
  await import('../../runtime/dsh/upstream/fetch-gateway-bridge.js');
const { httpFetch } = await import('../../runtime/dsh/gateway.js');

// The bridge wraps WHATEVER fetch global is live (installFetchGatewayBridge
// refuses a missing one) — install the REAL shim face first so the wrapped
// chain is the device shape (the fetch-gateway-bridge suite's precedent).
// The face is never restored: like that suite, node's own fetch is not used
// again in this file.
delete globalThis.fetch;
installWebFetchValues();
const plainFetch = globalThis.fetch;
expect(typeof plainFetch).toBe('function');

// The unified logger's sink (runtime/dsh/logger.js binds per call): the
// honesty line ('llm/piai-bridge', the rebind leg's precedent in
// llm-piai-mount.js) is asserted through it — every log assertion rides the
// one sink, never a console spy.
const sinkLines = [];
const collectSink = () => {
  sinkLines.length = 0;
  globalThis.__DSH_LOG_SINK__ = (line) => sinkLines.push(JSON.parse(line));
};
const bridgeLines = () =>
  sinkLines.filter((line) => line.message === 'llm/piai-bridge');

afterEach(() => {
  delete globalThis.__DSH_LOG_SINK__;
  vi.clearAllMocks();
});

/** The settings double: the section store under its namespace keys, with the
 * faces the hook chain touches. `mutate` applies the wire ops verbatim
 * ({op:'set'|'unset', path, value?} — the Models page's pathOps shape) so
 * `get` answers the COMMITTED section exactly as the vendored service would
 * hand it to the bridge re-arm. `describe` is synchronous — the real
 * service's is, and makeSettingsWrite maps its result without awaiting. */
const fakeSettings = () => {
  const sections = new Map();
  let revision = 0;
  const parentOf = (value, path) => {
    let node = value;
    for (const key of path.slice(0, -1)) {
      if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
      node = node[key];
    }
    return node;
  };
  const leaf = (path) => path[path.length - 1];
  return {
    get: (ns) => sections.get(ns),
    writable: true,
    mutate: async (ns, ops) => {
      const value = sections.get(ns) ?? {};
      for (const op of ops) {
        if (op.op === 'set') parentOf(value, op.path)[leaf(op.path)] = op.value;
        else if (op.op === 'unset') delete parentOf(value, op.path)[leaf(op.path)];
        else throw new Error(`fake settings: unknown op ${JSON.stringify(op.op)}`);
      }
      revision += 1;
      sections.set(ns, value);
      return revision;
    },
    describe: () => [...sections.entries()].map(([ns, value]) => ({
      ns, value, applies: true, secrets: [], revision,
    })),
  };
};

/** The write leg's own run (web-write.js's settings/mutate wiring, verbatim
 * shape): forward the args onto the service's mutate. */
const runMutate = (settings, args) =>
  settings.mutate(String(args.ns), args.ops, args.expectedRevision);

/** One write fn over a settings double — the hook's two other collaborators
 * are fixed: the ctx face reads the double, and the namespace guard is a
 * no-op (registration is the guard's own concern, not this hook's). */
const writeFn = (settings, run = runMutate) => makeSettingsWrite(
  { get: (name) => (name === 'settings' ? settings : undefined) },
  async () => {},
  run,
);

/** The rows the section writes commit (the plugin's own row shape) and the
 * one op the Models page sends for a row: set providers.<route>. */
const LOOPBACK_ROW = { api: 'openai-completions', baseURL: 'http://127.0.0.1:45459/v1' };
const BYOK_ROW = {
  api: 'anthropic-messages', baseURL: 'https://api.byok.example.com/v1', userEndpoint: true,
};
const SECOND_ROW = { api: 'openai-responses', baseURL: 'https://api.second.example/v1' };
const setRow = (route, row) => ({ op: 'set', path: ['providers', route], value: row });

/** One served gateway dial (the fetch-gateway-bridge suite's response shape). */
const serveGateway = () => httpFetch.mockResolvedValue({
  status: 200, headers: {},
  body: { [Symbol.asyncIterator]: () => ({ next: async () => ({ value: undefined, done: true }) }) },
  abort: () => {},
});

/** The negative invariant: nothing armed, the shim face untouched, no
 * honesty line on the sink. */
const expectUnarmed = () => {
  expect(fetchGatewayBridgeInstalled()).toBe(false);
  expect(globalThis.fetch).toBe(plainFetch);
  expect(bridgeLines()).toEqual([]);
};

import { existsSync } from 'node:fs';

// This suite boots the REAL pi-ai mount: it needs the materialized vendored
// closure (external/ensure-dsh.sh / build/ensure-seat.sh). On bare checkouts
// (fresh clone, the gov pre-push copy) it skip-louds — the same honest
// posture as the device legs, never a fake pass.
const CLOSURE_READY = existsSync(new URL('../../runtime/dsh/vendor/npm/cordis@4.0.2/lib/index.js', import.meta.url));
const describeGate = CLOSURE_READY ? describe : describe.skip;
if (!CLOSURE_READY) {
  console.warn('[llm-piai-section-gate] vendored closure not materialized — run external/ensure-dsh.sh; skipping the real-mount suite');
}

describe('a settings write OUTSIDE the pi-ai section', () => {
  it('never arms the bridge', async () => {
    collectSink();
    const view = await writeFn(fakeSettings())({ ns: 'ui-onboarding', ops: [
      { op: 'set', path: ['welcomeNoticeVersion'], value: 'v2' },
    ] });
    expect(view.ns).toBe('ui-onboarding');
    expect(view.value).toEqual({ welcomeNoticeVersion: 'v2' });
    expectUnarmed();
  });
});

describe('a pi-ai section write that arms nothing', () => {
  it('a LOOPBACK-ONLY row set keeps the bridge off (the E2E determinism boundary)', async () => {
    collectSink();
    const view = await writeFn(fakeSettings())({
      ns: PIAI_SECTION_NS, ops: [setRow('local-mock', LOOPBACK_ROW)],
    });
    // the write itself succeeds — a loopback row is legal, it just arms nothing
    expect(view.ns).toBe(PIAI_SECTION_NS);
    expect(view.value.providers['local-mock']).toEqual(LOOPBACK_ROW);
    expectUnarmed();
  });

  it('a REJECTED write arms nothing (the hook runs only after run resolved)', async () => {
    collectSink();
    const settings = fakeSettings();
    const write = writeFn(settings, () => {
      throw new Error('settings/conflict: stale revision');
    });
    await expect(write({ ns: PIAI_SECTION_NS, ops: [setRow('byok', BYOK_ROW)] }))
      .rejects.toThrow('stale revision');
    expect(settings.get(PIAI_SECTION_NS)).toBeUndefined();
    expectUnarmed();
  });
});

describe('a pi-ai section write naming a NON-LOOPBACK baseURL', () => {
  // ONE section across the two writes: the second write lands beside the
  // first row, so the re-arm reads the accumulated row set — the real shape.
  const settings = fakeSettings();

  it('arms the bridge with that hostname, logs the honesty line, and the face dials the gateway', async () => {
    collectSink();
    const view = await writeFn(settings)({ ns: PIAI_SECTION_NS, ops: [setRow('byok', BYOK_ROW)] });
    expect(view.ns).toBe(PIAI_SECTION_NS);
    expect(view.value.providers.byok).toEqual(BYOK_ROW);
    // process-level: the wrapped face replaced the shim face, labelled with
    // the hostname the committed row declared
    expect(fetchGatewayBridgeInstalled()).toBe(true);
    expect(globalThis.fetch).not.toBe(plainFetch);
    expect(globalThis.fetch.__dshFetchGatewayBridge).toBe(true);
    expect(fetchGatewayBridgeHosts()).toEqual(['api.byok.example.com']);
    // the honesty line rides the unified logger (the rebind leg's precedent)
    expect(bridgeLines()).toEqual([expect.objectContaining({
      level: 'info', module: 'dsh.llm-piai-mount',
      data: [{ installed: true, hosts: ['api.byok.example.com'] }],
    })]);
    // and the armed face really carries the declared host across the gateway
    serveGateway();
    const response = await globalThis.fetch('https://api.byok.example.com/v1/messages', { method: 'POST' });
    expect(httpFetch).toHaveBeenCalledTimes(1);
    expect(httpFetch.mock.calls[0][0]).toBe('https://api.byok.example.com/v1/messages');
    expect(response.status).toBe(200);
  });

  it('a SECOND write re-arms against the new row set (hosts union, never a re-wrapped face)', async () => {
    collectSink();
    const wrapped = globalThis.fetch;
    await writeFn(settings)({ ns: PIAI_SECTION_NS, ops: [setRow('second', SECOND_ROW)] });
    expect(settings.get(PIAI_SECTION_NS).providers).toEqual({ byok: BYOK_ROW, second: SECOND_ROW });
    expect(globalThis.fetch).toBe(wrapped);
    expect(fetchGatewayBridgeHosts()).toEqual(['api.byok.example.com', 'api.second.example']);
    expect(bridgeLines()).toEqual([expect.objectContaining({
      data: [{ installed: true, hosts: ['api.byok.example.com', 'api.second.example'] }],
    })]);
  });
});
