import { describe, it, expect, vi, beforeEach } from 'vitest';

// credentials-store.test.js — the `credentials` service the pi-ai section
// gate mounts (llm-piai-mount.js mountPiAiSection, gate-scoped: never on the
// default boot, whose pinned MOUNTED_SERVICES bytes the E2E manifests hold).
// The backend IS the wire store: the flat `{ref: value}` JSON document the
// settings-models handlers write through the gateway fs (web-write-llm.js
// STORE_PATH — the app-scope `credentials.json`), so pi-ai's resolveApiKey
// reads it FIRST (`ctx.get('credentials')` before the launch environment —
// vendored dsh-llm-pi-ai lib/index.js:2642-2648) and credentialStoreFrom's
// record face reads readRecord/listRecords (:2070-2099), whose
// nothing-stored answers the vendored reader maps to "not stored"
// (toPiCredential(undefined) → undefined, :2013-2014). What this suite pins:
// a stored ref shadows the staged route value, an absent file falls through
// quietly, a store that is not a JSON object fails loud NAMING the store
// (rule 5 — the exact refusal web-write-llm.js readStore keeps), and the
// record faces answer the empty shape whatever the file holds (a flat ref
// file holds no records).

// The gateway seam over one Map — the REAL gateway.js fsRead face shape:
// an absent path rejects GatewayError-shaped ({code:'io'},
// "cannot read <path>"), a hit answers {bytes, mtime}. credentials-store's
// readStore treats every rejection as an empty store (nothing configured
// through the wire yet).
const seam = vi.hoisted(() => {
  const workspace = new Map(); // 'app/credentials.json' → Uint8Array
  const reads = []; // every fsRead (scope, path) the store paid
  return { workspace, reads };
});

vi.mock('../../runtime/dsh/gateway.js', () => ({
  fsRead: vi.fn(async (scope, path) => {
    seam.reads.push([scope, path]);
    const bytes = seam.workspace.get(`${scope}/${path}`);
    if (!bytes) {
      const err = new Error(`cannot read ${path}`);
      err.name = 'GatewayError';
      err.code = 'io';
      err.primitive = 'fsRead';
      throw err;
    }
    return { bytes, mtime: new Date(0).toISOString() };
  }),
}));

// The dsh host's node:buffer carries the codec pair (upstream/shims/
// buffer.js); desktop node's does not. The sibling suite's patch — the
// device shim's exact semantics (TextEncoder/TextDecoder over Uint8Array).
vi.mock('node:buffer', async (importOriginal) => ({
  ...await importOriginal(),
  encodeUtf8: (text) => new TextEncoder().encode(String(text ?? '')),
  decodeUtf8: (bytes) => new TextDecoder().decode(bytes),
}));

const { CredentialsStore } =
  await import('../../runtime/dsh/upstream/credentials-store.js');
const { Context } = await import('@deepseek-ai/cordis');

const encodeStore = (value) =>
  new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

/** The store mounted exactly as the pi-ai section gate mounts it
 * (mountPiAiSection's `new CredentialsStore(ctx)` — the Service base
 * SELF-PROVIDES as "credentials" on the vendored cordis@4.0.2; an explicit
 * ctx.set/provide of the name throws instead). A fresh Context per test
 * isolates the service registry, the way boot's own `new Context()` starts. */
const mountedStore = () => {
  const ctx = new Context();
  const store = new CredentialsStore(ctx);
  return { ctx, store, served: ctx.get('credentials') };
};

beforeEach(() => {
  seam.workspace.clear();
  seam.reads.length = 0;
});

describe('the mounted face registers as "credentials"', () => {
  it('the Service base self-provides — ctx.get("credentials") answers the store', () => {
    // The join pi-ai reads by name (lib/index.js:2644 `ctx.get("credentials")`)
    // and the gate's own rule-5 demand proves post-mount
    // (llm-piai-mount.js: `ctx.get('credentials') instanceof CredentialsStore`).
    // cordis hands the service back through its registry wrapper, so the
    // honest pin is instanceof + the registered name + the faces pi-ai calls.
    const { served } = mountedStore();
    expect(served).toBeInstanceOf(CredentialsStore);
    expect(served.name).toBe('credentials');
    expect(typeof served.resolve).toBe('function');
    expect(typeof served.readRecord).toBe('function');
    expect(typeof served.listRecords).toBe('function');
  });
});

