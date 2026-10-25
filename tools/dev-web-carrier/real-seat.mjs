#!/usr/bin/env node
// dsh:logging-exempt (node-side driver: console IS the product)
/**
 * real-seat.mjs — the dev carrier's REAL runtime seat: bootUpstream boots in
 * THIS Node process (composer-web-live's boot path — runtime.config → route
 * → spine → write surface → creation mount → resident), and the official
 * client's wire (POST /api envelopes + WS /api/remote.mux + the boot-graph
 * index injection) bridges onto the same bus the device hosts deliver.
 *
 * The LLM route is --llm:
 *   staged  → a REAL endpoint (DSH_LLM_BASE_URL/DSH_LLM_MODEL/DSH_LLM_API_KEY,
 *             userEndpoint:true — the BYOK shape, key never rendered), or
 *   mock    → the loopback scripted chat-completions server (deterministic
 *             dry-run; ci/mock-llm-server.mjs, spawned here).
 *
 * usage: node --import <repo>/test/panel/spine/register.mjs \
 *             tools/dev-web-carrier/real-seat.mjs [--port N] [--llm staged|mock]
 * env:   DSH_LLM_BASE_URL DSH_LLM_API_KEY DSH_LLM_MODEL (staged mode)
 */
import { createServer } from 'node:http';
import { stageLoopbackHttpFetch } from './loopback-seam.mjs';
import { installHostGateway } from './host-gateway.mjs';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PluginsRoute } from './plugins-route.mjs';
import { stagedDescriptors } from './compose-boot.mjs';
import { acceptUpgrade } from './ws-lite.mjs';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const DIST_ROOT = join(REPO_ROOT, 'presentation/official-web/dist');
const WS_ROOT = join(REPO_ROOT, 'tmp/hero-seat/workspace');
const COOKIE_NAME = 'dsh-dev-carrier';

// ---- args ----
const plugins = new PluginsRoute(
  stagedDescriptors(REPO_ROOT).map((d) => ({
    id: d.loaderName,
    file: join(dirname(d.pkgJsonPath), 'lib', 'client.js'),
  })),
);

const args = { port: 0, llm: 'staged' };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--port') args.port = Number(process.argv[++i]);
  else if (process.argv[i] === '--llm') args.llm = process.argv[++i];
  else throw new Error(`real-seat: unknown argument '${process.argv[i]}'`);
}
if (args.llm !== 'staged' && args.llm !== 'mock') {
  throw new Error(`real-seat: --llm want staged|mock, got '${args.llm}'`);
}

// ---- workspace (the profile container the boot demands) ----
for (const d of [WS_ROOT, join(WS_ROOT, 'home'), join(WS_ROOT, '.tmp')]) mkdirSync(d, { recursive: true });

// ---- the harness globals, BEFORE the runtime import ----
const queue = [];
let wake = null;
let dispatch = null;
const posted = [];
const muxSockets = new Map(); // streamId → ws
const apiWaiters = new Map(); // rpcId → (result) => void
let bootRows = null;
let bootReady = null;
const bootReadyP = new Promise((resolve) => { bootReady = resolve; });

globalThis.__dshBusOnMessage = (line) => {
  const msg = JSON.parse(line);
  if (dispatch !== null) return dispatch(msg);
  queue.push(msg);
  wake?.();
  wake = null;
};
globalThis.__dshBusPost = (line) => {
  const msg = JSON.parse(line);
  console.log('[real-seat] bus post:', msg.type);
  switch (msg.type) {
    case 'web.boot': bootRows = msg; console.log('[real-seat] runtime revs:', JSON.stringify(msg.plugins)); plugins?.applyRuntimeRevs(msg.plugins); bootReady(); return;
    case 'api.respond': {
      const waiter = apiWaiters.get(msg.rpcId);
      apiWaiters.delete(msg.rpcId);
      waiter?.(msg.result);
      return;
    }
    case 'mux.item': console.log('[real-seat] mux.item stream=' + msg.streamId + ' endpoint=' + (msg.endpoint ?? '?') + ' value=' + JSON.stringify(msg.value)?.slice(0, 200)); muxSockets.get(msg.streamId)?.sendText(JSON.stringify({ type: 'item', streamId: msg.streamId, value: msg.value })); return;
    case 'mux.end': muxSockets.get(msg.streamId)?.sendText(JSON.stringify({ type: 'end', streamId: msg.streamId })); return;
    case 'mux.error': muxSockets.get(msg.streamId)?.sendText(JSON.stringify({ type: 'error', streamId: msg.streamId, error: msg.error })); return;
    default: posted.push(msg);
  }
};
globalThis.__dshComplete = (ok, reason) => {
  console.log(`[real-seat] runtime complete ok=${ok} ${reason ?? ''}`);
};

