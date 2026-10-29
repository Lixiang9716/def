// dsh:logging-exempt (web page: all E2E evidence flows through carrier/runtime logs)
/**
 * appshell.js — the DOM half of the app-shell seam: fullscreen presented
 * surface (the creation-viewer posture, minus the sandbox — the catalog
 * renders declarative primitives with textContent, never markup), plus the
 * timeline preview card renderer. Actions flow back as tagged user turns;
 * tab-like local state never leaves the page.
 */

import { checkShallow, expandSpec, swarmCardModel } from './appshell-core.js';

let activeActionHandler = null;
let currentSurfaceSpec = null;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Primitive renderers: (node, ctx) → DOM element. Text only ever rides
 * textContent — markup in model-authored strings is structurally inert. */
const PRIMITIVE_RENDER = {
  text: (n) => el('div', 'ash-text ash-' + (n.size || 'body') + (n.tone ? ' ash-' + n.tone : ''), String(n.text ?? '')),
  image: (n) => { const d = el('div', 'ash-image', String(n.emoji || '🖼')); if (n.color) d.style.background = 'color-mix(in srgb, ' + n.color + ' 14%, #ffffff)'; return d; },
  button: (n, ctx) => {
    const btn = el('button', 'ash-btn', String(n.label ?? ''));
    btn.type = 'button';
    btn.style.background = ctx.accent;
    btn.addEventListener('click', () => { if (ctx.onAction) ctx.onAction(n.action, n.label); });
    return btn;
  },
  row: (n, ctx) => { const d = el('div', 'ash-row'); for (const c of n.children || []) d.appendChild(renderPrimitive(c, ctx)); return d; },
  column: (n, ctx) => { const d = el('div', 'ash-col'); for (const c of n.children || []) d.appendChild(renderPrimitive(c, ctx)); return d; },
  card: (n, ctx) => { const d = el('div', 'ash-card'); for (const k of ['borderRadius', 'padding']) { if (n.style && n.style[k]) d.style[k] = String(n.style[k]); } for (const c of n.children || []) d.appendChild(renderPrimitive(c, ctx)); return d; },
  progressbar: (n) => {
    const track = el('div', 'ash-progress-track');
    const bar = el('div', 'ash-progress-bar', String(n.label ?? ''));
    bar.style.width = Math.max(0, Math.min(100, Number(n.value) || 0)) + '%';
    track.appendChild(bar);
    return track;
  },
  badge: (n) => el('span', 'ash-badge', String(n.text ?? '')),
};

function renderPrimitive(node, ctx) {
  const fn = PRIMITIVE_RENDER[node.type];
  if (!fn) return el('div', 'ash-text', '（目录外组件已拦截）');
  return fn(node, ctx);
}

/** Small inline preview for the timeline tool card. */
export function renderPreview(spec) {
  const host = el('div', 'appshell-preview');
  const check = checkShallow(spec);
  if (!check.ok) {
    host.appendChild(el('div', 'ash-text', 'spec 未通过客户端校验（' + (check.errors[0]?.code || 'unknown') + '）'));
    return host;
  }
  const ctx = { accent: (spec.theme && spec.theme.accent) || '#1677ff', onAction: null };
  for (const c of check.screen.children || []) host.appendChild(renderPrimitive(c, ctx));
  return host;
}

/** Open (or replace) the fullscreen presented surface. The theme accent is
 * injected as a CSS variable on the surface — every primitive reads it. */
