/**
 * VNode: the app-shell renderer's intermediate tree — pure data, zero DOM.
 *
 * Components are pure functions (node, ctx) -> VNode; the browser mount layer
 * (M2) is the ONLY code allowed to touch the DOM, and it must set text via
 * textContent — never innerHTML. That mount contract is what makes the
 * four-gate validator's text-purity guarantee structural rather than hoped-for.
 *
 * Keep this file dependency-free: it is the isolation seam every component
 * (and every mock test) compiles against.
 */

/**
 * Build a VNode.
 * @param {string} tag target tag name at mount time (div/span/button/...)
 * @param {{class?: string, style?: Record<string, string>, text?: string, attrs?: Record<string, string>}} [props]
 * @param {VNode[]} [children]
 */
export function h(tag, props, children) {
  return { tag, props: props || {}, children: Array.isArray(children) ? children : [] };
}

/** Walk a VNode tree (depth-first, pre-order). Test/migration helper. */
export function walk(vnode, visit, depth = 0) {
  visit(vnode, depth);
  for (const child of vnode.children || []) walk(child, visit, depth + 1);
}

/** Count nodes in a VNode tree — the render-side mirror of the spec node cap. */
export function countNodes(vnode) {
  let n = 0;
  walk(vnode, () => { n += 1; });
  return n;
}
