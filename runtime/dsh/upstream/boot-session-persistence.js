// dsh:logging-exempt (boot module; logging happens through the mounted logger)
/**
 * upstream/boot-session-persistence.js — the SESSION-PERSISTENCE row (the
 * resume leg): the VENDORED @deepseek-ai/dsh-session-persistence-jsonl
 * backend mounted under the `sessionPersistence` service key. The key is not
 * derivable from the plugin: the vendored SessionPersistence base fixes it in
 * its own Service constructor (`super(ctx, "sessionPersistence")`); the
 * subclass's `name` override ('session-persistence-jsonl') is a diagnostics
 * label only.
 *
 * GATED (options.sessionPersistence), DEFAULT OFF: the parity/golden legs
 * boot without it and keep the loud "cannot resume: session persistence is
 * not configured" upstream path (the vendored agent-loop checks
 * `ctx.get("sessionPersistence")` first), so those legs stay byte-identical.
 * When mounted BEFORE the agent loop, the loop's config-driven start takes
 * the restoreOrCreateConfigured path: the configured session RESUMES from
 * its stored artifact when the backend finds one
 * (SessionPersistenceNotFoundError falls through to create) — the desktop
 * session-Persistence wire shape, not a new seam.
 *
 * The dynamic import is load-bearing twice over:
 *   - the gate: a static import would link the backend's whole graph on
 *     EVERY boot — the default-off legs would demand the vendored packages;
 *   - the evaluation order: the backend's module top reads the `process`
 *     global (the win32 platform dispatch), which pinProfileContainer
 *     installs — mountSpine runs after it; a static import would evaluate
 *     the module before the pin.
 *
 * The root lands INSIDE the profile container by default
 * (`<cwd>/dsh/sessions` — the workspace the fs shims mirror onto the real
 * container disk, the <filesDir>/dsh/sessions twin on the device hosts):
 * the shims' write-through mirror + real-disk read fallback
 * (upstream/shims/fs*.js) is what makes a stored session survive the
 * process. `compression` keeps the upstream default when absent (zstd — the
 * host compiles the vendored library and serves node:zlib over its
 * intrinsics); the desktop snapshot corpora pin 'none'.
 */

/** Mount the JSONL backend with the caller's (or defaulted) config. */
export const mountSessionPersistence = async (ctx, config) => {
  const Backend = (await import('@deepseek-ai/dsh-session-persistence-jsonl')).default;
  await ctx.plugin(Backend, {
    root: config.root ?? `${globalThis.__dshProfileCwd}/dsh/sessions`,
    ...(config.compression === undefined ? {} : { compression: config.compression }),
  });
  installDiskFullSentinel(ctx);
};

/** The disk-full sentinel (row 16, #571): the vendored backend's appends
 * persist best-effort — once the volume is full the write failures are
 * swallowed in-band and the journal FREEZES while turns keep completing,
 * so events are lost with no named surface. The sentinel watches the
 * backend's own durable accounting at each turn boundary: when a session
 * records new events but the durable size froze, it emits agent/error —
 * the named surface (durable, rendered in chat) that turns silent loss
 * into a visible failure. Latched per session; the data-plane fix is
 * upstream. */
export const installDiskFullSentinel = (ctx) => {
  const last = new Map();
  const latched = new Set();
  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'turn/end' || !session?.id) return;
    if (latched.has(session.id)) return;
    const backend = ctx.get('sessionPersistence');
    if (!backend?.stat) return;
    const events = session.snapshotEvents().length;
    const prior = last.get(session.id) ?? { events: 0, size: -1, frozenTurns: 0 };
    (async () => {
      const stat = await backend.stat(session.id).catch(() => null);
      const size = Number(stat?.sizeBytes ?? -1);
      const grewEvents = events > prior.events;
      // A frozen durable size OR a stat refusal both count: the disk-full
      // failure class observed live publishes a 0-byte journal (the atomic
      // temp+rename loses the whole history), after which stat refuses.
      const sizeFrozenOrRefused = stat === null
        || (prior.size >= 0 && size === prior.size);
      if (grewEvents && sizeFrozenOrRefused) prior.frozenTurns += 1;
      else prior.frozenTurns = 0;
      last.set(session.id, { events, size, frozenTurns: prior.frozenTurns });
      // Two consecutive turn-ends with new events but a frozen durable
      // size: the writes are failing and nothing else will say so.
      if (prior.frozenTurns >= 2) {
        const reason = `session journal is not durable (disk full?): ${events} events recorded but `
          + `the journal froze at ${size}B — events since the freeze are lost until space is freed`;
        latched.add(session.id);
        ctx.emit('agent/error', { agent: session.id, error: new Error(reason) });
      }
    })().catch(() => { /* the sentinel never throws into the event bus */ });
  });
};

/** The gated row: a no-op unless the caller configured the gate — every
 * ungated boot evaluates to one undefined check and imports nothing. */
export const maybeMountSessionPersistence = async (ctx, identity) => {
  if (identity?.sessionPersistence) await mountSessionPersistence(ctx, identity.sessionPersistence);
};