const deliver = (msg) => globalThis.__dshBusOnMessage(JSON.stringify(msg));

// ---- the LLM route ----
const llm = args.llm === 'mock'
  ? { kind: 'mock', provider: 'mock', model: 'mock-1', baseURL: 'LOOPBACK_PENDING' }
  : {
    kind: 'staged',
    provider: process.env.DSH_LLM_PROVIDER ?? 'deepseek',
    model: process.env.DSH_LLM_MODEL ?? 'deepseek-chat',
    baseURL: process.env.DSH_LLM_BASE_URL,
    apiKey: process.env.DSH_LLM_API_KEY,
    userEndpoint: true,
  };
if (args.llm === 'staged' && (!llm.baseURL || !llm.apiKey)) {
  throw new Error('real-seat: staged mode needs DSH_LLM_BASE_URL + DSH_LLM_API_KEY');
}

// ---- the loopback mock (mock mode): a REAL scripted chat-completions server ----
let mockHandle = null;
if (args.llm === 'mock') {
  const { startMockLlmServer } = await import(pathToFileURL(join(REPO_ROOT, 'external/dsh/llm-mock-server@0.1.6-alpha.2/lib/index.js')).href);
  mockHandle = await startMockLlmServer({
    host: '127.0.0.1', port: 0, sequence: ['success'], repeatLast: true,
    successText: 'Hello from the hero seat', chunkSize: 6, chunkDelayMs: 30,
    apiKey: 'hero-mock-key', requestId: 'mock-req-1',
  });
  llm.baseURL = mockHandle.baseURL;
  llm.apiKey = 'hero-mock-key';
  console.log(`[real-seat] mock LLM on ${mockHandle.baseURL}`);
}

// ---- the host seams (test/panel/spine/spine-seams.mjs): bundle reads,
// async-context slots, node timers, and the gateway dispatch (loud-fail +
// staged httpFetch). Then the two wire stagers: the loopback mock rides
// http://127.0.0.1, the staged real key rides https (stageRealHttpFetch). ----
const seams = await import(pathToFileURL(join(REPO_ROOT, 'test/panel/spine/spine-seams.mjs')).href);
if (args.llm === 'mock') stageLoopbackHttpFetch(seams, llm.baseURL);
else seams.stageRealHttpFetch();
// The HOST gateway: the fs family + keychain the plugin plane writes
// through (the device C host implements these; the panel seam loud-fails
// them). Scope root inside the workspace container, like the phone.
installHostGateway(join(WS_ROOT, 'app-scope'));

// ---- the web.plugins delivery: the staged client bundles, walked to
// b64 files (web-boot.js stageWebPlugins' shape: plugins[] with
// {loaderName, pkgJsonPath, entryPath, files:{relpath:{b64,mtimeMs}}}) ----
const walkFiles = (dir, base, out) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = `${base}/${entry.name}`;
    if (entry.isDirectory()) walkFiles(full, rel, out);
    else {
      out[rel] = { b64: readFileSync(full).toString('base64'), mtimeMs: 0 };
    }
  }
};
const MOBILE_PRESET_PACKAGES = [
  'dsh-persona', 'dsh-agent-instructions', 'dsh-tool-fs', 'dsh-tool-jobs',
  'dsh-skill-filesystem', 'dsh-tool-skill', 'dsh-command-goal',
  'dsh-tool-goal', 'dsh-plan-mode', 'dsh-compaction-basic',
  'dsh-command-compact', 'dsh-compaction-tool-result-pruner',
  'dsh-tool-subagent-control', 'dsh-tool-subagent', 'dsh-tool-ask-user',
  'dsh-tool-todo', 'dsh-tool-present',
];

