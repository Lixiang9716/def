// dsh:logging-exempt — pure logic; logging stays in the caller (plugin index.js / scenarios).
/**
 * app-shell/0.9 validator — the four gates, in order:
 *   gate 1  whitelist   node.type ∈ primitives ∪ templates
 *   gate 2  text purity every text-bearing field is a bounded plain string
 *   gate 3  size caps   serialized ≤32KB, nodes ≤200, depth ≤8
 *   gate 4  action enum every action is declared in spec.actions
 *
 * Templates are expanded to primitives BEFORE gate 1 re-checks the expanded
 * tree — a template that does not compile to primitives is EXPAND_FAILED,
 * which is the mechanical form of "templates stay inside the vocabulary".
 *
 * Output is structured: { ok, errors: [{ code, path, msg }] } — codes are
 * the contract for the model-regeneration loop, never prose alone.
 */

import {
  SPEC_VERSION, CAPS, ACTION_RE, primitives, templates, KNOWN_PRIMITIVES,
} from './catalog.js';

function isPlainString(v) { return typeof v === 'string'; }

/**
 * Actionable-refusal helpers (the census's dominant failure class was
 * BAD_ACTION with a refusal that echoed the regex but never named the
 * offending value — the model cannot repair what it cannot see).
 */
const quoteValue = (v) => {
  const s = String(v);
  return s.length > 40 ? '"' + s.slice(0, 40) + '…"' : '"' + s + '"';
};
/** A compliant rewrite of an offending action id: lowercase, invalid
 * runes folded to '.', collapsed/trimmed, capped; falls back to a safe
 * generic id when normalization cannot satisfy gate 4. */
const suggestActionId = (v) => {
  const s = String(v).toLowerCase()
    .replace(/[^a-z0-9.:-]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.{2,}/g, '.')
    .slice(0, 64);
  return ACTION_RE.test(s) ? s : 'app.action';
};

/** Expand one node recursively; returns { node } or { error }. depth guards structural self-recursion. */
function expandNode(node, path, errors, depth) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    errors.push({ code: 'BAD_FIELD', path, msg: 'node must be an object' });
    return null;
  }
  const type = node.type;
  if (!isPlainString(type)) {
    errors.push({ code: 'BAD_FIELD', path: path + '.type', msg: 'type must be a string' });
    return null;
  }
  if (templates.has(type)) {
    if (depth > CAPS.DEPTH) {
      errors.push({ code: 'EXPAND_FAILED', path, msg: 'template expansion deeper than ' + CAPS.DEPTH + ' — structural recursion?' });
      return null;
    }
    let expanded;
    try {
      expanded = templates.get(type).expand(node);
    } catch (e) {
      errors.push({ code: 'EXPAND_FAILED', path, msg: 'template expand threw: ' + e.message });
      return null;
    }
    if (!expanded || expanded.type === undefined || templates.has(expanded.type)) {
      errors.push({ code: 'EXPAND_FAILED', path, msg: 'template must expand to a primitive tree' });
      return null;
    }
    return expandNode(expanded, path, errors, depth + 1);
  }
  if (!primitives.has(type) && !KNOWN_PRIMITIVES.includes(type)) {
    errors.push({ code: 'UNKNOWN_TYPE', path, msg: 'type "' + type + '" is not in the catalog' });
    return null;
  }
  const out = { ...node };
  if (Array.isArray(node.children)) {
    if (node.children.length > CAPS.CHILDREN) {
      errors.push({ code: 'NODE_OVERFLOW', path: path + '.children', msg: 'children > ' + CAPS.CHILDREN });
      return null;
    }
    const kids = node.children.map((c, i) => expandNode(c, path + '.children[' + i + ']', errors, depth + 1));
    if (kids.some((c) => c === null)) return null;
    out.children = kids;
  }
  return out;
}

/** Walk the expanded primitive tree for per-field text bounds and depth. */
function walkExpanded(node, path, errors, depth, state) {
  state.nodes += 1;
  if (depth > CAPS.DEPTH) errors.push({ code: 'DEPTH_OVERFLOW', path, msg: 'depth > ' + CAPS.DEPTH });
  for (const [k, v] of Object.entries(node)) {
    if (k === 'type' || k === 'children') continue;
    if (isPlainString(v) && v.length > CAPS.TEXT_RUNES) {
      errors.push({ code: 'TEXT_TOO_LONG', path: path + '.' + k, msg: 'string > ' + CAPS.TEXT_RUNES + ' runes' });
    }
  }
  if (node.action !== undefined) {
    if (!isPlainString(node.action) || !ACTION_RE.test(node.action)) {
      errors.push({ code: 'BAD_ACTION', path: path + '.action', msg: 'action must match ' + ACTION_RE + '; got ' + quoteValue(node.action) + ' — try "' + suggestActionId(node.action) + '"' });
    }
  }
  for (const c of node.children || []) walkExpanded(c, path + '.children', errors, depth + 1, state);
}

