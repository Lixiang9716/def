// dsh:logging-exempt scenario — the mounted logger carries every canonical line.
/**
 * Scenario `appshell.spec` (the appshell morphing plan's L2 leg, D-6): the
 * deterministic generation→validation→tool-call chain over the REAL spine —
 * the only e2e where the dsh-appshell plugin itself executes (the browser
 * morph leg's tool cards are synthesized carrier-side by design).
 *
 * Flow: the mobile profile boots against the loopback mock LLM; the scenario
 * mounts system-plugins/dsh-appshell beside the spine (the office.js
 * precedent — scenario-side mount, zero blast radius on other legs' boot
 * manifests); ONE REAL agent turn runs with the mock scripting an
 * appshell_render tool call (DSH_MOCK_TOOL_NAME/ARGS shape the wire, the
 * sequence closes with a success round); the loop dispatches through the
 * REAL ToolRuntime; the plugin's four-gate validator passes the scripted
 * spec and the echo carries the minted surfaceId. Then, deterministically:
 * a forged-surfaceId appshell_update is refused (the sixth red-team
 * category — authorization runs BEFORE validation), the LIVE surfaceId
 * updates, and appshell_catalog serves the authoring rules.
 *
 * Every expected event is declared one-to-one in
 * test/e2e/scenarios/appshell-spec.json; artifacts land under
 * runtime/dsh/artifacts/macos-cli-appshell-spec/.
 */
import { createLogger } from 'logger.js';
import { fsScope } from 'gateway.js';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { bootUpstream } from 'upstream/boot.js';

const SCENARIO = 'appshell.spec';
const AGENT_ID = 'main';
const SESSION_ID = 's-appshell-spec-0001';
const INPUT_TEXT = '变成微信';
// Mirrors DSH_MOCK_SUCCESS_TEXT in run-appshell-spec-e2e.sh — the closing
// round's scripted text, asserted to prove the turn settled after the tool.
const CLOSING_TEXT = '表面已就绪';
const TOOLS = ['appshell_render', 'appshell_update', 'appshell_catalog'];
// Mirrors DSH_MOCK_TOOL_ARGS in the runner: a validator-clean spec exercising
// gate 1 (template + primitive), gate 4 (declared action), and the echo title.
const UPDATE_SPEC = {
  spec: 'app-shell/0.9', title: '微信', theme: { accent: '#07C160' },
  tabs: ['微信', '通讯录'], actions: [],
  screen: { type: 'column', children: [{ type: 'text', text: '首页' }] },
};

const log = createLogger('dsh.scenario');
const emit = (event, fields = {}) => log.info('e2e', { scenario: SCENARIO, event, ...fields });
const fail = (reason) => {
  const error = reason instanceof Error ? reason : null;
  const message = error ? error.message : String(reason);
  log.debug('scenario failed', { reason: message });
  emit('scenario.failed', { reason: message });
  globalThis.__dshComplete(false, message);
};
const demand = (cond, reason) => {
  if (cond) return;
  log.debug('demand failed', { reason });
  fail(reason);
  throw new Error(reason);
};

const launchEnv = () => {
  log.debug('launch env phase begin', {});
  const raw = globalThis.__dshLaunchEnv?.();
  demand(typeof raw === 'string', 'launch env snapshot missing (CLI must pass --env)');
  return JSON.parse(raw);
};

const bootPhase = async (env) => {
  log.debug('boot phase begin', {});
  const resolved = await fsScope.resolve('scope://app/');
  const root = resolved?.path;
  demand(typeof root === 'string' && root.startsWith('/'), `profile container not resolved: ${JSON.stringify(root)}`);
  const { ctx } = await bootUpstream({
    scenario: SCENARIO,
    agentId: AGENT_ID,
    sessionId: SESSION_ID,
    cwd: root,
    onEvent: emit,
    container: {
      cwd: root, scopeRoot: root, tmpdir: `${root}/tmp`, home: `${root}/home`,
      env, argv: ['dsh', '--profile', 'mobile'],
    },
    llm: {
      baseURL: env.DSH_MOCK_LLM_URL,
      apiKey: env.DSH_MOCK_LLM_KEY,
      provider: 'mock',
      kind: 'mock',
      model: 'mock-1',
    },
  });
  // The plugin is BOOT-MOUNTED since the owner decision (2026-10-18): the
  // spine supplies appshell_render/update/catalog on every seat. This leg
  // used to mount it scenario-side; the offeredPhase below is now the proof
  // the boot row actually registered.
  log.debug('boot phase done', { root });
  return ctx;
};

const offeredPhase = (ctx) => {
  log.debug('offered phase begin', {});
  const visible = ctx.tools?.view?.(undefined)?.visible;
  demand(visible instanceof Map, 'the tool layer exposed no visibility view');
  for (const name of TOOLS) {
    demand(visible.has(name), `the appshell tool ${name} is not offered`);
  }
  emit('appshell/offered', { tools: TOOLS.length });
};

/** ONE real agent turn: the mock scripts the appshell_render tool call; the
 * loop dispatches it; the closing success round settles the turn. */