/** Stage one runtime plugin package (the mobile composition's rows name
 * them): walk the farm-resolved vendored dir, key the VFS at
 * /web-plugins/<loader><rel>, and mirror the bytes for the HTTP face. */
const stageRuntimePlugin = (plugins, pkg) => {
  const real = join(REPO_ROOT, 'runtime/dsh/node_modules/@deepseek-ai', pkg);
  if (!existsSync(join(real, 'package.json'))) {
    console.log(`[real-seat] plugin package missing on the farm: ${pkg}`);
    return;
  }
  const loaderName = `@deepseek-ai/${pkg}`;
  const diskDir = join(WS_ROOT, 'web-plugins', loaderName);
  mkdirSync(diskDir, { recursive: true });
  const keyed = {};
  walkFiles(real, '', keyed);
  const stagedFiles = {};
  for (const [rel, file] of Object.entries(keyed)) {
    const vfsPath = `/web-plugins/${loaderName}${rel}`;
    stagedFiles[vfsPath] = file;
    const dst = join(WS_ROOT, 'web-plugins', loaderName, rel);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, Buffer.from(file.b64, 'base64'));
  }
  plugins.push({
    loaderName,
    pkgJsonPath: join(real, 'package.json'),
    entryPath: `${WS_ROOT}/web-plugins/${loaderName}/lib/index.js`,
    files: stagedFiles,
  });
};
/** The mobile composition's runtime plugin packages, staged beside the
 * client bundles (the 19-row preset join names them). */
const stageRuntimePlugins = (plugins) => {
// The mobile composition's RUNTIME plugin rows (the 19-row join): each
// names a vendored package the loader must resolve — stage the package's
// own files the same way the device's web-plugins staging does.
for (const pkg of MOBILE_PRESET_PACKAGES) {
  const real = join(REPO_ROOT, 'runtime/dsh/node_modules/@deepseek-ai', pkg);
  if (!existsSync(join(real, 'package.json'))) {
    console.log(`[real-seat] plugin package missing on the farm: ${pkg}`);
    continue;
  }
  const loaderName = `@deepseek-ai/${pkg}`;
  const diskDir = join(WS_ROOT, 'web-plugins', loaderName);
  mkdirSync(diskDir, { recursive: true });
  const keyed = {};
  walkFiles(real, '', keyed);
  const stagedFiles = {};
  for (const [rel, file] of Object.entries(keyed)) {
    const vfsPath = `/web-plugins/${loaderName}${rel}`;
    stagedFiles[vfsPath] = file;
    const dst = join(WS_ROOT, 'web-plugins', loaderName, rel);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, Buffer.from(file.b64, 'base64'));
  }
  plugins.push({
    loaderName,
    pkgJsonPath: join(real, 'package.json'),
    entryPath: `${WS_ROOT}/web-plugins/${loaderName}/lib/index.js`,
    files: stagedFiles,
  });
}

};

const webPluginDelivery = () => {
  const plugins = stagedDescriptors(REPO_ROOT).map((d) => {
    const walked = {};
    walkFiles(dirname(d.pkgJsonPath), '', walked);
    const files = {};
    for (const [rel, file] of Object.entries(walked)) {
      files[`/web-plugins/${d.loaderName}${rel}`] = file;
      // the HTTP face serves the same bytes from disk (the page fetches the
      // graph URLs over the origin; the runtime reads the VFS)
      const dst = join(WS_ROOT, 'web-plugins', d.loaderName, rel);
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, Buffer.from(file.b64, 'base64'));
    }
    return {
      loaderName: d.loaderName,
      pkgJsonPath: d.pkgJsonPath,
      entryPath: `${WS_ROOT}/web-plugins/${d.loaderName}/lib/client.js`,
      files,
    };
  });
  stageRuntimePlugins(plugins);
  return { type: 'web.plugins', plugins };
};
const deliverWebPluginsNow = () => deliver(webPluginDelivery());

