# Feature: the mobile compaction-basic mount (gated boot row)

Status: implemented
Class: feature
Date: 2026-10-11
Related: D9, T-0211, the mobile preset's compaction group (presets-mobile/mobile/agent.cordis.yml)

## Problem

The mobile seat carried the whole compaction STORY as vendored bytes —
`dsh-compaction` (the seam), `dsh-compaction-basic` (the engine), `dsh-token-meter`,
`dsh-compaction-tool-result-pruner`, `dsh-command-compact` — and the mobile preset
composition (`presets-mobile/mobile/agent.cordis.yml`) already declares the compaction
group rows. But no mobile mount ever provided the HOST-plane `tokenMeter` service the
engine's `static inject = ['llm', 'tokenMeter', 'sessions']` demands, so no mobile
session could ever compact: long conversations grew until the model's context window
simply failed, and the preset's compaction rows stayed dead weight. The only live
consumer was the desktop `/compact` command row. A long-session auto-compaction proof
did not exist on any mobile host surface.

## Decision

`bootUpstream` gains an OPTIONAL, default-off `options.compaction` row
(`runtime/dsh/upstream/boot.js` → `upstream/boot-compaction.js`):

1. `@deepseek-ai/dsh-token-meter` mounts under `tokenMeter` — the HOST plane, exactly
   where the mobile preset's own composition comment keeps it (the browser reads the
   meter's projection units for every session; behind a preset realm they would come
   and go with mounted presets).
2. `@deepseek-ai/dsh-compaction-basic` mounts under `compaction`, config passed through
   verbatim (`{config}` rides BasicCompactionConfig; default = the engine's own
   `auto: true`, thresholdRatio 0.8). The engine's auto triggers (step-pressure on
   `agent/pre-step`, context-overflow recovery on `agent/request-error`) register on
   the same context the spine runs on.

Absent the option, boot is byte-identical (no new service, no new event) — the same
gated-row rule as `options.skills`/`options.commands`/`options.presetJoin`.

The proof (CLI, the cheapest honest oracle): `runtime/dsh/scenario/upstream-compaction.js`
(scenario `upstream.compaction`) boots WITH the row, drives two real agent-loop turns
through the vendored dsh-llm over the mock loopback, and the engine's AUTO step-pressure
compaction fires between turn 2's `turn/start` and its first step. The durable record
set — `compaction/start`, `compaction/summary` (summary text, shadowed range/tokens,
provider/model), the framed checkpoint `user/message` (source `plugin`/`compact`,
surfaceOp replace), `compaction/end` — lands in `dsh.runtime.log` and is asserted
one-to-one by `test/e2e/scenarios/upstream-compaction.json` (39/39, three consecutive
runs byte-identical modulo the per-run random compaction id, masked before hashing).
The engine's own diagnostic line (`cordis:basic-compaction-engine: compaction (step
pressure): shadowed …`) rides wireLogger into the same log. Runner:
`runtime/dsh/ci/run-upstream-compaction-e2e.sh` (+ receipt under
`runtime/dsh/artifacts/macos-cli-upstream-compaction/`). The existing
`upstream.session` CLI leg's log is byte-identical with and without the change
(only the OS-assigned mock port differs).

## Alternatives considered

- **Mount via the preset composition (make the mobile preset's compaction group
  live).** Rejected for this item: the preset realm requires the host-plane
  `tokenMeter` anyway, and joining the preset composition is the interactive seat's
  separate leg (presetJoin) — a preset-only mount would leave the plain spine
  (scenario drivers, carrier sessions) without compaction. The host-plane row is the
  prerequisite either way; wiring the preset rows on top is follow-up.
- **Mount unconditionally (always provide tokenMeter + engine).** Rejected: the
  engine's `sessionProjections` registrations and `agent/pre-step` listener would
  move every existing spine leg's behavior and manifests — the frozen parity/golden
  surfaces forbid that, and compaction policy (thresholds) is a seat decision, not a
  spine constant.
- **Proof via `interactive-circle-probe` (the load-only compaction chain).** Rejected
  as the sole evidence: the probe mounts the chain on a bare context and asserts
  service presence — it never drives a live compaction. This item's value is the
  durable record set, which only a real two-turn conversation produces.

## Consequences

- Cross-host staging (android assets / harmony rawfile / iOS embed) is deliberately
  NOT done: the proof is CLI-only (the `upstream-session.js` precedent — CLI-only
  scenarios join no staging list), keeping the branch reviewable. Device-side legs
  and the settings 插件 inventory row for the gated service are follow-up.
- A CLI-only scenario means the compaction thresholds tuned in the scenario
  (contextWindow 8192, thresholdRatio 0.75, retainTokens 0) are proof tuning, not a
  product default; product seats pick their own config through the option.
- `boot.js` was at both code-size caps; the landing split the spine demand-facts into
  `upstream/boot-demand.js` (pure data + predicates, behavior verbatim) and the row
  into `upstream/boot-compaction.js`.
