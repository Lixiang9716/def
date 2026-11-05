# The appgen auto-research loop

English | [中文](appgen-auto-research.zh.md)

## Problem

def's app-generation capability — dsh-appshell turning one prompt into an
app-shell spec, validated by the four gates, rendered on the phone through
the A2UI/lynx surface — is measured today by three single-purpose probes:
the L3 benchmark (one prompt × 10 runs, structural gates), the M4 cost
ledger (token/latency bars for morph and update tiers), and the TTFT
probe. None of them answers the two questions the owner's program needs:
**where does generation quality actually fail** (backend interaction
design, mobile frontend UI), and **did the last harness change make
generation better**. The program: improve app generation through the
harness, driven by an automatic research loop whose first job is finding
def's problems, not proving health.

## Decision

### What we measure with (benchmark selection)

**Primary — internal, this repo: `test/panel/appgen-eval.mjs`** (the
breadth layer over the L3/M4 anchors):

- 8 categories of mobile-app archetypes (music, wallet, chat,
  tools-dashboard, pomodoro, calendar, ecommerce, fitness) × N runs each;
  the music-player prompt is the L3 prompt verbatim, keeping the committed
  L3/M4 receipts comparable.
- Every run is judged by (a) the **four-gate validator** — the same
  structural gates the product enforces at `appshell_render` — and (b) the
  **machine-checkable half of the design constitution** (the rubric:
  hero-first, top-block budget, nesting depth, title budget/length, emoji
  budget, tab length, mobile-template count, placeholder copy, cover
  palette, non-empty actions). The visual half of the constitution (hero
  visual weight, color-field dominance) stays with the future screenshot
  leg — named, not hidden.
- Every failure carries a class code (validator codes, `RUBRIC_*`,
  `UNPARSEABLE`, `HTTP`), and first-pass failure classes are preserved
  even when a retry recovers — the census signal, not the recovery story.
- Provider-neutral (`LLM_*` overrides over the `ZAI_*` default), ledgers
  keyed by `LEDGER_STEM` into
  `tools/dev-web-carrier/artifacts/appgen-eval/`, committed as receipts.
- Measurement hygiene, both traps already bitten once: latency is sampled
  **after the response body settles** (the M4 ledger's documented ~30×
  header-time lie), and any surprising number gets the **nonce/variance
  control** (same prompt twice must differ; a nonce woven into a required
  field must come back) before it is believed.

