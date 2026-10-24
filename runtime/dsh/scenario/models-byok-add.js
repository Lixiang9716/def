// dsh:logging-exempt (probe: its verdict output IS the product)
/** models-byok-add.js — the CLI proof for the models 设置页's BYOK ADD flow
 * (scenario `models.byok-add`): the page adds a NEW provider through the
 * pi-ai SECTION — the vendored multi-protocol family's settings namespace —
 * answered at the same wire boundary the page uses (the write surface with
 * `fullCoverage: true`), in the page's REAL save order.
 *
 * The boot carries the GATED `llm.piaiSection` (upstream/boot.js: the pi-ai
 * section over an EMPTY base — the catalog directory, the "llm-pi-ai"
 * settings section, and the credentials service; zero staged routes) plus
 * the undialed gateway route (provider `mock`, never in the pi-ai catalog,
 * so the section mount cannot collide with it).
 *
 * Flow — every leg is a page wire call, in the save order the page uses:
 *
 *   collision (a SECOND, throwaway boot): a gateway route named `deepseek`
 *   plus `piaiSection: true` — the plugin declares every installed catalog
 *   id the moment it mounts, and the vendored registry refuses a provider
 *   the live route's row already holds (LlmError DUPLICATE_DIRECTORY, vendored
 *   llm lib :1897). The mount must fail loud naming BOTH sides (the colliding
 *   catalog id and the live row's settings ns) — never a quiet partial mount.
 *   settings/describe           → the llm-pi-ai namespace registered (base
 *                                 layer `providers: {}`, user layer free),
 *                                 its schema carrying the protocol union
 *                                 (openai-completions / openai-responses /
 *                                 anthropic-messages — the PROTOCOLS table
 *                                 order, lib :798)
 *   llm/listConfigurableProviders → the staged route row PLUS the catalog
 *                                 as DORMANT rows (every one of the 39
 *                                 built-in ids, settingsNs llm-pi-ai,
 *                                 declared:false — directoryEntries, pi-ai
 *                                 lib :2596-2615); acme absent until the
 *                                 page saves it
 *   settings/mutate             → the page's provider-row save: `set
 *                                 providers/acme {api, baseURL, apiKeyEnv,
 *                                 models}` lands in the user layer over the
 *                                 intact empty base — the plugin's section
 *                                 watcher re-registers the route
 *   llm/listConfigurableProviders → the acme row DECLARED (settingsNs
 *                                 `llm-pi-ai`, settingsPath [providers, acme],
 *                                 declared:true) — the row the page renders
 *   credentials/describe|set    → the key half of the same save: the store
 *                                 file is the app-scope credentials.json the
 *                                 write surface serves (web-write-llm.js
 *                                 STORE_PATH) — the SAME file the gate's
 *                                 CredentialsStore reads
 *   prepareCall → stream        → the saved route SERVES: pi-ai resolves the
 *                                 route credential `credentials` FIRST and
 *                                 the launch env second (lib :2645) — the
 *                                 container env carries a DECOY under the
 *                                 same ref, so the bearer the in-process
 *                                 record server observes proves the STORE
 *                                 answered; the record server records bearer
 *                                 FACTS (booleans), never key material
 *   the BRIDGE variant          → the same save re-pointed at a NON-LOOPBACK
 *                                 baseURL (the localhost-spelled node-side
 *                                 record server — `localhost` is deliberately
 *                                 outside the loopback address rule): the
 *                                 section-write leg arms the fetch→gateway
 *                                 bridge (makeSettingsWrite →
 *                                 installEgressBridgeForSection), and the
 *                                 dial crosses the frozen gateway httpFetch
 *                                 seam to a REAL socket — the node mock
 *                                 demands the canary bearer, so the streamed
 *                                 text is the wire acceptance proof
 *   credentials/unset           → the cleanup (the store carries no canary
 *                                 after the run — idempotent re-runs)
 *
 * No LLM agent turn is driven: the models page is configuration surface;
 * the dials ride ctx.llm.prepareCall directly (the probe's face).
 *
 * Every expected event is declared one-to-one in
 * test/e2e/scenarios/models-byok-add.json; artifacts land under
 * runtime/dsh/artifacts/macos-cli-models-byok-add/.
 */
