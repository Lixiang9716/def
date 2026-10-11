// dsh:logging-exempt (boot rows split from boot.js at the file-size gate —
// same posture as boot.js itself: logging happens through the mounted logger)
/**
 * upstream/boot-compaction.js — the OPTIONAL compaction row (2026-10-11, the
 * long-session compaction deep item), split from boot.js's mountSpine (the
 * boot file sat one gate away from the 500-line cap; same posture as
 * boot-coverage-rows.js).
 *
 * Two mounts, in the dependency order the vendored packages demand:
 *
 *   1. `@deepseek-ai/dsh-token-meter` under `tokenMeter` — the HOST-plane
 *      meter. The mobile preset's own composition comment keeps the meter out
 *      of preset realms (the browser reads its projection units for every
 *      session), and BasicCompactionEngine's `static inject` demands it — so
 *      the host plane is the one home that serves both. Its own inject
 *      (`sessionProjections`) mounts in the spine above this row.
 *   2. `@deepseek-ai/dsh-compaction-basic` under `compaction` — the vendored
 *      BasicCompactionEngine VERBATIM (D6): auto step-pressure compaction plus
 *      context-overflow recovery (`auto: true` default), the summarizer riding
 *      the same ctx.llm route the conversation streams through. Its remaining
 *      injects (`llm`, `sessions`) are spine services mounted above.
 *
 * Mounted ONLY when the caller configures `options.compaction`, so every
 * existing spine leg boots byte-identically (the gated-row rule: absent
 * option = the historical spine, no new service, no new event). Dynamic
 * imports — the same reason as every other gated row: the npm-bridges must
 * register before these specifiers resolve (ESM links static import graphs
 * before any module body runs).
 */

/** Mount the compaction row. `compaction` is the caller's option object:
 * `{config?}` rides the engine's BasicCompactionConfig untouched
 * (thresholdRatio / retainTokens / compactionRetries / ...); absent config =
 * the engine's own defaults (auto: true, thresholdRatio 0.8, retainRatio
 * 0.16). */
export const mountCompactionPlane = async (ctx, compaction) => {
  const [Meter, Engine] = await Promise.all([
    import('@deepseek-ai/dsh-token-meter'),
    import('@deepseek-ai/dsh-compaction-basic'),
  ]);
  await ctx.plugin(Meter.TokenMeter, {});
  await ctx.plugin(Engine.BasicCompactionEngine, compaction.config ?? {});
};
