// dsh:logging-exempt (web page: all E2E evidence flows through carrier/runtime logs)
/**
 * card-face.js — the web half of the mounted-plugin live card (the
 * CardPlayerSurface's web sibling): card.present/state/complete frames on
 * the app/cards channel render as a floating mini card on the home view.
 * The device renders natively; the web face is the same contract verbatim
 * (id/title/subtitle/kind + remainingMs state + the completion message).
 */

let els = null;
let ticker = null;
let anchor = 0;
let remainingMs = 0;

const ensureDom = () => {
  if (els !== null) return;
  const host = document.createElement('div');
  host.id = 'live-card';
  host.className = 'live-card glass';
  host.setAttribute('role', 'status');
  host.innerHTML = `
    <div class="live-card-head">
      <span class="live-card-glyph" aria-hidden="true">◆</span>
      <span class="live-card-title"></span>
      <button type="button" class="live-card-close" aria-label="关闭">×<\/button>
    </div>
    <div class="live-card-sub"></div>
    <div class="live-card-meta"></div>`;
  document.body.appendChild(host);
  host.querySelector('.live-card-close').addEventListener('click', () => hide());
  els = {
    host,
    title: host.querySelector('.live-card-title'),
    sub: host.querySelector('.live-card-sub'),
    meta: host.querySelector('.live-card-meta'),
  };
};

const hide = () => {
  if (els === null) return;
  els.host.remove();
  els = null;
  if (ticker !== null) { clearInterval(ticker); ticker = null; }
};

const renderRemaining = () => {
  if (els === null) return;
  const left = Math.max(0, Math.ceil(remainingMs / 1000));
  els.meta.textContent = left > 0 ? `剩余 ${left}s` : '';
};

/** The app/cards frame entry (call from the mux subscription). */
export const handleCardFrame = (value) => {
  if (value?.type === 'card.present') {
    const card = value.card ?? {};
    ensureDom();
    els.title.textContent = card.title ?? card.id ?? '卡片';
    els.sub.textContent = card.subtitle ?? '';
    remainingMs = Number.isFinite(card.durationMs) ? card.durationMs : 0;
    anchor = Date.now();
    renderRemaining();
    if (ticker === null) {
      ticker = setInterval(() => {
        remainingMs = Math.max(0, remainingMs - (Date.now() - anchor));
        anchor = Date.now();
        renderRemaining();
      }, 500);
    }
  } else if (value?.type === 'card.state' && els !== null) {
    const state = value.state ?? {};
    if (typeof state.remainingMs === 'number') remainingMs = state.remainingMs;
    if (typeof state.label === 'string') els.sub.textContent = state.label;
    renderRemaining();
  } else if (value?.type === 'card.complete' && els !== null) {
    if (ticker !== null) { clearInterval(ticker); ticker = null; }
    els.meta.textContent = value.message ?? '完成';
    setTimeout(hide, 2500);
  }
};
