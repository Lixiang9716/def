// dsh:logging-exempt — pure logic; logging stays in the caller (plugin index.js / scenarios).
/**
 * app-shell/0.9 component catalog: the two-layer vocabulary contract.
 *
 * Layer 1 — PRIMITIVES: the only vocabulary that renders. v0 ships the
 * demo-proven eight; the M0 three-source inventory (A2UI v0.9 ∩ x-card ∩
 * Lynx genui) gates additions — a primitive joins only when it is in that
 * intersection, keeping the cross-renderer promise true by construction.
 *
 * Layer 2 — TEMPLATES: authoring sugar. Every template has an expand()
 * that compiles it to a pure primitive tree; the validator runs expand()
 * on every template node, so a template can never smuggle a non-primitive
 * past the whitelist. Cross-renderer compatibility is thereby structural.
 *
 * This file is the single owner of the vocabulary. Component render
 * functions live in lib/render/<name>.js and register through the maps
 * below; they never widen the vocabulary themselves.
 */

export const SPEC_VERSION = 'app-shell/0.9';

/** Hard caps (gate 3). A spec breaching any of these is rejected wholesale. */
export const CAPS = {
  SPEC_BYTES: 32 * 1024,
  NODES: 200,
  DEPTH: 8,
  TEXT_RUNES: 500,
  CHILDREN: 24,
};

/** Gate 4: actions are closed enums declared on the spec, never free strings. */
export const ACTION_RE = /^[a-z][a-z0-9.:-]{0,63}$/;

/** PRIMITIVE registry: name -> render(node, ctx) -> VNode (lib/render/<name>.js). */
export const primitives = new Map();

/** Gate-1 whitelist: the closed primitive vocabulary (single source of truth). */
export const KNOWN_PRIMITIVES = ['text', 'image', 'button', 'row', 'column', 'card', 'progressbar', 'badge'];

/** TEMPLATE registry: name -> { expand(node) -> primitive node }. */
export const templates = new Map();

export function definePrimitive(name, render) {
  primitives.set(name, render);
}

export function defineTemplate(name, def) {
  templates.set(name, def);
}

/** Primitive node factory — what expand() produces and validate() whitelists. */
export function p(type, fields) {
  return { type, ...fields };
}

/* ---------------------------------------------------------------- */
/* Templates (layer 2): demo-proven eight, each expands to primitives. */
/* Colors ride theme.accent / explicit per-item colors as plain style  */
/* values — the validator treats them as inert strings (gate 2).       */
/* ---------------------------------------------------------------- */

defineTemplate('search-bar', {
  expand: (n) => p('card', { style: { borderRadius: '14px', padding: '6px 10px' }, children: [
    p('text', { text: '🔍 ' + String(n.placeholder || '搜索'), size: 'small', tone: 'muted' }),
  ] }),
});

defineTemplate('tab-bar', {
  expand: (n) => p('row', { children: (n.tabs || []).map((t, i) => p('badge', {
    text: t.label + (i === (n.active || 0) ? ' ·' : ''),
  })) }),
});

defineTemplate('chat-row', {
  expand: (n) => p('row', { children: [
    p('badge', { text: (n.avatar && n.avatar.emoji) || '💬' }),
    p('column', { children: [
      p('text', { text: String(n.name || ''), size: 'body' }),
      p('text', { text: String(n.preview || ''), size: 'small', tone: 'muted' }),
    ] }),
    p('text', { text: String(n.time || ''), size: 'small', tone: 'muted' }),
  ] }),
});

defineTemplate('service-grid', {
  expand: (n) => {
    const items = (n.items || []).slice(0, 8).map((it) => p('column', { children: [
      p('badge', { text: (it.icon || '·') }),
      p('text', { text: String(it.label || ''), size: 'small' }),
    ] }));
    const rows = [];
    for (let i = 0; i < items.length; i += 4) rows.push(p('row', { children: items.slice(i, i + 4) }));
    return p('card', { children: rows });
  },
});

defineTemplate('banner-card', {
  expand: (n) => p('card', { children: [
    p('text', { text: String(n.title || ''), size: 'title' }),
    p('text', { text: String(n.subtitle || ''), size: 'small', tone: 'muted' }),
  ] }),
});

defineTemplate('hcard-row', {
  expand: (n) => p('row', { children: (n.items || []).slice(0, 6).map((it) => p('card', { children: [
    p('text', { text: (it.cover && it.cover.emoji) || '🎵' }),
    p('text', { text: String(it.title || ''), size: 'small' }),
    p('text', { text: String(it.sub || ''), size: 'small', tone: 'muted' }),
  ] })) }),
});

defineTemplate('balance-card', {
  expand: (n) => {
    const kids = [
      p('text', { text: String(n.label || ''), size: 'small', tone: 'muted' }),
      p('text', { text: String(n.value || ''), size: 'title' }),
    ];
    if (n.actionLabel) kids.push(p('button', { label: String(n.actionLabel), action: n.action || 'balance.open' }));
    return p('card', { children: kids });
  },
});

defineTemplate('mini-player', {
  expand: (n) => {
    const kids = [
      p('badge', { text: (n.cover && n.cover.emoji) || '🎵' }),
      p('column', { children: [
        p('text', { text: String(n.title || ''), size: 'body' }),
        p('text', { text: String(n.sub || ''), size: 'small', tone: 'muted' }),
      ] }),
    ];
    if (n.action) kids.push(p('button', { label: '▶', action: n.action }));
    return p('card', { children: kids });
  },
});
