# appshell on deepseek-v4-flash: the model-swap counterfactual, all bars green

Status: implemented
Date: 2026-10-19
Class: testing
Related: PR #589 (the M4 ledger + the morph e2e miss), the owner's 2026-10-18 decisions (streaming TTFT + boot mount), T-0253's bars

## Problem

The glm-4.6 ledger recorded the morph e2e row as an honest miss (P50 33.6s
vs ≤20s) with streaming TTFT named as the candidate — but the TTFT probe
then measured glm-4.6's streaming TTFT at **11-26s** (the thinking phase
dominates; streaming only saves the 3-8s generation tail). Streaming alone
could not rescue the bar. The owner picked the other lever: **swap the
model to deepseek-v4-flash** (the 10-17 naming; the API alias still
answers and routes to the current V4.1 Flash, 552B MoE efficiency tier).

## Decision

- **The benchmark and probe are provider-neutral now**: `LLM_BASE_URL` /
  `LLM_API_KEY` / `LLM_MODEL` process-env overrides (the ZAI GLM default
  unchanged); the TTFT probe is committed as `test/panel/ttft-probe.mjs`
  (streaming SSE, first-token / first-theme / first-component / completion
  timestamps); ledgers key by `LEDGER_STEM` so multi-model runs coexist.
- **The deepseek-v4-flash ledger** (`cost-ledger-deepseek-v4-flash.json`,
  morph×10 + update×10): **all five bars green** — morph P50 1532 ≤3k /
  P95 1772 ≤5k / **4.5s** ≤20s; update P50 739 ≤1.2k / **2.1s** ≤20s;
  payload P50 344B (52%). Streaming: TTFT 2.4-3.8s, first component
  renderable 2.8-4.1s, full 4-5s. 10/10 first-pass on both tiers — the
  换模型 design-success row verifies at its strongest: the seam is the
  schema + validator, not the model.
- **Two measurement traps caught by the cross-model comparison**:
  1. `latency` sampled at fetch-header arrival under-reported DeepSeek
     ~30× (headers arrive ~100ms; the ~4s JSON body streams chunked even
     on non-streaming calls — glm sends headers with the ready body, so
     the GLM numbers were honest by accident). The benchmark now samples
     after the body settles; the committed GLM ledger's latencies remain
     valid (header time ≈ body time when the server buffers).
  2. Identical-prompt reruns show DeepSeek prompt-cache hits
     (`prompt_cache_hit_tokens` in usage) — cheap inputs, but a
     nonce-prompt control confirmed outputs are genuinely generated
     (~1.2s fresh small spec), not replayed.

## Alternatives considered

- **Keep glm-4.6 and pursue streaming alone** — measured dead end: the
  thinking phase (11-26s pre-first-token) is untouched by streaming.
- **Treat the 90-190ms header-time numbers as the win** — rejected: the
  wall-clock control (38.5s for 10 runs) exposed the sampling bug; the
  honest number is 4.5s, still comfortably green.

## Consequences

- The e2e ≤20s bar passes on model choice; streaming progressive render
  (2.8s to first component) remains a worthwhile UX layer on top, not a
  latency rescue — the client-side progressive work can proceed at its
  own pace.
- The spine's BYOK routing already speaks OpenAI-compatible endpoints —
  pointing a seat's route at api.deepseek.com needs no runtime change;
  the default route/model selection stays the owner's product call.
- The glm ledger keeps its recorded miss (physics of that tier) — the
  two ledgers now document the cost/latency span between tiers.