// ---- the preset plane (T-0218 leg 4's Node face): the vendored tree
// materializes under the workspace (the ws seam serves it), the synthesized
// mobile preset copied beside the shipped four, the farm node_modules
// linked for the composition's upward package walk. ----
const WS_VENDOR = `${WS_ROOT}/vendor/dsh/agent-presets@0.1.6-alpha.2`;
// The presets VFS seed (the third delivery): the generated manifest keyed
// at the WORKSPACE vendor root — the mount's async readFile has no
// real-disk twin (only readFileSync does), so the workspace copy is
// invisible to it until the VFS gate answers: underVFS(WS_VENDOR/…) with
// these exact keys.
const realRoot = `${WS_VENDOR}/`;
const presetsSeedSetup = async () => {
  const shim = await import(pathToFileURL(join(REPO_ROOT, 'runtime/dsh/upstream/shims/fs-seeded.js')).href);
  shim.VFS_ROOTS.push(realRoot);
  const seed = await import(pathToFileURL(join(REPO_ROOT, 'runtime/dsh/scenario/agent-presets-probe-seed.js')).href);
  const files = {};
  for (const [path, file] of Object.entries(seed.default)) {
    const tail = path.slice('/vendor/dsh/agent-presets@0.1.6-alpha.2'.length);
    files[`${realRoot}${tail.replace(/^\/+/, '')}`] = { b64: Buffer.from(file.bytes).toString('base64'), mtimeMs: 0 };
  }
  return { type: 'agentPresets.seed', files };
};
const deliverPresetsSeed = async () => {
  const delivery = await presetsSeedSetup();
  deliver(delivery);
  console.log(`[real-seat] presets VFS seeded: ${Object.keys(delivery.files).length} files`);
};

const materializePresetsPlane = () => {
  const vendored = join(REPO_ROOT, 'runtime/dsh/vendor/dsh/agent-presets@0.1.6-alpha.2');
  cpSync(vendored, WS_VENDOR, { recursive: true });
  // AGENT_PRESETS_DEFAULT is the SYNTHESIZED mobile (T-0048): the vendored
  // tree ships cordis/minimal/ptc/standard only
  mkdirSync(join(WS_VENDOR, 'presets'), { recursive: true });
  cpSync(join(REPO_ROOT, 'runtime/dsh/presets-mobile/mobile'), join(WS_VENDOR, 'presets', 'mobile'), { recursive: true });
  // the composition's upward package walk lands on the farm itself
  const wsNm = join(WS_ROOT, 'node_modules');
  if (!existsSync(wsNm)) symlinkSync(join(REPO_ROOT, 'runtime/dsh/node_modules'), wsNm);
};
// ---- runtime.config, then the runtime import (main() runs at import) ----
const WSArg = (p) => p; // the boot demands '/'-prefixed POSIX roots
const cfg = {
  scenario: 'hero.seat',
  agentId: 'main',
  sessionId: 's-hero-0001',
  cwd: WSArg(WS_ROOT),
  containerRoot: WSArg(WS_ROOT),
  container: { cwd: WSArg(WS_ROOT), tmpdir: WSArg(join(WS_ROOT, '.tmp')), home: WSArg(join(WS_ROOT, 'home')), env: {}, argv: ['dsh', '--profile', 'mobile'] },
  llm,
  mockLlmUrl: args.llm === 'mock' ? llm.baseURL : undefined,
  apiKey: args.llm === 'mock' ? 'hero-mock-key' : llm.apiKey,
  // The staged route reads the FLAT config fields (the Android host's
  // shape — llm-route.js stagedRoute); the nested `llm` above is seat-local.
  ...(args.llm === 'staged' ? {
    llmBaseUrl: llm.baseURL,
    llmApiKey: llm.apiKey,
    llmModel: llm.model,
    llmProvider: llm.provider,
  } : {}),
  commands: true,
  skills: {},
  goals: true,
  fileReferences: true,
  creation: true,
  presetJoin: true,
  // The BYOK-models section mounts an empty pi-ai catalog whose 'deepseek'
  // row collides with the STAGED route's own provider declaration (the
  // mount refuses loudly). A staged key IS the configured state the section
  // exists to produce — off when staged, on for the mock seat.
  byokModels: args.llm === 'mock',
  agentPresetsBaseUrl: pathToFileURL(WS_VENDOR + '/').href,
  agentPresetRoots: [{ path: WS_VENDOR + '/presets/', trust: 'system' }],
  settingsProbes: false, // the recording seat proves chat+create, not settings
};