const turnPhase = async (ctx) => {
  log.debug('turn phase begin', {});
  let guard = 0;
  while ((ctx.agents.get(SESSION_ID) === undefined || ctx.sessions.get(SESSION_ID) === undefined)
    && guard++ < 10000) {
    await Promise.resolve();
  }
  demand(ctx.agents.get(SESSION_ID) !== undefined, `agent "${SESSION_ID}" never appeared in the registry`);
  const agent = ctx.agents.get(SESSION_ID);
  emit('appshell/turn/submitted', { input: INPUT_TEXT });
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: INPUT_TEXT }],
    source: { kind: 'user' },
  }));
  await agent.whenIdle();

  const events = ctx.sessions.get(SESSION_ID).snapshotEvents();
  const renderCall = events.find((r) => r.type === 'tool/call' && r.data?.name === 'appshell_render');
  demand(renderCall !== undefined, 'no appshell_render tool/call in the session log');
  emit('appshell/render/tool-called', { name: renderCall.data.name });

  // The plugin's echo rides the tool-result record's text content.
  let echoed = null;
  for (const record of events) {
    if (record.type !== 'tool/result') continue;
    for (const block of record.data?.message?.content ?? []) {
      for (const part of block?.content ?? []) {
        if (part?.type === 'text' && part.text?.startsWith('{"ok"')) {
          try { echoed = JSON.parse(part.text); } catch { /* keep scanning */ }
        }
      }
    }
  }
  demand(echoed !== null, 'no appshell_render echo found in the tool results');
  demand(echoed.ok === true, `the echo is not ok: ${JSON.stringify(echoed).slice(0, 200)}`);
  demand(typeof echoed.surfaceId === 'string' && /^appshell-\d+$/.test(echoed.surfaceId),
    `the echo carries no minted surfaceId: ${JSON.stringify(echoed).slice(0, 200)}`);
  emit('appshell/render/echoed', { ok: true, title: echoed.title });

  const assistant = [...events].reverse().find((r) => r.type === 'assistant/message');
  const text = assistant?.data?.message?.content
    ?.filter((b) => b.type === 'text').map((b) => b.text).join('') ?? '';
  demand(text === CLOSING_TEXT, `closing assistant text is "${text}"`);
  emit('appshell/turn/completed', { text });
  return echoed.surfaceId;
};

/** One tool call through the REAL ToolRuntime dispatch (office.js shape). */
const call = async (ctx, name, args) => {
  log.debug('tool dispatch', { name });
  const outcome = await ctx.tools.execute({
    name, arguments: args,
    callId: `${SCENARIO}.${name}`,
    signal: new AbortController().signal,
  });
  demand(outcome?.isError !== true, `${name} dispatch failed: ${JSON.stringify(outcome?.error ?? outcome).slice(0, 300)}`);
  return outcome.value;
};

/** One tool call whose REFUSAL is the assertion (office.js negativePhase shape). */
const callRefused = async (ctx, name, args, needle) => {
  log.debug('refused dispatch', { name });
  const outcome = await ctx.tools.execute({
    name, arguments: args,
    callId: `${SCENARIO}.${name}.refused`,
    signal: new AbortController().signal,
  });
  demand(outcome?.isError === true, `${name} did not refuse: ${JSON.stringify(outcome).slice(0, 300)}`);
  const text = JSON.stringify(outcome?.error ?? outcome);
  demand(text.includes(needle), `the refusal does not name ${needle}: ${text.slice(0, 200)}`);
  return text;
};

const securityPhase = async (ctx, surfaceId) => {
  log.debug('security phase begin', {});
  // Sixth red-team category: a FORGED surfaceId must be refused before any
  // spec work — cross-surface pollution is an authorization failure, and the
  // refusal is a structured error outcome, never an executable success.
  await callRefused(ctx, 'appshell_update', { surfaceId: 'appshell-999', spec: UPDATE_SPEC }, 'unknown-surface');
  emit('appshell/update/forged-refused', { ok: false, error: 'unknown-surface' });

  // The LIVE surfaceId with a validator-clean spec updates in place.
  const updated = await call(ctx, 'appshell_update', { surfaceId, spec: UPDATE_SPEC });
  demand(updated?.ok === true && updated.surfaceId === surfaceId,
    `live update failed: ${JSON.stringify(updated).slice(0, 200)}`);
  emit('appshell/update/accepted', { ok: true });

  const catalog = await call(ctx, 'appshell_catalog', {});
  demand(typeof catalog?.rules === 'string' && catalog.rules.includes('app-shell/0.9'), 'catalog rules missing the spec version');
  emit('appshell/catalog/served', { vocabulary: true });
};

const main = async () => {
  log.debug('main begin', {});
  const env = launchEnv();
  demand(typeof env.DSH_MOCK_LLM_URL === 'string' && env.DSH_MOCK_LLM_URL.startsWith('http://127.0.0.1:'),
    `the mock LLM URL is not the loopback mock: ${JSON.stringify(env.DSH_MOCK_LLM_URL)}`);
  const ctx = await bootPhase(env);
  emit('session/created', { sessionId: SESSION_ID });
  emit('agent/created', { id: AGENT_ID, sessionId: SESSION_ID });

  offeredPhase(ctx);
  const surfaceId = await turnPhase(ctx);
  await securityPhase(ctx, surfaceId);

  emit('appshell/completed', {
    status: 'pass',
    plugin: 'system-plugins/dsh-appshell (app-shell/0.9, scenario-side mount)',
  });
  globalThis.__dshComplete(true, 'pass');
};

main().catch((e) => fail(e));
