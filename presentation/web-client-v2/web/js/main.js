// dsh:logging-exempt (web page: all E2E evidence flows through carrier/runtime logs)
/**
 * main.js — wiring: the mux connection, the two views (home ↔ chat), the
 * timeline subscription (structure renders rebuild the list; tail renders
 * coalesce to one per animation frame, with a timer fallback for throttled
 * webviews), and the composer. The page knows only the loopback HTTP + WS
 * protocol — zero host awareness.
 */

import { rpc, isRemoteError } from './api.js';
import { Mux, muxDiag } from './mux.js';
import { createTimeline } from './timeline.js';
import { createChatRenderer } from './render-chat.js';
import { renderConnection, renderSessionList } from './render-home.js';
import { createComposer } from './composer.js';
import { setupOnboarding } from './onboarding.js';
import { setupMarketplace } from './marketplace.js';
import { setupCreationView, openCreation } from './creation-view.js';
import { handleCardFrame } from './card-face.js';
import { setupAppshell, openSurface as openAppshell, surfaceSpec, createSwarmStrip } from './appshell.js';
import { mergeUpdate } from './appshell-core.js';

const $ = (id) => document.getElementById(id);

const views = { home: $('view-home'), chat: $('view-chat') };
const toastNode = $('toast');
let toastTimer = 0;

const toast = (text) => {
  toastNode.textContent = text;
  toastNode.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastNode.classList.remove('show'), 2600);
};

const shortId = (sessionId) => String(sessionId).slice(0, 8);

const composer = createComposer($('composer'), toast);
setupAppshell();
const mux = new Mux();

// The seat-owned app/cards channel: live card frames AND the in-band
// approval asks (the mount checkpoint's ask rides here; the decision goes
// back through /api/approval/decide — see the dsh-approval-decide listener).
// A synthetic journal record folds the frame into whichever session view is
// open, so the card renders inside the conversation.
mux.open('app/cards', {}, {
  onItem: (value) => {
    if (value?.type?.startsWith('card.')) { handleCardFrame(value); return; }
    if (value?.type === 'approval.request' || value?.type === 'approval.decided') {
      timeline.applyRecord({
        type: 'event',
        event: {
          type: value.type === 'approval.request' ? 'approval/asked' : 'approval/decided',
          data: value,
        },
      });
      return;
    }
    // The in-band user-questions ask (ask_user_question): the card renders
    // the questions with their options; the answer rides /api/question/answer
    // and the parked turn resumes.
    if (value?.type === 'question.request' || value?.type === 'question.decided') {
      timeline.applyRecord({
        type: 'event',
        event: {
          type: value.type === 'question.request' ? 'question/asked' : 'question/decided',
          data: value,
        },
      });
    }
  },
});

/** The app-shell action loop-back: wait out the authoring turn's drain
 * window, then submit the tagged turn — retrying if the host answers
 * session/busy (dev carrier) instead of silently dropping the action. */