export function openSurface({ title, spec, onAction }) {
  const view = document.getElementById('appshell-view');
  if (!view) return false;
  activeActionHandler = onAction || null;
  currentSurfaceSpec = spec;
  view.style.setProperty('--p-accent', (spec.theme && spec.theme.accent) || '#1677ff');
  const background = spec.theme && typeof spec.theme.background === 'string' ? spec.theme.background : '';
  if (background) view.style.setProperty('--p-surface-bg', background);
  else view.style.removeProperty('--p-surface-bg');
  view.dataset.mode = (spec.theme && spec.theme.mode) === 'dark' ? 'dark' : 'light';
  const root = document.getElementById('appshell-root');
  root.replaceChildren();
  document.getElementById('appshell-title-text').textContent = title || 'App';
  const check = checkShallow(spec);
  if (!check.ok) {
    root.appendChild(el('div', 'ash-text', 'spec 未通过客户端校验：' + check.errors.map((e) => e.code).join('、')));
  } else {
    const ctx = { accent: (spec.theme && spec.theme.accent) || '#1677ff', onAction: activeActionHandler };
    const tabs = el('div', 'ash-tabbar');
    for (const [i, t] of (spec.tabs || []).entries()) {
      const tab = el('span', 'ash-tab' + (i === 0 ? ' active' : ''), t);
      // Local-only interaction: tab state never leaves the page (no turn).
      tab.addEventListener('click', () => {
        for (const other of tabs.children) other.classList.remove('active');
        tab.classList.add('active');
      });
      tabs.appendChild(tab);
    }
    root.appendChild(tabs);
    for (const c of check.screen.children || []) root.appendChild(renderPrimitive(c, ctx));
  }
  view.hidden = false;
  return true;
}

/** The spec the open surface was rendered from — the merge base for
 * incremental appshell_update payloads (null when no surface is open). */
export const surfaceSpec = () => currentSurfaceSpec;

export function closeSurface() {
  const view = document.getElementById('appshell-view');
  if (view) view.hidden = true;
  activeActionHandler = null;
  currentSurfaceSpec = null;
}

/** Wire the static chrome (close button). Call once from main.js. */
export function setupAppshell() {
  const close = document.getElementById('appshell-close');
  close?.addEventListener('click', closeSurface);
}

// ---- the swarm strip (staged variant cards) -----------------------------------

/** Fold the timeline's swarm state: the streaming tail's builders (growing)
 * and the durable appshell_render items (settled), keyed by callId, keeping
 * only the LATEST swarm turn's variants. Durable items win over tail
 * builders of the same callId (the promotion preserves the streamed args). */
const collectSwarmCards = (timeline) => {
  const found = new Map();
  const tail = timeline?.tail;
  for (const [id, tool] of tail?.tools ?? []) {
    const model = swarmCardModel(tool.args ?? '');
    if (model) found.set(id, { ...model, status: 'growing', output: '', turn: tail.turn ?? 0 });
  }
  for (const item of timeline?.items ?? []) {
    if (item?.kind !== 'tool' || item.name !== 'appshell_render') continue;
    const model = swarmCardModel(item.args ?? '');
    if (model) found.set(item.callId, { ...model, status: item.status, output: item.output ?? '', turn: item.turn ?? 0 });
  }
  let latestTurn = -1;
  for (const entry of found.values()) latestTurn = Math.max(latestTurn, entry.turn);
  const kept = new Map();
  for (const [id, entry] of found) if (entry.turn === latestTurn) kept.set(id, entry);
  return kept;
};

/** The swarm strip's private state — module-level functions carry it (the
 * timeline.js pattern), so no function outgrows the code-size gate. */
const makeStripState = (host, opts) => ({
  host, opts,
  cards: new Map(), // callId → {root, penName, chip, body, cursor, label, status}
  latest: new Map(), // callId → last rendered entry (the click reads this)
  promoted: new Set(),
});

const promoteSwmCard = (state, callId, root) => {
  const entry = state.latest.get(callId);
  if (!entry || entry.status !== 'ok' || typeof state.opts.onPromote !== 'function') return;
  let payload = null;
  try { payload = JSON.parse(entry.output || ''); } catch { return; }
  if (payload?.ok !== true || !payload.spec) return;
  state.promoted.add(callId);
  root.classList.add('swm-card--selected');
  state.opts.onPromote({ title: payload.title || entry.pen, spec: payload.spec, pen: entry.pen });
};

const buildSwmCard = (state, callId) => {
  const root = el('div', 'swm-card');
  const head = el('div', 'swm-head');
  const penName = el('span', 'swm-pen-name');
  head.appendChild(el('span', 'swm-pen-dot'));
  head.appendChild(penName);
  const chip = el('span', 'swm-chip');
  head.appendChild(chip);
  const body = el('div', 'swm-body');
  const cursor = el('div', 'swm-cursor');
  cursor.appendChild(el('span', 'swm-cursor-nib'));
  const label = el('span', 'swm-cursor-label');
  cursor.appendChild(label);
  cursor.hidden = true;
  root.appendChild(head);
  root.appendChild(body);
  root.appendChild(cursor);
  root.addEventListener('click', () => promoteSwmCard(state, callId, root));
  return { root, penName, chip, body, cursor, label, status: '' };
};

