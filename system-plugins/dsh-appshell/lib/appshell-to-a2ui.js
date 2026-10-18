// dsh:logging-exempt — pure mapping layer; logging stays in the caller.
/**
 * appshell-to-a2ui.js — converts an app-shell/0.9 expanded primitive tree
 * into the A2UI v0.9 `updateComponents` message format that @lynx-js/genui's
 * createMessageStore accepts. The conversion is mechanical: each primitive
 * becomes one A2UI component in a flat array, containers reference children
 * by id.
 *
 * This is the M5 deliverable: proves that the SAME spec drives both our web
 * renderer (appshell.js DOM) and the Lynx renderer (genui A2UI components).
 */

let _uid = 0;
const mint = () => `as-${++_uid}`;

/** Map an expanded app-shell primitive node to an A2UI component object.
 * Returns { component, children } where children are already-converted
 * A2UI component objects. */
function convert(node, ctx) {
  const id = mint();
  switch (node.type) {
    case 'text': {
      const comp = { id, component: 'Text', text: String(node.text ?? '') };
      if (node.size === 'title') comp.style = { fontSize: '16px', fontWeight: '500' };
      if (node.tone === 'muted') comp.style = { ...comp.style, color: '#8a9199' };
      if (node.tone === 'accent') comp.style = { ...comp.style, color: ctx.accent };
      return { component: comp, children: [] };
    }
    case 'image':
      return { component: { id, component: 'Image', src: String(node.emoji || ''), style: { background: node.color || ctx.accent } }, children: [] };
    case 'button': {
      const comp = { id, component: 'Button', label: String(node.label ?? ''), action: { event: node.action || 'tap' } };
      comp.style = { background: ctx.accent, color: '#fff' };
      return { component: comp, children: [] };
    }
    case 'row':
    case 'column': {
      const comp = { id, component: node.type === 'row' ? 'Row' : 'Column', children: [] };
      const kids = (node.children || []).map((c) => convert(c, ctx));
      comp.children = kids.map((k) => k.component.id);
      return { component: comp, children: kids.flatMap((k) => [k.component, ...k.children]) };
    }
    case 'card': {
      const comp = { id, component: 'Card', children: [] };
      const kids = (node.children || []).map((c) => convert(c, ctx));
      comp.children = kids.map((k) => k.component.id);
      return { component: comp, children: kids.flatMap((k) => [k.component, ...k.children]) };
    }
    case 'progressbar':
      return { component: { id, component: 'Progress', value: Math.min(100, Math.max(0, node.value || 0)) }, children: [] };
    case 'badge':
      return { component: { id, component: 'Text', text: String(node.text ?? ''), style: { fontSize: '11px', background: 'rgba(0,0,0,.06)', borderRadius: '8px', padding: '3px 9px' } }, children: [] };
    default:
      return { component: { id, component: 'Text', text: `[${node.type}]` }, children: [] };
  }
}

/** Convert an expanded primitive tree to the A2UI updateComponents payload.
 * @param {object} expandedScreen — the `expanded` tree from validate()
 * @param {{ accent: string }} ctx
 * @returns {{ surfaceId: string, components: object[] }}
 */
export function toA2UIComponents(expandedScreen, ctx) {
  _uid = 0;
  const result = convert(expandedScreen, ctx);
  return {
    surfaceId: 'appshell',
    components: [result.component, ...result.children],
  };
}

/** Full pipeline: validate → expand → convert to A2UI updateComponents.
 * Returns { ok, errors?, a2ui? } — a2ui is ready for genui's store.push(). */
export function specToA2UI(spec, ctx) {
  // Lazy import to avoid circular — caller supplies validate+expand.
  throw new Error('use specToA2UIFromExpanded(expanded, ctx) with the expanded tree from validate()');
}

/** Convenience: takes the already-validated+expanded tree. */
export function expandedToA2UI(expandedScreen, accent) {
  _uid = 0;
  const ctx = { accent: accent || '#1677ff' };
  const result = convert(expandedScreen, ctx);
  return {
    surfaceId: 'appshell',
    components: [result.component, ...result.children],
  };
}