**Method donors — external, borrowed at the pattern level, never
imported wholesale** (they target HTML websites or native apps, not
app-shell specs; the four-gate validator is the product's own contract):

| Donor | What we take |
|---|---|
| [WebGen-Bench](https://github.com/mnluzimu/WebGen-Bench) (NeurIPS 2025 D&B) | the "generate → actually operate → assert" verification shape → the future **action-execution leg**: generated `actions` dispatched against mock tools, asserted by structured logs (the harness's own E2E-by-logs law) |
| [WebCoderBench](https://arxiv.org/html/2601.02430v2) | its metric sheet (visual / content / accessibility / performance / alignment) is the dimension source for the future **visual leg** (screenshot + judge) |
| [1D-Bench](https://arxiv.org/abs/2602.18548) | iterative UI generation with visual feedback — the shape of a future screenshot-refine leg |
| [OpenHarmony Bench](https://arxiv.org/abs/2608.16022) | app-level tasks verified on device — corpus donor for the harmony face, far term |
| [Web-Bench](https://github.com/bytedance/web-bench) (ByteDance) | sequential dependent tasks across a project — the shape of a future multi-turn morph/update chain benchmark |

**Ported — the percentage benchmark** (corpus and formula transplanted,
the harness is still ours). The donor benchmarks cannot RUN against def
directly — 21 of WebCoderBench's 24 metrics hang tooling on HTML/CSS/JS
code that a JSON spec does not have, WebGen-Bench's 647 test cases drive a
browser over websites, and its dataset-with-legal-strings sibling never
shipped its data — so the port moves what survives the artifact change:
the test cases, the scoring formula, and the diagnostics.

- **`test/panel/appgen-bench/webgen-port.json`** (built by
  `appgen-bench/build-port.mjs` from the upstream clone): 12 instructions
  / 74 test cases selected from the 101/647 corpus, balanced across the
  application types that map to a single-face mobile app (e-commerce,
  productivity, news, social, travel, streaming, messaging). **The test
  cases are verbatim** — task, expected result, and category untouched;
  only the instruction is re-phrased def-native (capabilities preserved,
  color asks mapped onto `theme.accent`), so the benchmark's semantics
  stay the benchmark's.
- **`test/panel/appgen-bench-port.mjs`** scores the upstream formula
  verbatim at the case level: `accuracy = (N_yes + 0.5 × N_partial) /
  N_total × 100%`, plus the upstream diagnostics (start-failed rate =
  generation produced no valid spec, its cases all score NO; judge-failed
  cases are excluded from the denominator). Breakdowns: per case category
  (Functional / Data Display / Design Validation) and per instruction.
- **Execution tier v1 = spec-inspection judge**: a different-family judge
  (generator deepseek, judge glm-4.6 — no self-preference) grades each
  case against the generated spec: YES (content present AND an action
  delivers it) / PARTIAL / NO. This is the honest static tier; the
  action-execution leg upgrades it to real dispatch later, and the
  upgrade is a benchmark change (new tier, new baseline ledger), not a
  silent re-score.
- The loop's optimization target on this axis is the **accuracy
  percentage and its three category percentages** — deltas cycle over
  cycle, same ledger shape as the census.
- **The chain port (Web-Bench's shape)** — `test/panel/appgen-chain.mjs`:
  sequential DEPENDENT modification tasks over one surface (render →
  task 1 → task 2 → task 3), the update payload merged over the current
  truth by the product's own `mergeUpdate` and judged by the same four
  gates before the judge grades the task. A refused update scores NO and
  the chain continues from the last valid truth — the product's real
  behavior. Reports chain accuracy % and the per-position decay (do
  later, dependent tasks survive?). This is the **backend-axis**
  percentage benchmark; the port benchmark above is the one-shot render
  axis.
- **Not portable, recorded honestly**: OpenHarmony Bench (tasks are
  buildable ArkTS projects verified on device — def does not generate
  ArkTS) and 1D-Bench (its iteration metric needs the screenshot leg;
  its shape is reserved for that leg's design). WebCoderBench's
  rule-based metrics (Lighthouse / ESLint / Laplacian / MDN-BCD) have no
  input on a JSON spec — only its judge-based metrics are portable, and
  those ride the future visual leg.

### How the loop runs (auto-research selection)

- **Cycle engine: the host agent on a schedule** (ZCode cron), no
  framework service. The deep-research engines (GPT-Researcher,
  LangChain open_deep_research, dzhng/deep-research, HF
  open-deep-research) are whole services with their own model plumbing —
  too much machinery for in-process cycles; the **dzhng recursive
  search-refine pattern** (search → assess coverage → search the gaps) is
  borrowed as the in-cycle research procedure instead. The AI-Scientist
  family (Sakana AI Scientist, Agent Laboratory, FutureHouse Kosmos)
  targets paper production — the wrong artifact for a product loop.
- **Publication and memory**: census ledgers committed in-repo; each
  cycle's digest lands as a GitHub issue (the agents-radar shape — dated,
  searchable, dedupable by title); cross-cycle state lives in those
  issues plus the committed ledgers.
- **Weekly self-audit** (the ai-research-arm shape): hit rate of
  proposals taken vs proposed, source quality, ledger staleness, and
  whether the rubric itself drifted from the product constitution.

### The cycle

1. **MEASURE** — run `appgen-eval` across all categories, commit the
   ledger (`LEDGER_STEM=appgen-census-<model>-<date>`).
2. **TRIAGE** — classify first-pass failures; each recurring class
   becomes a named problem with evidence (rows, failure classes, counts).
3. **RESEARCH** — per problem class: external survey (papers,
   benchmarks, open-source peers) using the recursive search-refine
   procedure; improvement proposals written into the cycle digest.
4. **PUBLISH** — the digest (numbers, problem list, proposals) lands as a
   GitHub issue labeled `appgen-loop`.
5. **IMPROVE** — approved proposals land as normal PRs. The optimization
   surfaces are, in order of leverage: the authoring rules the model
   actually sees (`RULES` in `system-plugins/dsh-appshell/index.js`, the
   `appshell_render` tool description), the validator gates
   (`lib/validate.js`), the component catalog (`lib/catalog.js`), and the
   renderer surfaces. `main` is protected; review is the gate.
6. **RE-MEASURE** — the landing PR re-runs `appgen-eval`; the delta
   against the previous ledger is the receipt. No claim of improvement
   without one.

### Boundaries

- **The improve step is owner-authorized to run autonomously**
  (2026-10-29: "自动更新 harness …插件, skills, prompt 等任何可以改变的内容")
  — the loop lands harness/prompt/validator/catalog changes as normal PRs
  without a per-change go; the gates and branch protection remain the
  protection, and **release actions (bump/tag/publish) still need an
  explicit go**. Each autonomous improvement PR must carry its re-measure
  delta: no delta numbers, no merge.
- Census runs cost real tokens: the default cycle runs 2 rounds per
  category (~16 calls, small on the flash tier); a bar-setting run (N=10,
  the L3 depth) happens in a landing PR, not every cycle.

### First census (v1, deepseek-v4-flash, 2026-10-28)

Ledger:
`tools/dev-web-carrier/artifacts/appgen-eval/appgen-census-deepseek-v4-flash.json`
(8 categories × 2 runs, one regeneration leg per failure). The set was run
three times during bring-up; the failure classes below were stable across
passes. Findings, ranked by leverage:

1. **Action-id naming is the dominant structural failure (`BAD_ACTION`)** —
   ids violating the `^[a-z][a-z0-9.:-]{0,63}$` gate, at both `$.actions`
   and node `.action` paths, appear exactly where the prompt names
   commercial, multi-word actions; the failure is intermittent
   (temperature variance — a same-prompt probe passes) but hard to
   recover: the ecommerce category went 0/2 **final** in two of the three
   passes, 1 of 6 ecommerce runs recovered overall. The validator's
   refusal echoes the regex but never names the offending id, so the
   model — and the retry leg carrying that receipt — cannot repair what
   it cannot see. Improvement candidate #1: actionable refusals in
   `lib/validate.js` (quote the offending value, show a compliant
   rewrite) plus a repair-shaped retry instruction.
2. **Hero-first vs utility archetypes (`RUBRIC_HERO_FIRST`)** — utility
   apps occasionally lead with the functional grid instead of a banner
   (1-2 runs per pass). A constitution ambiguity, not model inability.
3. **Depth overflow (`RUBRIC_DEPTH`)** — occasional nesting depth 4; minor.
4. **Expectation coverage tracks prompt explicitness** — components the
   prompt names outright hit ~100%; the wallet's balance-card (implied,
   never named) was missed in some passes.

Measurement hygiene earned on day one: the committed ledger samples
latency after the response body settles (the M4 note's ~30× header-time
trap, re-bitten and re-fixed during bring-up), and the endpoint's speed
was verified real by variance + nonce controls (same prompt twice
differs; a nonce woven into a required field comes back).

## Consequences

- Generation quality now has a single currency: every prompt/gate/catalog
  change can show its delta in the same ledger format, across models.
- The rubric is intentionally the *machine-checkable half*; until the
  visual leg lands, aesthetic regressions are invisible to the census —
  the loop's known blind spot, next in the leg roadmap after
  action-execution.
- The census prompt set is a versioned artifact (`prompts.json` v1,
  `SYSTEM_V1` frozen in `system-prompt.js`); prompt iterations are new
  versions, never edits, so old ledgers stay interpretable.
