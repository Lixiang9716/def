// dsh:logging-exempt — pure mapping layer; logging stays in the caller.
/**
 * appshell-to-a2ui.js — converts an expanded app-shell/0.9 primitive tree
 * (the `expanded` output from validate()) into the A2UI v0.9
 * `updateComponents` message that @lynx-js/genui's createMessageStore
 * accepts. This is the cross-renderer bridge: the SAME spec drives both
 * the web DOM renderer and the Lynx A2UI renderer.
 *
 * A2UI component format (genui v0.7.0):
 *   Flat array of { id, component: "TypeName", ...props }, containers
 *   reference children by id. Props are plain values — text rides `text`,
 *   never markup.
 */

let _n = 0;
const uid = (prefix) => `${prefix}-${++_n}`;

/** app-shell primitive → A2UI component type. */
const TYPE_MAP = {
  text: 'Text',
  image: 'Image',
  button: 'Button',
  row: 'Row',
  column: 'Column',
  card: 'Card',
  progressbar: 'Slider',
  badge: 'Text',
};

/** Convert one primitive node (and recursively its children) into A2UI
 * component entries appended to `out`. Returns the entry's id. */
function convertNode(node, out, ctx) {
  const id = uid(node.type);
  const entry = { id, component: TYPE_MAP[node.type] || 'Text' };

  // Map scalar props
  for (const key of ['text', 'label', 'emoji', 'color', 'value', 'placeholder',
    'title', 'subtitle', 'name', 'preview', 'time', 'icon', 'sub',
    'size', 'tone', 'src']) {
    if (node[key] !== undefined) entry[key] = node[key];
  }

  // Action reference
  if (node.action !== undefined) {
    entry.action = { event: node.action };
  }

  // Container: recurse children, reference by id
  if (Array.isArray(node.children)) {
    entry.children = node.children.map((child) => convertNode(child, out, ctx));
  }

  // Theme accent on leaf text
  if (node.type === 'text' && node.tone === 'accent') {
    entry.style = { color: ctx.accent };
  }
  if ((node.type === 'button' || node.type === 'image') && ctx.accent) {
    entry.style = { ...entry.style, background: ctx.accent };
  }

  out.push(entry);
  return id;
}

/**
 * Convert a validated + expanded app-shell spec to A2UI updateComponents.
 *
 * @param {object} expandedScreen — the `expanded` tree from validate()
 * @param {{ accent: string, onAction?: (action: string) => void }} ctx
 * @returns {{ surfaceId: string, components: object[] }}
 */
export function expandedToA2UI(expandedScreen, ctx) {
  _n = 0;
  const components = [];
  convertNode(expandedScreen, components, ctx);
  return { surfaceId: 'appshell', components };
}

/**
 * Full pipeline: expand a spec (calls template expanders), then convert to
 * A2UI updateComponents. The caller must have validated the spec first.
 *
 * @param {object} spec — the raw app-shell/0.9 spec (pre-expansion)
 * @param {{ accent: string }} ctx
 * @returns {{ surfaceId: string, components: object[] }}
 */
export function specToA2UIMessages(spec, ctx) {
  _n = 0;
  const components = [];
  convertNode(spec.screen, components, ctx);
  return { surfaceId: 'appshell', components };
}

/**
 * Build a complete genui MessageStore ingest sequence.
 *
 * @param {object[]} a2uiComponents — from expandedToA2UI() or specToA2UIMessages()
 * @returns {object[]} — [createSurface, updateComponents] ready for store.push()
 */
export function toGenuiMessages(a2uiComponents) {
  return [
    { createSurface: { surfaceId: 'appshell', catalogId: 'appshell' } },
    { updateComponents: { surfaceId: 'appshell', components: a2uiComponents } },
  ];
}