import { createLogger } from 'logger.js';
import { fsScope } from 'gateway.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { bootUpstream } from 'upstream/boot.js';
import { createWriteSurface } from 'upstream/web-write.js';
import {
  fetchGatewayBridgeInstalled, fetchGatewayBridgeHosts,
} from 'upstream/fetch-gateway-bridge.js';

const SCENARIO = 'models.byok-add';
const log = createLogger(SCENARIO);
const emit = (event, fields = {}) => log.info('e2e', { scenario: SCENARIO, event, ...fields });
const ROOT = '/models-byok-ws';
const SESSION_ID = 's-models-byok';
// The gateway route is never dialed: port 9 (discard) satisfies the boot's
// serving-route demand without implying a live endpoint.
const UNDIALED_BASE = 'http://127.0.0.1:9/v1';
const PROVIDER = 'acme';
const MODEL_ID = 'acme-large';
const KEY_REF = 'ACME_API_KEY';
// The launch-env DECOY under the SAME ref: pi-ai resolves a route credential
// through the credentials service BEFORE the launch environment
// (dsh-llm-pi-ai lib :2641-2648), so the wire bearer proves which one answered.
const DECOY = 'decoy-launch-env-acme-key';
const LOOPBACK_TEXT = 'Hello from acme';
const BRIDGE_TEXT = 'Bridged through the gateway';
// The PROTOCOLS table order (dsh-llm-pi-ai lib :798-802): most-reached first.
const PROTOCOL_UNION = ['openai-completions', 'openai-responses', 'anthropic-messages'];
let verdict = false;
const fail = (reason) => {
  log.error('probe failed', { reason });
  if (!verdict) { verdict = true; globalThis.__dshComplete(false, reason); }
  throw new Error(reason);
};
const demand = (ok, why) => { if (!ok) fail(why + ' @ ' + (new Error().stack ?? '').slice(0, 300)); };

/** Assert `value` deep-matches the {subset} members (shape asserts stay
 * readable; extra wire members are fine). */
