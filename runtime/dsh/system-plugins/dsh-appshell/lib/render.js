// dsh:logging-exempt — pure logic; logging stays in the caller (plugin index.js / scenarios).
/**
 * Render pipeline: validate -> expand -> primitive renderers -> VNode.
 *
 * The eight primitive renderers are the reference implementation of the
 * component contract: (node, ctx) -> VNode, pure, theme via ctx.accent,
 * text always as VNode text props (never markup). The browser mount layer
 * is M2 and is the only DOM-touching code in the whole feature.
 */

import { validate } from './validate.js';
import { definePrimitive, primitives } from './catalog.js';
import { h } from './vnode.js';

const TONE_COLOR = { accent: 'var(--p-accent)', muted: '#8a9199', default: '#1f2328' };
const SIZE_FONT = { title: '16px', body: '13px', small: '11px' };

function renderNode(node, ctx) {
  const fn = primitives.get(node.type);
  if (!fn) throw new Error('no renderer for primitive "' + node.type + '" (validator let this through — defect)');
  return fn(node, ctx);
}

/* --- the eight primitive renderers ------------------------------------ */

function textNode(n) {
  const cls = 'ash-text ash-' + (n.size || 'body') + (n.tone ? ' ash-' + n.tone : '');
  return h('div', { class: cls, style: { color: TONE_COLOR[n.tone] || TONE_COLOR.default, fontSize: SIZE_FONT[n.size] || SIZE_FONT.body }, text: n.text });
}
function imageNode(n) {
  return h('div', { class: 'ash-image', style: { background: n.color || 'var(--p-accent)' }, text: n.emoji || '🖼' });
}
function buttonNode(n, ctx) {
  return h('button', { class: 'ash-btn', style: { background: ctx.accent }, text: n.label, attrs: { 'data-action': n.action } });
}
function rowNode(n, ctx) {
  return h('div', { class: 'ash-row' }, n.children.map((c) => renderNode(c, ctx)));
}
function columnNode(n, ctx) {
  return h('div', { class: 'ash-col' }, n.children.map((c) => renderNode(c, ctx)));
}
function cardNode(n, ctx) {
  return h('div', { class: 'ash-card' }, n.children.map((c) => renderNode(c, ctx)));
}
function progressNode(n) {
  return h('div', { class: 'ash-progress', style: { width: Math.max(0, Math.min(100, n.value || 0)) + '%' }, text: n.label || '' });
}
function badgeNode(n) {
  return h('span', { class: 'ash-badge', text: n.text });
}

/* --- registration + pipeline ------------------------------------------- */

for (const [name, fn] of Object.entries({
  text: textNode, image: imageNode, button: buttonNode, row: rowNode,
  column: columnNode, card: cardNode, progressbar: progressNode, badge: badgeNode,
})) {
  if (!primitives.has(name)) {
    // Seed registration. lib/render/<name>.js files may override per-component
    // as they land (M2 legs); the pipeline only consults the map.
    definePrimitive(name, fn);
  }
}

/**
 * Full pipeline: validate a spec, then render the expanded tree to VNode.
 * @returns {{ ok: boolean, errors?: object[], vnode?: object }}
 */
export function renderSpec(spec, ctx) {
  const { ok, errors, expanded } = validate(spec);
  if (!ok) return { ok: false, errors };
  const accent = (spec.theme && spec.theme.accent) || '#1677ff';
  const background = (spec.theme && spec.theme.background) || undefined;
  return { ok: true, vnode: renderNode(expanded, { accent, background, ...ctx }) };
}