const flashDone = (card) => {
  card.root.classList.add('swm-card--done');
  setTimeout(() => card.root.classList.remove('swm-card--done'), 900);
};

/** The pen cursor's rest position: the element at the growth index — the
 * first ghost while parts are pending, else the last closed child. The
 * cursor overlays the CARD, so the body's own offset rides along. */
const positionCursor = (card, entry) => {
  const nodes = card.body.children;
  const at = nodes[Math.min(entry.growth, nodes.length - 1)];
  const y = card.body.offsetTop + (at ? at.offsetTop : 0);
  card.cursor.style.transform = 'translate(4px, ' + y + 'px)';
};

/** Growing renders the certainly-closed prefix (plus ghost slots); ok
 * re-renders from the authoritative echo — the same bytes the promoted
 * surface would render, which is what makes the card's DOM parity
 * checkable at the L4 bar. */
const renderSwmCard = (card, entry) => {
  card.root.style.setProperty('--swm-accent', entry.accent);
  card.penName.textContent = entry.pen;
  card.label.textContent = entry.pen;
  card.chip.textContent = entry.status === 'ok' ? '完成' : entry.status === 'fail' ? '失败' : '生成中';
  card.root.classList.toggle('swm-card--active', entry.status === 'growing');
  if (card.status === 'growing' && entry.status === 'ok') flashDone(card);
  card.status = entry.status;
  let children = entry.closed;
  if (entry.status === 'ok') {
    try {
      const payload = JSON.parse(entry.output || '');
      if (payload?.ok === true && payload.spec?.screen) children = payload.spec.screen.children ?? [];
    } catch { /* echo not parseable: keep the closed prefix */ }
  }
  const expanded = expandSpec({ spec: 'app-shell/0.9', screen: { type: 'column', children } });
  const ctx = { accent: entry.accent, onAction: null };
  const kids = [];
  for (const node of expanded.screen?.children ?? []) kids.push(renderPrimitive(node, ctx));
  if (entry.status === 'growing') {
    for (let g = 0; g < entry.ghosts; g += 1) kids.push(el('div', 'swm-ghost'));
  }
  card.body.replaceChildren(...kids);
  // Position while still hidden, then unhide: a first appearance LANDS at
  // the growth point (display:none cannot transition); later updates
  // retarget the glide from wherever the pen visually rests.
  if (entry.status === 'growing') positionCursor(card, entry);
  card.cursor.hidden = entry.status !== 'growing';
};

const reconcileSwarm = (state, timeline) => {
  const found = collectSwarmCards(timeline);
  for (const [id, card] of state.cards) {
    if (!found.has(id)) { card.root.remove(); state.cards.delete(id); }
  }
  for (const [id, entry] of found) {
    let card = state.cards.get(id);
    if (!card) { card = buildSwmCard(state, id); state.cards.set(id, card); }
    card.root.style.order = String(entry.slot || 99);
    state.host.appendChild(card.root);
    if (state.promoted.has(id)) card.root.classList.add('swm-card--selected');
    state.latest.set(id, entry);
    renderSwmCard(card, entry);
  }
  state.host.hidden = found.size === 0;
};

const clearSwarm = (state) => {
  state.cards.clear();
  state.latest.clear();
  state.promoted.clear();
  state.host.replaceChildren();
  state.host.hidden = true;
};

/** The swarm strip: side-by-side variant cards, one per pen. While a card
 * grows, its certainly-closed components render immediately, the
 * not-yet-arrived slots show translucent dashed ghost boxes, and the pen
 * cursor rests on the growth point (a CSS transition glides it; reduced
 * motion lands it instantly). Clicking a completed card promotes it through
 * the caller's onPromote (main.js reuses openSurface); the others stay
 * selectable. Event-driven only: reconcile() is called from the timeline
 * subscription, never on a timer. */
export function createSwarmStrip(host, opts = {}) {
  if (!host) return { reconcile: () => {}, clear: () => {} };
  const state = makeStripState(host, opts);
  return {
    reconcile: (timeline) => reconcileSwarm(state, timeline),
    clear: () => clearSwarm(state),
  };
}