describe('resolve — the wire store face (web-write-llm.js STORE_PATH)', () => {
  it('a stored ref answers {value} — the shadow pi-ai reads before process env', async () => {
    seam.workspace.set(
      'app/credentials.json',
      encodeStore({ DEEPSEEK_API_KEY: 'sk-canary-0001' }),
    );
    const { store } = mountedStore();
    await expect(store.resolve('DEEPSEEK_API_KEY'))
      .resolves.toEqual({ value: 'sk-canary-0001' });
    // The read rode the app-scope credentials.json — the same file the wire
    // write face serves, so a page-saved key shadows the staged route value.
    expect(seam.reads).toEqual([['app', 'credentials.json']]);
  });

  it('an absent file answers undefined (pi-ai falls through to the launch env)', async () => {
    const { store } = mountedStore();
    await expect(store.resolve('ANTHROPIC_API_KEY')).resolves.toBeUndefined();
    expect(seam.reads).toEqual([['app', 'credentials.json']]);
  });

  it('an unknown ref in an existing store answers undefined — never the store object', async () => {
    seam.workspace.set(
      'app/credentials.json',
      encodeStore({ DEEPSEEK_API_KEY: 'sk-canary-0001' }),
    );
    const { store } = mountedStore();
    await expect(store.resolve('GOOGLE_API_KEY')).resolves.toBeUndefined();
  });

  it('an out-of-grammar ref fails loud naming it (rule 5 — the write face refuses these, so one arriving here is a broken caller)', async () => {
    const { store } = mountedStore();
    for (const ref of ['has space', 'sk-live-abc', 'lower-dash', 42, undefined]) {
      await expect(store.resolve(ref), `ref=${JSON.stringify(ref)}`)
        .rejects.toThrow(/resolve ref must match/);
    }
  });
});

describe('a store that is not a JSON object fails loud naming the store (rule 5)', () => {
  it('null, an array, a bare string, and unparseable bytes all name credentials.json', async () => {
    const { store } = mountedStore();
    for (const [label, bytes] of [
      ['null', encodeStore(null)],
      ['array', encodeStore(['DEEPSEEK_API_KEY'])],
      ['string', encodeStore('sk-text')],
      ['broken json', new TextEncoder().encode('{"DEEPSEEK_API_KEY":')],
    ]) {
      seam.workspace.set('app/credentials.json', bytes);
      await expect(store.resolve('DEEPSEEK_API_KEY'), label)
        .rejects.toThrow(/the credential store credentials\.json is unreadable/);
    }
  });

  it('the non-object legs say why: the store is not a JSON object', async () => {
    const { store } = mountedStore();
    for (const bytes of [encodeStore(null), encodeStore(['x']), encodeStore('sk-text')]) {
      seam.workspace.set('app/credentials.json', bytes);
      await expect(store.resolve('DEEPSEEK_API_KEY'))
        .rejects.toThrow(/not a JSON object/);
    }
  });
});

describe("credentialStoreFrom's record faces — a flat ref file holds no records", () => {
  it('readRecord() answers undefined (toPiCredential(undefined) → "not stored")', async () => {
    seam.workspace.set(
      'app/credentials.json',
      encodeStore({ DEEPSEEK_API_KEY: 'sk-canary-0001' }),
    );
    const { store } = mountedStore();
    await expect(store.readRecord('credentials/llm-pi-ai/deepseek'))
      .resolves.toBeUndefined();
  });

  it('listRecords() answers [] — even with refs stored', async () => {
    seam.workspace.set(
      'app/credentials.json',
      encodeStore({ DEEPSEEK_API_KEY: 'sk-canary-0001' }),
    );
    const { store } = mountedStore();
    await expect(store.listRecords()).resolves.toEqual([]);
  });
});
