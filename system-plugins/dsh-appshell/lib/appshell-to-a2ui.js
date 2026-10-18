// dsh:logging-exempt — pure mapping layer; logging stays in the caller.
/**
 * appshell-to-a2ui.js — converts an expanded app-shell/0.9 primitive tree
 * (the `expanded` output from validate()) into the A2UI v0.9 messages that
 * @lynx-js/genui v0.7.0 accepts. This is the cross-renderer bridge: the
 * SAME spec drives both the web DOM renderer and the Lynx A2UI renderer.
 *
 * The mapping is constrained by genui's frozen basic catalog (22 components,
 * a2ui/dist/catalog.json in the package). Structural facts it dictates:
 *   - containers reference children by id; Row/Column take `children`
 *     arrays, Card and Button take a SINGLE `child` — so a multi-kid card
 *     compiles to Card → Column, and a button label compiles to a Text kid.
 *   - actions are `{ event: { name } }`, never bare strings.
 *   - Text carries `variant` (body/caption/h1..h5), not `size`/`style`.
 * Three app-shell primitives have no display twin in the catalog; each maps
 * to a catalog-valid substitute (M5 gap ledger, plan §M5 item 2):
 *   badge       → Text (caption)        — no Badge component
 *   image       → Text (emoji avatar)   — catalog Image requires a url
 *   progressbar → Slider (0..100)       — no display-only progress component
 * Accent color is NOT emitted per node: the catalog has no style props, so
 * the theme travels with the surface (createSurface.theme), which is the
 * portable part of the cross-renderer promise — structure here, skin there.
 */

import { validate } from './validate.js';

/** app-shell primitive → genui basic catalog component name. */
const TYPE_MAP = {
  text: 'Text',
  image: 'Text',
  button: 'Button',
  row: 'Row',
  column: 'Column',
  card: 'Card',
  progressbar: 'Slider',
  badge: 'Text',
};

/** app-shell text size → catalog Text variant. */
const VARIANT_MAP = { title: 'h4', body: 'body', small: 'caption' };

let _n = 0;
const uid = (prefix) => `${prefix}-${++_n}`;

/** Text component with a catalog variant — the leaf every text-ish primitive lands on. */
function textEntry(node, variant) {
  return { id: uid('text'), component: 'Text', text: String(node.text ?? node.emoji ?? node.label ?? ''), variant };
}

/** Convert one expanded primitive node into catalog-valid entries appended
 * to `out` (flat array). `id` is the entry's id — the root call passes
 * `root`, which genui's MessageProcessor prefers when detecting the surface
 * root. */
function convertNode(node, out, id) {
  const component = TYPE_MAP[node.type];
  if (!component) {
    // Fail loud, never silently degrade an unexpanded template to Text.
    throw new Error('expandedToA2UI needs the expanded tree from validate() — "' + node.type + '" is not a primitive');
  }
  if (node.type === 'text') { out.push({ ...textEntry(node, VARIANT_MAP[node.size] || 'body'), id }); return id; }
  if (node.type === 'badge') { out.push({ ...textEntry(node, 'caption'), id }); return id; }
  if (node.type === 'image') { out.push({ ...textEntry(node, 'h4'), id }); return id; }
  if (node.type === 'progressbar') {
    out.push({
      id, component: 'Slider', label: String(node.label || ''),
      min: 0, max: 100, value: Math.max(0, Math.min(100, node.value || 0)),
    });
    return id;
  }
  if (node.type === 'button') {
    const label = textEntry({ text: node.label }, 'body');
    out.push(label);
    // catalog Button requires `action`; an app-shell button may omit it —
    // 'tap' is the mechanical fallback (matches ACTION_RE, undeclared in
    // spec.actions, which the app-shell validator permits for absent ids).
    const entry = {
      id, component: 'Button', child: label.id, variant: 'primary',
      action: { event: { name: node.action || 'tap' } },
    };
    out.push(entry);
    return id;
  }
  const kids = (node.children || []).map((c) => convertNode(c, out, uid(c.type)));
  if (node.type === 'card') {
    // Card.child is singular — wrap the kids in a Column.
    const col = { id: uid('column'), component: 'Column', children: kids };
    out.push(col);
    out.push({ id, component: 'Card', child: col.id });
    return id;
  }
  out.push({ id, component, children: kids });
  return id;
}

/**
 * Convert a validated + expanded app-shell spec to A2UI updateComponents.
 *
 * @param {object} expandedScreen — the `expanded` tree from validate()
 * @param {{ accent?: string }} _ctx — accent rides the surface theme, not nodes
 * @returns {{ surfaceId: string, components: object[] }}
 */
export function expandedToA2UI(expandedScreen, _ctx) {
  _n = 0;
  const components = [];
  convertNode(expandedScreen, components, 'root');
  // Containers emit after their descendants, so the root entry sits mid-array
  // — genui's root detection and every consumer expect it first.
  const rootAt = components.findIndex((c) => c.id === 'root');
  components.unshift(...components.splice(rootAt, 1));
  return { surfaceId: 'appshell', components };
}

/**
 * Full pipeline: validate → expand → convert. The one callers should use on
 * RAW specs — expandedToA2UI is for the already-expanded validate() output
 * and throws on template nodes by design.
 *
 * @param {object} spec — raw app-shell/0.9 spec
 * @param {{ accent?: string }} ctx
 * @returns {{ ok: true, a2ui: {surfaceId, components} } | { ok: false, errors: object[] }}
 */
export function specToA2UI(spec, ctx) {
  const { ok, errors, expanded } = validate(spec);
  if (!ok) return { ok: false, errors };
  return { ok: true, a2ui: expandedToA2UI(expanded, ctx) };
}

/**
 * Build a complete genui ingest sequence.
 *
 * @param {object[]} a2uiComponents — from expandedToA2UI()
 * @returns {object[]} — [createSurface, updateComponents] ready for
 *   MessageProcessor.processMessages() or store.push()
 */
export function toGenuiMessages(a2uiComponents) {
  return [
    { createSurface: { surfaceId: 'appshell', catalogId: 'appshell' } },
    { updateComponents: { surfaceId: 'appshell', components: a2uiComponents } },
  ];
}