const like = (value, subset, why) => {
  for (const [key, want] of Object.entries(subset)) {
    const got = value?.[key];
    demand(JSON.stringify(got) === JSON.stringify(want),
      `${why}: .${key} = ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
  }
};

/** The launch env snapshot (--env on the CLI): the canary and the bridge
 * record server's localhost URL — both owned by the runner, never invented
 * here. */
const launchEnv = () => {
  const raw = globalThis.__dshLaunchEnv?.();
  demand(typeof raw === 'string', 'launch env snapshot missing (CLI must pass --env)');
  const env = JSON.parse(raw);
  demand(typeof env.DSH_BYOK_CANARY === 'string' && env.DSH_BYOK_CANARY.length >= 16,
    'DSH_BYOK_CANARY missing from the launch env');
  demand(typeof env.DSH_BYOK_BRIDGE_BASE_URL === 'string'
    && /^http:\/\/localhost:\d+$/.test(env.DSH_BYOK_BRIDGE_BASE_URL),
  `DSH_BYOK_BRIDGE_BASE_URL must be a localhost socket for the bridge leg, got ${
    JSON.stringify(env.DSH_BYOK_BRIDGE_BASE_URL)}`);
  return env;
};

/** The collision leg (deterministic, its own throwaway boot): a gateway
 * route named like a pi-ai catalog id plus `piaiSection: true` must fail
 * loud AT MOUNT naming BOTH sides — the colliding catalog id and the live
 * route's row (its provider and its `llm-*` settings ns). */
const collisionPhase = async () => {
  try {
    await bootUpstream({
      scenario: SCENARIO, agentId: 'models', sessionId: `${SESSION_ID}-collision`,
      cwd: ROOT, onEvent: () => {},
      container: { cwd: ROOT, tmpdir: `${ROOT}/.tmp`, home: `${ROOT}/home`,
        env: {}, argv: ['dsh', '--profile', 'mobile'] },
      llm: { baseURL: UNDIALED_BASE, apiKey: 'staged-model-key', provider: 'deepseek',
        model: 'deepseek-chat', piaiSection: true },
    });
    fail('the pi-ai section mount collided with the live route and nobody said so');
  } catch (error) {
    const message = String(error?.message ?? error);
    demand(message.includes('deepseek') && message.includes('llm-deepseek'),
      `the collision rejection must name the catalog id AND the live row (provider + settings ns), got: ${message.slice(0, 260)}`);
    emit('byok.collision', {
      catalogId: 'deepseek', route: 'deepseek', settingsNs: 'llm-deepseek',
      failedLoud: true,
    });
  }
};

/** One scripted OpenAI chat-completions SSE frame (single-expression arrow:
 * pure data). */
const sseFrame = (delta, finish, usage) => 'data: ' + JSON.stringify({
  id: 'chatcmpl-acme-1', model: MODEL_ID,
  choices: [{ index: 0, delta, finish_reason: finish ?? null }],
  ...(usage === undefined ? {} : { usage }),
}) + '\n\n';

/** The in-process loopback RECORD server (the node:http-shim face — no real
 * socket, nothing leaves the process): demands the CANARY bearer and records
 * per-request FACTS — path/model/stream plus which credential the wire
 * carried (booleans; the values themselves never land here, let alone in a
 * log line). */
const startRecordServer = async (canary) => {
  log.debug('acme record server starting', {});
  // Dynamic import of the BARE 'http' spelling: the bridges register the
  // in-process loopback face under that name at boot (the llm-piai-probe
  // precedent).
  const { default: http } = await import('http');
  const wire = { requests: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const params = JSON.parse(body);
      const auth = String(req.headers.authorization ?? '');
      const row = {
        path: req.url, model: params.model, stream: params.stream,
        canary: auth === `Bearer ${canary}`, decoy: auth === `Bearer ${DECOY}`,
      };
      wire.requests.push(row);
      if (req.url !== '/v1/chat/completions' || params.stream !== true || !row.canary) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'the acme record server refuses this request' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const piece of ['Hello', ' from', ' acme']) res.write(sseFrame({ content: piece }));
      res.write(sseFrame({}, 'stop', { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 }));
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, wire, baseURL: `http://127.0.0.1:${server.address().port}/v1` };
};

/** Boot the mobile profile with the GATED pi-ai SECTION (the byok
 * composition) over the undialed gateway route; the container env carries
 * the DECOY under the route's credential ref (the store must shadow it). */
const boot = async (env) => {
  const resolved = await fsScope.resolve('scope://app/');
  const root = resolved?.path;
  demand(typeof root === 'string' && root.startsWith('/'),
    `profile container not resolved: ${JSON.stringify(resolved)}`);
  const { ctx } = await bootUpstream({
    scenario: SCENARIO, agentId: 'models', sessionId: SESSION_ID,
    cwd: root, onEvent: () => {},
    container: { cwd: root, tmpdir: `${root}/.tmp`, home: `${root}/home`,
      env: { [KEY_REF]: DECOY }, argv: ['dsh', '--profile', 'mobile'] },
    llm: { baseURL: UNDIALED_BASE, apiKey: 'staged-model-key', kind: 'mock', provider: 'mock',
      model: 'mock-1', piaiSection: true },
  });
  let guard = 0;
  while ((ctx.agents.get(SESSION_ID) === undefined || ctx.sessions.get(SESSION_ID) === undefined)
    && guard++ < 10000) await Promise.resolve();
  demand(ctx.agents.get(SESSION_ID) !== undefined, 'the configured agent never appeared');
  return ctx;
};

/** The mirror leg: the namespace the section mount registered — base layer
 * `providers: {}` (the EMPTY base), user layer free — and the protocol
 * union its schema offers the page's protocol picker. */
const describePhase = async (api) => {
  const described = await api['settings/describe']({});
  demand(described.writable === true && described.hasDocument === false,
    `describe wrapper: ${JSON.stringify({ w: described.writable, d: described.hasDocument })}`);
  const ns = described.namespaces.find((n) => n.ns === 'llm-pi-ai');
  demand(ns !== undefined,
    `llm-pi-ai namespace missing: ${JSON.stringify(described.namespaces.map((n) => n.ns))}`);
  like(ns.base, { providers: {} }, 'section base layer (the empty base)');
  demand(ns.user === undefined, `user layer starts free: ${JSON.stringify(ns.user)}`);
  const schemaText = JSON.stringify(ns.schema ?? null);
  const protocols = PROTOCOL_UNION.filter((p) => schemaText.includes(p));
  demand(protocols.length === PROTOCOL_UNION.length,
    `the llm-pi-ai schema must offer the whole protocol union ${JSON.stringify(PROTOCOL_UNION)}, found ${JSON.stringify(protocols)} in ${schemaText.slice(0, 220)}`);
  emit('byok.section', {
    ns: ns.ns, baseProviders: 0, userLayer: false, protocols,
  });
  return ns;
};

/** The staged directory: before the page saves anything, the live rows are
 * the boot route's alone — the section mount has declared the whole catalog
 * as DORMANT rows (declared:false), and acme is not among them. */
const directoryStagedPhase = async (api) => {
  const directory = await api['llm/listConfigurableProviders']({});
  demand(Array.isArray(directory) && directory[0]?.provider === 'mock'
    && directory[0]?.settingsNs === 'llm-mock',
    `staged directory head: ${JSON.stringify(directory[0])}`);
  demand(directory.every((row) => row.provider !== PROVIDER),
    `the acme row existed before the page saved it: ${JSON.stringify(directory.map((r) => r.provider))}`);
  const dormant = directory.filter((row) => row.declared === false);
  demand(dormant.length === 39
    && dormant.every((row) => row.settingsNs === 'llm-pi-ai'
      && Array.isArray(row.settingsPath) && row.settingsPath[0] === 'providers'),
    `the dormant catalog rows drifted: ${dormant.length} rows, e.g. ${JSON.stringify(dormant[0])}`);
  emit('byok.directory.staged', {
    providers: ['mock'], dormant: dormant.length, acme: false,
  });
  return directory;
};

/** The page's save, leg one — the provider row: one COMMITTED `set` of
 * providers/acme into the section's user layer (the row the form assembled:
 * protocol, endpoint, credential REF, model roster). The plugin's section
 * watcher re-registers the route on the commit. */
const savePhase = async (api, baseURL) => {
  const row = {
    displayName: 'Acme (BYOK)',
    api: 'openai-completions',
    baseURL,
    apiKeyEnv: KEY_REF,
    models: [{ id: MODEL_ID, name: 'Acme Large', contextWindow: 65536 }],
  };
  const written = await api['settings/mutate']({
    ns: 'llm-pi-ai',
    ops: [{ op: 'set', path: ['providers', PROVIDER], value: row }],
  });
  demand(written.ns === 'llm-pi-ai', `mutate ns: ${JSON.stringify(written.ns)}`);
  demand(written.user?.providers?.[PROVIDER]?.api === 'openai-completions',
    `user layer row: ${JSON.stringify(written.user)}`);
  demand(written.base?.providers !== undefined
    && Object.keys(written.base.providers).length === 0,
    `base layer must stay the EMPTY base: ${JSON.stringify(written.base)}`);
  demand(written.value?.providers?.[PROVIDER]?.baseURL === baseURL,
    `merged view: ${JSON.stringify(written.value)}`);
  emit('byok.save', {
    ns: written.ns, op: `set providers/${PROVIDER}`,
    api: 'openai-completions',
    baseURLHost: new URL(baseURL).hostname,
    models: written.user.providers[PROVIDER].models.length,
    baseIntact: true,
  });
  return row;
};

/** The directory row the page renders after the save: the acme provider,
 * DECLARED by the pi-ai section (dormant no more). */
const directoryAcmePhase = async (api) => {
  const directory = await api['llm/listConfigurableProviders']({});
  const row = directory.find((entry) => entry.provider === PROVIDER);
  demand(row !== undefined,
    `acme row missing from the directory: ${JSON.stringify(directory.map((r) => r.provider))}`);
  demand(row.settingsNs === 'llm-pi-ai'
    && JSON.stringify(row.settingsPath) === JSON.stringify(['providers', PROVIDER]),
    `acme row shape: ${JSON.stringify(row)}`);
  demand(row.declared === true && row.displayName === 'Acme (BYOK)',
    `the acme row is not the declared route row: ${JSON.stringify(row)}`);
  emit('byok.directory.acme', {
    provider: row.provider, settingsNs: row.settingsNs, settingsPath: row.settingsPath,
    declared: row.declared, displayName: row.displayName,
  });
  return row;
};

/** The save's key half: the credential round-trip through the page's wire —
 * describe (absent) → set → describe (configured; the value never comes
 * back). The store file is the SAME app-scope credentials.json the gate's
 * CredentialsStore reads. */
const credentialPhase = async (api) => {
  const refs = [KEY_REF, 'MOCK_API_KEY'];
  const before = await api['credentials/describe']({ refs });
  demand(before[KEY_REF].configured === false,
    `acme credential pre-existed the save: ${JSON.stringify(before)}`);
  demand(before.MOCK_API_KEY.configured === true
    && before.MOCK_API_KEY.source !== undefined,
    `the staged route's ref lost its staged badge: ${JSON.stringify(before)}`);
  await api['credentials/set']({ ref: KEY_REF, value: launchCanary });
  const after = await api['credentials/describe']({ refs });
  demand(after[KEY_REF].configured === true
    && after[KEY_REF].source === undefined
    && after[KEY_REF].writable === true,
    `describe after set: ${JSON.stringify({ a: after[KEY_REF] })}`);
  emit('byok.credential', {
    ref: KEY_REF, beforeConfigured: false, afterConfigured: true,
    routeStaged: true, leaked: false,
  });
};

/** One full stream through the acme route's REAL pi-ai wire layer. */
const dial = async (ctx, expect) => {
  const prepared = await ctx.llm.prepareCall({ provider: PROVIDER, model: MODEL_ID });
  demand(prepared.config.provider === PROVIDER && prepared.config.model === MODEL_ID,
    `prepared config is ${JSON.stringify(prepared.config)}`);
  const chunks = [];
  const stream = prepared.stream({ ...prepared.config, messages: [createUserMessage({
    content: [{ type: 'text', text: 'Say hi' }], source: { kind: 'user' },
  })] });
  for await (const chunk of stream) chunks.push(chunk);
  const text = chunks.filter((c) => c.type === 'text-delta').map((c) => c.text).join('');
  const finish = chunks.find((c) => c.type === 'finish');
  demand(text === expect, `assembled text is "${text}"`);
  demand(finish?.reason?.kind === 'stop', `finish reason is ${JSON.stringify(finish?.reason)}`);
  return { text, finish: finish.reason.kind };
};

/** The saved route SERVES: one loopback dial through pi-ai's real
 * openai-completions wire. The record server's facts decide the credential
 * question — the canary rode the wire (the store answered; the launch-env
 * decoy did not). */
const dialPhase = async (ctx, record) => {
  const { text, finish } = await dial(ctx, LOOPBACK_TEXT);
  demand(record.wire.requests.length === 1,
    `the record server saw ${record.wire.requests.length} requests`);
  const seen = record.wire.requests[0];
  demand(seen.canary === true && seen.decoy === false,
    `the wire credential is not the stored canary: ${JSON.stringify({ canary: seen.canary, decoy: seen.decoy })}`);
  emit('byok.wire', {
    path: seen.path, model: seen.model, stream: seen.stream, credential: 'store',
  });
  emit('byok.stream', { text, finish, transported: 'in-process-loopback' });
};

/** The BRIDGE variant: the same save re-pointed at a NON-LOOPBACK endpoint
 * (the runner's localhost-spelled node record server — `localhost` is
 * deliberately outside the loopback address rule). The section write arms
 * the fetch→gateway bridge BEFORE the view is answered, and the dial crosses
 * the frozen gateway httpFetch seam to the real socket — where the mock
 * demands the canary, so the streamed text IS the acceptance proof. */
const bridgePhase = async (ctx, api, bridgeURL) => {
  const written = await api['settings/mutate']({
    ns: 'llm-pi-ai',
    ops: [{ op: 'set', path: ['providers', PROVIDER], value: {
      displayName: 'Acme (BYOK)', api: 'openai-completions',
      baseURL: bridgeURL, apiKeyEnv: KEY_REF,
      models: [{ id: MODEL_ID, name: 'Acme Large', contextWindow: 65536 }],
    } }],
  });
  demand(written.value?.providers?.[PROVIDER]?.baseURL === bridgeURL,
    `the bridged row did not land: ${JSON.stringify(written.value)}`);
  demand(fetchGatewayBridgeInstalled() === true,
    'the non-loopback save did not arm the fetch→gateway bridge');
  const hosts = fetchGatewayBridgeHosts();
  demand(hosts.includes('localhost'),
    `the bridge honesty set lost localhost: ${JSON.stringify(hosts)}`);
  emit('byok.bridge.armed', { installed: true, hosts });
  const { text, finish } = await dial(ctx, BRIDGE_TEXT);
  emit('byok.bridge.stream', { text, finish, transported: 'gateway', credential: 'store' });
};

/** The cleanup: the store carries no canary after the run (idempotent
 * re-runs start from the same empty state). */
const cleanupPhase = async (api) => {
  await api['credentials/unset']({ ref: KEY_REF });
  const after = await api['credentials/describe']({ refs: [KEY_REF] });
  demand(after[KEY_REF].configured === false,
    `the cleanup did not clear the ref: ${JSON.stringify(after)}`);
  emit('byok.cleanup', { cleared: true });
};

let launchCanary = '';
/** Main: collision leg → boot → surface → the page's save order → complete. */
try {
  const env = launchEnv();
  launchCanary = env.DSH_BYOK_CANARY;
  await collisionPhase();
  const record = await startRecordServer(launchCanary);
  const ctx = await boot(env);
  const { api } = createWriteSurface(ctx, () => {}, {
    root: ROOT, provider: 'mock', model: 'mock-1', baseURL: UNDIALED_BASE,
    spine: () => [], stagedPlugins: () => [], fullCoverage: true,
  });
  await describePhase(api);
  await directoryStagedPhase(api);
  await savePhase(api, record.baseURL);
  await directoryAcmePhase(api);
  await credentialPhase(api);
  await dialPhase(ctx, record);
  await bridgePhase(ctx, api, env.DSH_BYOK_BRIDGE_BASE_URL);
  await cleanupPhase(api);
  await record.server.close();
  emit('models.byok-add/completed', {
    status: 'pass', upstream: '0.1.6-alpha.2',
    surface: 'the models 设置页 BYOK add: pi-ai section + protocol union + page save + credential store + loopback dial + the bridge variant',
  });
  if (!verdict) { verdict = true; globalThis.__dshComplete(true, 'models byok add verified'); }
} catch (e) {
  fail((e?.message ?? String(e)) + ' @ ' + (e?.stack ?? '').slice(0, 300)
    + ' | code=' + (e?.code ?? '-'));
}