materializePresetsPlane();
const composerURL = pathToFileURL(join(REPO_ROOT, 'runtime/dsh/web-live/composer-web-live.js')).href;
console.log('[real-seat] importing composer from', composerURL);
const runtimeModule = await import(composerURL);
console.log('[real-seat] runtime imported — delivering runtime.config');
deliver({ type: 'runtime.config', ...cfg });
deliverWebPluginsNow();
deliverPresetsSeed();
console.log('[real-seat] resident when the boot graph lands');

// ---- wait for the runtime's boot graph, then compose the served rows ----
await bootReadyP;
// The page wire composes OUT-OF-PROCESS (compose-only.mjs, a fresh clean
// context — the loader's internal-resolver guard refuses a second in-process
// compose); the runtime's own web.boot posted the recovery defaults.
const staged = join(REPO_ROOT, 'tmp/dev-web-carrier');
const composed = JSON.parse(readFileSync(join(staged, 'hero-rows.json'), 'utf8'));
plugins.applyRuntimeRevs(composed.plugins);
const rows = composed.rows.map((row) => {
  const { placement, ...rest } = row;
  return placement === undefined ? { ...rest, placement: 'head' } : { placement, ...rest };
});
const token = randomBytes(16).toString('hex');
const isAuthed = (req) => (req.headers.cookie ?? '').split(';')
  .map((c) => c.trim()).some((c) => c === `${COOKIE_NAME}=${token}`);

