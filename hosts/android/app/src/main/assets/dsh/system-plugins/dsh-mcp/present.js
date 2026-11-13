// dsh:logging-exempt — pure presenters; logging stays in the caller (index.js).
/**
 * The pinned card face for the mcp_* tools (the #764 presenters vocabulary,
 * the dsh-open-design precedent): the tools' stringified {ok, result}
 * envelope is projected into presentationMeta (the replayable intent),
 * presentCall names the pending card, and presentResult narrows the
 * persisted meta back into the completed view — all PURE (no I/O, no
 * session state, no clock) and TOTAL: any shape mismatch degrades to the
 * pin's generic card, never a throw.
 */

/** Narrow a persisted result.meta to an object, or undefined. */
const metaObjectOf = (meta) => (
  meta !== null && typeof meta === 'object' && !Array.isArray(meta) ? meta : undefined
);

/** Parse the tools' stringified outcome (the {ok, result} envelope's inner
 * object); a non-JSON or non-object body degrades to undefined. */
const outcomeOf = (value) => {
  try {
    const parsed = JSON.parse(typeof value?.result === 'string' ? value.result : '');
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

/** The replayable meta: the outcome's ok plus the server the tool belongs
 * to. Never undefined — the registry pins output.presentationMeta as
 * lossless JSON when it runs. */
export const mcpMeta = (server) => (_args, value) => {
  const meta = { view: 'mcp', server, ok: value?.ok === true };
  return meta;
};

/** The pending card: the tool name as the title, a bounded snippet of the
 * arguments as the subtitle (the model can see what it asked). */
export const presentCallFor = (toolName) => (args) => ({
  title: toolName,
  subtitle: args !== undefined && args !== null ? snippetOf(JSON.stringify(args), 120) : undefined,
});

/** The completed view: the outcome's ok plus a bounded first text block —
 * the caller sees the MCP tool's own answer, not a re-narration of it. */
export const mcpResultView = (toolName, server) => (_args, value) => {
  const meta = metaObjectOf(value?.meta);
  const outcome = outcomeOf(value);
  const text = typeof outcome?.result === 'string' ? snippetOf(outcome.result, 200)
    : typeof outcome?.error === 'string' ? snippetOf(outcome.error, 200)
      : undefined;
  return {
    title: toolName,
    subtitle: server,
    ok: outcome?.ok === true,
    text,
    meta,
  };
};