/**
 * Validate a full app-shell spec.
 * @returns {{ ok: boolean, errors: Array<{code: string, path: string, msg: string}>, expanded: object|null }}
 */
export function validate(spec) {
  const errors = [];
  if (!spec || typeof spec !== 'object') return { ok: false, errors: [{ code: 'BAD_FIELD', path: '$', msg: 'spec must be an object' }], expanded: null };
  if (spec.spec !== SPEC_VERSION) errors.push({ code: 'BAD_FIELD', path: '$.spec', msg: 'spec must be "' + SPEC_VERSION + '"' });
  if (spec.theme && (typeof spec.theme !== 'object' || !isPlainString(spec.theme.accent))) {
    errors.push({ code: 'BAD_FIELD', path: '$.theme', msg: 'theme.accent must be a string' });
  }
  if (spec.theme && spec.theme.background !== undefined && !isPlainString(spec.theme.background)) {
    errors.push({ code: 'BAD_FIELD', path: '$.theme.background', msg: 'theme.background must be a string when present' });
  }
  if (!Array.isArray(spec.tabs) || spec.tabs.length < 2 || spec.tabs.length > 5 || !spec.tabs.every(isPlainString)) {
    errors.push({ code: 'BAD_FIELD', path: '$.tabs', msg: 'tabs must be 2..5 strings' });
  }
  if (spec.actions !== undefined && !(Array.isArray(spec.actions) && spec.actions.every((a) => isPlainString(a) && ACTION_RE.test(a)))) {
    const bad = Array.isArray(spec.actions) ? spec.actions.find((a) => !isPlainString(a) || !ACTION_RE.test(a)) : spec.actions;
    errors.push({ code: 'BAD_ACTION', path: '$.actions', msg: 'actions must be an array of ' + ACTION_RE + '; offending entry ' + quoteValue(bad) + ' — try "' + suggestActionId(bad) + '"' });
  }
  const serialized = JSON.stringify(spec);
  if (serialized.length > CAPS.SPEC_BYTES) {
    errors.push({ code: 'SPEC_TOO_LARGE', path: '$', msg: 'serialized spec > ' + CAPS.SPEC_BYTES + ' bytes' });
    return { ok: false, errors, expanded: null };
  }
  const expandedRoot = expandNode(spec.screen, '$.screen', errors, 1);
  let expanded = null;
  if (expandedRoot) {
    const state = { nodes: 0 };
    walkExpanded(expandedRoot, '$.screen', errors, 1, state);
    if (state.nodes > CAPS.NODES) errors.push({ code: 'NODE_OVERFLOW', path: '$.screen', msg: 'expanded nodes > ' + CAPS.NODES });
    if (errors.length === 0) {
      const actions = new Set(spec.actions || []);
      (function checkActions(node, path) {
        if (node.action !== undefined && !actions.has(node.action)) {
          errors.push({ code: 'BAD_ACTION', path: path + '.action', msg: 'action ' + quoteValue(node.action) + ' is not declared in spec.actions — declare it there or remove the action' });
        }
        for (const [i, c] of (node.children || []).entries()) checkActions(c, path + '.children[' + i + ']');
      })(expandedRoot, '$.screen');
    }
  }
  expanded = errors.length ? null : expandedRoot;
  return { ok: errors.length === 0, errors, expanded };
}

/**
 * Merge an INCREMENTAL update payload over the spec a surface was rendered
 * from (M3's token-savings seam): the wire carries only what changes —
 * `screen` replaces the tree, `theme`/`tabs`/`actions` override when
 * present, everything else stays from the render. A full spec still merges
 * to itself, so full-spec updates remain legal. Pure: the caller validates
 * the merged form with validate().
 */
export function mergeUpdate(current, partial) {
  if (!partial || typeof partial !== 'object') return null;
  return {
    ...current,
    ...(partial.theme !== undefined ? { theme: partial.theme } : {}),
    ...(partial.tabs !== undefined ? { tabs: partial.tabs } : {}),
    ...(partial.actions !== undefined ? { actions: partial.actions } : {}),
    screen: partial.screen,
  };
}