const submitAppshellAction = async (action, label) => {
  const text = `[appshell:${action}] ${label || '界面交互'}`;
  const deadline = Date.now() + 15000;
  while (composer.isGenerating() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  let accepted = await composer.submitText(text);
  while (!accepted && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    accepted = await composer.submitText(text);
  }
  if (accepted) toast(`动作已回流：${label || action}`);
  else toast(`动作未能回传（${action}）`);
};

/** Deploys the presented surface for an appshell_render result. */
const onOpenAppshell = (payload) => {
  openAppshell({
    title: payload.title || 'App',
    spec: payload.spec,
    onAction: (action, label) => submitAppshellAction(action, label),
  });
};

// The swarm strip: one prompt, three pen-identity variant cards growing
// side-by-side above the composer (the conversation flow itself keeps its
// normal timeline cards). Promoting a completed variant rides the SAME
// presented-surface seam as onOpenAppshell — openSurface, nothing new.
const swarmStrip = createSwarmStrip($('swarm-strip'), {
  onPromote: ({ title, spec }) => {
    openAppshell({
      title,
      spec,
      onAction: (action, label) => submitAppshellAction(action, label),
    });
  },
});

// The appshell_update auto-apply (D-4's single-surface in-place replace): a
// completed update whose echo carries a spec re-renders the OPEN surface
// without a click — the loop-back's user-visible end. Once per callId (the
// fold re-renders items on structure bumps); the update card's own open
// button stays for surfaces opened later.
const appliedAppshellUpdates = new Set();

const maybeAutoApplyAppshellUpdate = () => {
  if (timeline === null) return;
  const view = document.getElementById('appshell-view');
  if (!view || view.hidden) return; // no open surface: the card button covers it
  for (const item of timeline.items) {
    if (item?.kind !== 'tool' || item.name !== 'appshell_update' || item.status !== 'ok') continue;
    if (appliedAppshellUpdates.has(item.callId)) continue;
    let payload = null;
    try { payload = JSON.parse(item.output || ''); } catch { continue; }
    if (payload?.ok !== true || !payload.spec) continue;
    appliedAppshellUpdates.add(item.callId);
    // The payload may be INCREMENTAL (screen [+theme/tabs]) — merged over
    // the open surface's spec, the plugin's own merge semantics, before the
    // surface re-renders in place. A full payload merges to itself.
    const base = surfaceSpec();
    const merged = mergeUpdate(base, payload.spec);
    if (merged === null) continue;
    openAppshell({
      title: document.getElementById('appshell-title-text')?.textContent || payload.title || 'App',
      spec: merged,
      onAction: (action, label) => submitAppshellAction(action, label),
    });
  }
};

let connState = 'connecting';
let activeSessionId = null;
let timeline = null;
let renderer = null;
let followStream = null;

// ---- chrome --------------------------------------------------------------

const refreshChrome = () => {
  if (timeline === null) return;
  const title = typeof timeline.meta.title === 'string'
    && timeline.meta.title !== '' ? timeline.meta.title : shortId(activeSessionId);
  $('chat-title').textContent = title;
  const running = timeline.running;
  composer.setRunning(running);
  if (running) $('chat-status').textContent = '生成中';
  else if (connState === 'closed') $('chat-status').textContent = '连接断开';
  else if (connState !== 'open') $('chat-status').textContent = '重连中…';
  else $('chat-status').textContent = '';
};

// ---- home ----------------------------------------------------------------

const refreshSessions = async () => {
  try {
    const value = await rpc('session/list');
    renderSessionList(
      $('session-list'), $('session-list-empty'),
      Array.isArray(value?.items) ? value.items : [],
      openSession);
  } catch (error) {
    toast(isRemoteError(error) ? `会话列表不可用（${error.code}）` : '会话列表不可用');
  }
};

// ---- def home: the app inventory (the product's core visible surface) ----

let appGridRetries = 0;

/** The workspace's created-app directories: every workspace child directory
 * holding an index.html is a delivered app (the present contract's on-disk
 * spelling). The plugin registry is the v2.1 install plane; until a
 * creation installs, the delivered files ARE the app (measured 2026-10-28:
 * the netease-music run left four files and an empty plugin roster). */
const refreshCreatedApps = async () => {
  const dirs = [];
  try {
    const value = await rpc('workspaceFiles/list', { args: { path: '.' } });
    const entries = Array.isArray(value?.entries) ? value.entries : [];
    for (const entry of entries) {
      if ((entry.type ?? entry.kind) !== 'directory') continue;
      const name = entry.name;
      if (!name || name.startsWith('.') || name === 'app-scope' || name === 'vendor') continue;
      try {
        await rpc('workspaceFiles/stat', { args: { path: `${name}/index.html` } });
        dirs.push(name);
      } catch { /* no entry HTML — not an app face */ }
    }
  } catch { /* the files face unavailable: the grid degrades to installed-only */ }
  return dirs;
};

/** The home card grid rows: installed plugins (the mount plane) + the
 * workspace's created apps (the deliverable plane), deduplicated by name. */
const refreshApps = async () => {
  const grid = $('app-grid');
  const emptyNote = $('app-grid-empty');
  if (!grid) return;
  const [plugins, createdDirs] = await Promise.all([
    rpc('pluginInventory/list')
      .then((value) => (Array.isArray(value?.plugins) ? value.plugins : []))
      .catch(() => []),
    refreshCreatedApps(),
  ]);
  const createdNames = new Set(createdDirs);
  const rows = [
    ...createdDirs.map((name) => ({ app: name, created: true })),
    ...plugins.filter((plugin) => !createdNames.has(plugin.name ?? plugin.id)),
  ];
  grid.replaceChildren(...rows.map((row, i) => {
    const label = row.created ? row.app : (row.app.name ?? row.app.id ?? '');
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'app-card glass';
    card.setAttribute('role', 'listitem');
    const hue = (i * 47) % 360;
    card.innerHTML = `
      <div class="app-card-face" style="background:linear-gradient(140deg, hsl(${hue} 45% 30%), hsl(${(hue + 40) % 360} 40% 22%))">
        <span class="app-card-glyph" aria-hidden="true">${label.slice(0, 2)}</span>
      </div>
      <div class="app-card-title">${label}</div>
      <div class="app-card-meta">${row.created ? '已交付' : (row.app.enabled === false ? '未启用' : '已挂载')}</div>`;
    card.addEventListener('click', () => {
      if (row.created) openCreation(`${row.app}/index.html`, label);
      else openAppCard(row.app);
    });
    return card;
  }));
  emptyNote.hidden = rows.length > 0;
  // The boot-race guard: the first refresh often lands while the runtime is
  // still materializing (the mux opens before the spine answers), so an
  // empty grid retries a bounded few times before conceding.
  if (rows.length === 0 && appGridRetries < 10) {
    appGridRetries += 1;
    setTimeout(refreshApps, 4000);
  } else if (rows.length > 0) {
    appGridRetries = 0;
  }
};

/** Open one app card: the fullscreen face + the talk-to-this-app chat. */
const openAppCard = (plugin) => {
  toast(`${plugin.name ?? plugin.id}:卡面全屏与 App 会话在 v2.1`);
};

/** The creation flow: the light form → an appgen session → the seeded
 * creation prompt (the appgen preset's playbook takes over from there). */
$('new-app').addEventListener('click', () => {
  const form = $('new-app-form');
  form.querySelector('#new-app-name').value = '';
  form.querySelector('#new-app-desc').value = '';
  form.showModal();
});
$('new-app-form-inner').addEventListener('submit', async (event) => {
  if (event.submitter?.value !== 'ok') return;
  const name = $('new-app-name').value.trim();
  const desc = $('new-app-desc').value.trim();
  if (!name || !desc) return;
  try {
    const value = await rpc('session/create', { args: { request: { preset: 'appgen' } } });
    const sessionId = value?.sessionId;
    if (typeof sessionId !== 'string') throw new Error('no sessionId');
    openSession(sessionId);
    const prompt = `创建一个名为「${name}」的移动 App:${desc}。单文件 HTML、390px、深色主题、真实可交互;写完用 present 交付。`;
    const deadline = Date.now() + 15000;
    while (composer.isGenerating() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    let accepted = await composer.submitText(prompt);
    while (!accepted && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      accepted = await composer.submitText(prompt);
    }
    toast(accepted ? `开始创建「${name}」` : `创建流已打开,请手动发送「${name}」的描述`);
  } catch (error) {
    toast(isRemoteError(error) ? `创建失败（${error.code}）` : '创建失败');
  }
});

const showView = (name) => {
  for (const [key, node] of Object.entries(views)) node.hidden = key !== name;
};

const onConnStatus = (status) => {
  connState = status;
  renderConnection($('conn-capsule'), status);
  refreshChrome();
  if (status === 'open') { refreshSessions(); refreshApps(); }
};
mux.onStatus(onConnStatus);

$('new-session').addEventListener('click', async () => {
  try {
    const value = await rpc('session/create', { args: { request: {} } });
    const sessionId = value?.sessionId;
    if (typeof sessionId !== 'string') throw new Error('no sessionId');
    openSession(sessionId);
  } catch (error) {
    toast(isRemoteError(error) ? `创建失败（${error.code}）` : '创建失败');
  }
});

$('back-home').addEventListener('click', () => {
  leaveSession();
  showView('home');
  refreshSessions();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !views.home.hidden) refreshSessions();
});

// ---- chat ----------------------------------------------------------------

const leaveSession = () => {
  if (followStream !== null) {
    mux.cancel(followStream);
    followStream = null;
  }
  swarmStrip.clear();
  timeline = null;
  renderer = null;
  activeSessionId = null;
};

const openSession = (sessionId) => {
  leaveSession();
  activeSessionId = sessionId;
  timeline = createTimeline();
  timeline.subscribe((kind) => {
    if (renderer === null) return;
    // Both kinds render SYNCHRONOUSLY from the network event — the
    // official page's model. A rAF/timer-coalesced tail never fires in a
    // throttled or occluded WKWebView (the drive's WebView is exactly
    // that), and the frame cadence here is human-paced anyway.
    if (kind === 'structure') renderer.renderStructure(timeline);
    else renderer.renderTail(timeline);
    swarmStrip.reconcile(timeline); // both tiers: the strip grows on tail bumps, settles on structure
    maybeAutoApplyAppshellUpdate();
    refreshChrome();
  });
  renderer = createChatRenderer($('transcript'), $('jump-latest'), { onOpenAppshell });
  renderer.renderStructure(timeline);
  composer.bind(sessionId);
  showView('chat');
  composer.focus();
  followStream = mux.open('session/follow', {
    args: { request: { address: { sessionId }, assistantStream: true } },
  }, {
    onItem: (value) => timeline.applyRecord(value),
    onError: (error) => {
      toast(`会话流不可用（${error?.code ?? 'unknown'}）`);
      leaveSession();
      showView('home');
    },
    onEnd: () => { followStream = null; },
  });
};




composer.onSent(() => {
  // The durable user/message echoes over the journal; nothing optimistic
  // to add — the send clears the input and the turn streams live.
});

// ---- boot ----------------------------------------------------------------

// The diagnostic face the on-device probe reads in failure forensics.
window.__dshTimelineDebug = () => ({
  sessionId: activeSessionId,
  rendererAlive: renderer !== null,
  items: timeline?.items.length ?? -1,
  tail: !!timeline?.tail,
  kind: timeline?.items.at(-1)?.kind ?? 'none',
  kinds: timeline?.items.map((item) => item.kind).join(',') ?? '',
  mux: { frames: muxDiag.frames, routed: muxDiag.routed,
    dropped: muxDiag.dropped, throws: muxDiag.throws, closes: muxDiag.closes },
  notify: timeline?.notifyDebug ?? null,
});
window.__dshForceRender = () => renderer?.renderStructure(timeline);

// The BYOK first-run panel: detects the no-credential boot and onboards
// (provider + key + test + keychain save); configured users never see it.
setupOnboarding({ mux, rpc, toast, onReady: refreshSessions });

// The plugin marketplace panel: browse the signed catalog, install with a
// live progress fold, manage installed plugins (all through the runtime's
// marketplace face — the page invents nothing).
setupMarketplace({ mux, rpc, toast, onReady: refreshSessions });

setupCreationView({ toast });
showView('home');
mux.connect();
refreshSessions();

// ---- cold-start resume ----------------------------------------------------

// The cold-start resume (T-0212): a returning user lands straight in the
// most recently updated session the runtime lists. SCOPE NOTE: the list is
// the live store, and boot re-seeds only the CONFIGURED session — so the
// auto-open hits today when that session carries journal (the restart legs'
// shape); page-created conversations are not yet re-attached after a
// restart (the list-merge/re-attach seam is deferred, see the T-0212 note).
// The open rides the ONE session channel (openSession) — mux follow, and
// the journal's snapshot opening frame replays through the same timeline
// fold the live events use, so a resumed journal renders with zero
// resume-specific code. An empty list keeps today's create path (the
// 新会话 button); home stays reachable (返回 button) exactly as before.
const waitColdStartSettled = async (deadlineMs = 20000) => {
  const start = Date.now();
  for (;;) {
    // Both boot decisions ride the mux-open event: the connection state and
    // the BYOK panel's verdict (onboarding.js marks its panel `settled` on
    // every detect exit). Poll with a deadline — bounded, never a blind wait.
    if (connState === 'open' && $('onboarding')?.dataset.settled === 'true') return true;
    if (Date.now() - start > deadlineMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
};

const autoOpenLatestSession = async () => {
  if (!(await waitColdStartSettled())) return; // mux never opened: stay home
  if (!$('onboarding').hidden) return; // the first-run BYOK panel owns this boot
  if (activeSessionId !== null) return; // already in a session (defensive)
  let items = [];
  try {
    const value = await rpc('session/list');
    items = Array.isArray(value?.items) ? value.items : [];
  } catch {
    return; // a list failure stays on home (refreshSessions already toasts)
  }
  // The runtime orders by header.createdAt (the closest field it has); this
  // page's contract is "most recently UPDATED first" — the sort lives here
  // so a future server-side updatedAt only sharpens it. Blank sessions
  // (seq === 0, e.g. the bare boot-seeded agent session) are skipped: an
  // auto-open must never land on an empty shell.
  const latest = items
    .filter((item) => item?.blank !== true && typeof item?.sessionId === 'string')
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
  if (latest !== undefined) openSession(latest.sessionId);
};
autoOpenLatestSession();
