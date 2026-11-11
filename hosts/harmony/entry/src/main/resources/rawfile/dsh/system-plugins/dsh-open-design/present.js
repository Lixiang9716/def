// dsh:logging-exempt — pure presenters; logging stays in the caller (index.js).
/**
 * The pinned card face for the open_design tools (P3 of the seam-collapse
 * program): the three tools stringified their outcomes into model-facing
 * text and carried zero presentation hooks, so a card consumer had to
 * re-parse narration text. These presenters project the replayable intent
 * (presentationMeta), name the pending card (presentCall), and narrow the
 * persisted meta back into the completed view (presentResult) — all PURE
 * (no I/O, no session state, no clock) and TOTAL: any shape mismatch
 * degrades to the pin's generic card, never a throw.
 */

/** Narrow a persisted result.meta to an object, or undefined. */
const metaObjectOf = (meta) => (
  meta !== null && typeof meta === 'object' && !Array.isArray(meta) ? meta : undefined
);

/** Parse the tools' stringified outcome (the {ok, result} envelope's inner
 * object); a non-JSON or non-object body degrades to undefined. */
const outcomeOf = (value) => {
  try {
    const parsed = JSON.parse(typeof value === 'string' ? value : '');
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

/** One prompt snippet for a pending card title (pure, width-bounded). */
const snippetOf = (text, width) => {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length <= width ? clean : `${clean.slice(0, width - 1)}…`;
};

/** The replayable meta: the outcome's ok plus every primitive locator field
 * present (id/name/kind/fileName for projects, chars for generate, url/path/
 * findings for artifact save/lint). Never undefined — the registry pins
 * output.presentationMeta as lossless JSON when it runs. */
export const openDesignMeta = (tool) => (args, value) => {
  const meta = { view: 'design', tool, ok: value?.ok === true };
  const verb = typeof args?.verb === 'string' ? args.verb
    : typeof args?.action === 'string' ? args.action : '';
  if (verb !== '') meta.verb = verb;
  if (typeof args?.id === 'string' && args.id !== '') meta.id = args.id;
  if (typeof args?.identifier === 'string' && args.identifier !== '') meta.identifier = args.identifier;
  if (typeof args?.title === 'string' && args.title !== '') meta.title = args.title;
  const outcome = outcomeOf(typeof value?.result === 'string' ? value.result : '');
  if (outcome !== undefined) {
    for (const field of ['id', 'name', 'kind', 'fileName', 'url', 'path', 'total']) {
      const candidate = outcome[field] ?? outcome.project?.[field] ?? outcome.file?.[field];
      if (typeof candidate === 'string' || typeof candidate === 'number') meta[field] = candidate;
    }
    if (Array.isArray(outcome.findings)) meta.findings = outcome.findings.length;
  }
  return meta;
};

/** The pending card per tool: projects by verb+id, generate by prompt
 * snippet, artifact by verb+identifier. */
export const presentCallFor = (tool) => (args) => {
  if (tool === 'open_design_generate') {
    return { card: 'generic', title: `Design: ${snippetOf(args?.prompt, 60)}`, kind: 'other' };
  }
  if (tool === 'open_design_artifact') {
    return {
      card: 'generic',
      title: `artifact ${typeof args?.verb === 'string' ? args.verb : '?'}`
        + `${typeof args?.identifier === 'string' ? ` ${args.identifier}` : ''}`,
      kind: 'other',
    };
  }
  return {
    card: 'generic',
    title: `open_design ${typeof args?.verb === 'string' ? args.verb : '?'}`
      + `${typeof args?.id === 'string' && args.id !== '' ? ` ${args.id}` : ''}`,
    kind: 'other',
  };
};

/** The completed card over the persisted meta: a title naming the tool+verb
 * and, when the meta carries a locator (url/path/id/name), one content line
 * with it — the artifact's shareable location is the card's payload. */
export const openDesignResultView = (tool) => (_args, result) => {
  if (result.isError) return undefined;
  const meta = metaObjectOf(result.meta);
  if (meta === undefined || meta.view !== 'design' || meta.tool !== tool) return undefined;
  const lines = [];
  const locator = ['url', 'path', 'id', 'name', 'fileName']
    .map((field) => (typeof meta[field] === 'string' ? `${field}: ${meta[field]}` : undefined))
    .find((line) => line !== undefined);
  if (locator !== undefined) lines.push(locator);
  if (typeof meta.findings === 'number') lines.push(`${meta.findings} finding(s)`);
  const title = `${tool}${typeof meta.verb === 'string' ? ` ${meta.verb}` : ''}`
    + `${meta.ok ? '' : ' (failed)'}`;
  return {
    card: 'generic',
    title,
    ...(lines.length > 0 ? { content: [{ type: 'text', text: lines.join('\n') }] } : {}),
  };
};