// ---- index render (CarrierWebDist.renderIndex shape) ----
const spliceAfter = (html, marker, insert) => {
  const at = html.indexOf(marker);
  if (at < 0) return html + insert;
  const gt = html.indexOf('>', at);
  return html.slice(0, gt + 1) + insert + html.slice(gt + 1);
};
const jsonString = (v) => `"${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
const htmlAttribute = (v) => v.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const READY_MARKUP = '<script>(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve()</script>';
const rowMarkup = (row) => {
  const placement = row.placement ?? 'head';
  switch (row.kind) {
    case 'global':
      return ['head', `<script>globalThis[${jsonString(row.name)}] = ${row.value}</script>`];
    case 'script':
      return ['head', `<script>${row.text}</script>`];
    case 'script-src':
      return ['head', `<script src="${htmlAttribute(row.src)}"></script>`];
    case 'script-preload':
      return ['head', `<link rel="preload" as="script" href="${htmlAttribute(row.src)}">`];
    case 'style':
      return ['head', `<style>${row.text}</style>`];
    default:
      throw new Error(`real-seat: unknown injection row kind '${row.kind}'`);
  }
};
const renderIndex = (html) => {
  let head = '';
  let body = '';
  for (const row of rows) {
    const [placement, markup] = rowMarkup(row);
    if (placement === 'body') body += markup; else head += markup;
  }
  body += READY_MARKUP;
  let out = spliceAfter(html, '<head', '<base href="/">' + head);
  out = spliceAfter(out, '<body', body);
  return out;
};

// ---- the bus dispatch: runtime claims → host answers ----
dispatch = (msg) => {
  switch (msg.type) {
    case 'api.claim': console.log('[real-seat] api claimed:', (msg.endpoints ?? []).join(', ')); return;
    case 'mux.claim': console.log('[real-seat] mux claimed:', (msg.endpoints ?? []).join(', ')); return;
    default: posted.push(msg);
  }
};
// drain whatever queued before resident
for (const msg of queue.splice(0)) dispatch(msg);

// ---- HTTP + WS ----
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const serveDist = (req, url, respond) => {
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = join(DIST_ROOT, rel);
  if (!file.startsWith(DIST_ROOT) || !existsSync(file)) return respond(404, 'text/plain', '');
  const mime = MIME[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream';
  const body = rel === '/index.html' ? renderIndex(readFileSync(file, 'utf8')) : readFileSync(file);
  respond(200, mime, body);
};
const handleApi = (req, url, respond) => {
  if (req.method !== 'POST') return respond(405, 'text/plain', '');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return respond(400, 'text/plain', ''); }
    // The client matches responses by ITS request rpcId (dsh-client-connection
    // throws on any mismatch) — echo it; mint only for hand-rolled probes.
    const rpcId = typeof payload.rpcId === 'string' && payload.rpcId !== ''
      ? payload.rpcId : `hero-${randomBytes(6).toString('hex')}`;
    // The client posts the full client-request envelope {type, rpcId,
    // payload:{args}}; the runtime's handler reads msg.payload.args — unwrap
    // one level (a bare {"args":…} hand-probe body passes through).
    const inner = payload.payload ?? payload;
    console.log(`[real-seat] page -> ${url.pathname.slice('/api/'.length)}`);
    apiWaiters.set(rpcId, (result) => {
      console.log(`[real-seat] <- ${url.pathname.slice('/api/'.length)} ok=${result.ok}${result.ok ? '' : ' err=' + JSON.stringify(result.error ?? {})}`);
      respond(200, 'application/json', JSON.stringify({ type: 'server-response', rpcId, result }));
    });
    deliver({ type: 'api.request', rpcId, endpoint: url.pathname.slice('/api/'.length), payload: inner });
    setTimeout(() => {
      if (apiWaiters.has(rpcId)) {
        apiWaiters.delete(rpcId);
        respond(504, 'application/json', JSON.stringify({ type: 'server-response', rpcId, result: { ok: false, error: { code: 'gateway/timeout', message: 'no respond within 120s', details: {} } } }));
      }
    }, 120_000);
  });
};
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const respond = (status, mime, body, headers = {}) => {
    const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    res.writeHead(status, { 'Content-Type': mime, 'Content-Length': buf.length, ...headers });
    res.end(req.method === 'HEAD' ? undefined : buf);
  };
  try {
    if (url.pathname.startsWith('/web-plugins/')) {
      const file = join(WS_ROOT, url.pathname);
      if (!existsSync(file)) return respond(404, 'text/plain', '');
      const mime = MIME[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream';
      return respond(200, mime, readFileSync(file));
    }
    if (url.pathname === '/plugins' || url.pathname.startsWith('/plugins/')) {
      const request = { method: req.method, path: url.pathname, rawPath: url.pathname, query: url.search };
      return plugins.handler(request, respond);
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return handleApi(req, url, respond);
    if (!isAuthed(req)) {
      if (url.pathname === '/' && url.search.includes(`token=${token}`)) {
        return respond(200, 'text/html', renderIndex(readFileSync(join(DIST_ROOT, 'index.html'), 'utf8')), { 'Set-Cookie': `${COOKIE_NAME}=${token}; Path=/` });
      }
      return respond(401, 'text/plain', 'auth-lite: fetch /?token=<token>');
    }
    return serveDist(req, url, respond);
  } catch (error) {
    console.error('[real-seat] request failed:', error?.stack ?? error);
    respond(400, 'text/plain', '');
  }
});
server.on('upgrade', (req, socket) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/api/remote.mux') return socket.destroy();
  if (!isAuthed(req)) return socket.destroy();
  const ws = acceptUpgrade(req, socket);
  if (ws === null) return socket.destroy();
  ws.onText((text) => {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.type === 'open' && typeof msg.streamId === 'string') {
      console.log('[real-seat] mux.open stream=' + msg.streamId + ' endpoint=' + (msg.endpoint ?? '?'));
      muxSockets.set(msg.streamId, ws);
      deliver({ type: 'mux.open', streamId: msg.streamId, endpoint: msg.endpoint ?? '', payload: msg.payload });
    } else if (msg.type === 'cancel' && typeof msg.streamId === 'string') {
      deliver({ type: 'mux.cancel', streamId: msg.streamId });
    }
  });
});

server.listen(args.port, '127.0.0.1', () => {
  const { port } = server.address();
  console.log(`[real-seat] listening on http://127.0.0.1:${port}/`);
  console.log(`[real-seat] open http://127.0.0.1:${port}/?token=${token} (llm: ${args.llm})`);
});
