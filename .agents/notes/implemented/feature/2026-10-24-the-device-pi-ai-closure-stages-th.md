# Agent Note: the device pi-ai closure stages the BYOK mount chain’s missing bytes

Status: implemented
Related: #686, #685
## Problem

PR #685 flips `byokModels: true` on for the interactive seats (Android/iOS/Harmony).
With the flag on, the upstream boot gate runs `mountPiAiSection` (boot.js:476), which
loads the vendored `@deepseek-ai/dsh-llm-pi-ai` plugin. No host's device closure
staged that package, so the interactive default seat failed loud at boot — caught by
the Android page-open pin (run 40086631424: `cannot load module
'@deepseek-ai/dsh-llm-pi-ai' (no vendored dsh package serves it)`), while iOS and
Harmony carried the same defect CI-blind (their legs boot non-interactive evidence
configs only). The plugin's own bare imports reach `@deepseek-ai/dsh-launch-environment`
directly and `@deepseek-ai/dsh-credentials` (unstaged on Android), so the closure gap
was three packages, not one.

## Decision

Stage the three missing packages; change nothing else:

- **Android** (`stage-spine-closure.sh`): `credentials` joins the dsh-face package
  list (external/dsh/credentials@… → `vendor/dsh/credentials@…`, the vendored
  probe's family-0 hit); `dsh-llm-pi-ai` and `dsh-launch-environment` stage through
  the same stage_pkg shape from their npm faces to
  `vendor/npm/@deepseek-ai/<pkg>@0.1.6-alpha.2` (the probe's npm-face hit).
- **iOS** (`ios-TREES.rows` → gen_bundle_header.py): the same two npm roots join the
  TREES list; `credentials` and the `@earendil-works/pi-ai@0.85.1` dist were already
  embedded.
- **Harmony** (`vendor-official.sh` + `harmony-BUNDLE_FILES.policy.rows`): the two
  npm trees stage under the existing js+json face rule; Index.ets BUNDLE_FILES
  spliced by gen-staging-emit.

The C bare map needs zero changes: the '@earendil-works/pi-ai/*' subpath space
(providers/all, the three .lazy apis, utils/overflow) is served at boot by the
npm-bridges runtime registration (upstream/shims/npm-bridges-pi-ai*.js self-register
through `__dshModuleDefine`, and boot.js imports npm-bridges.js) — the same mechanism
the CLI proof legs (llm-piai-probe 13/13, byok-piai-anthropic) already resolve
through; the SDK dist bytes already stage on all three hosts (aapt-hidden-file alias
included on Android). The vendored probe's three families (dsh face, dsh- prefixed
face, npm face) own the '@deepseek-ai/dsh-*' names once the bytes sit at the probed
paths.

## Alternatives considered

- **Silent degrade** (catch the module miss, boot without the section): rejected —
  an interactive surface that advertises BYOK and boots without it is the exact
  "mock pretending configured" disease the producer registry just cured; fail-loud
  (rule 5) is what surfaced this gap at all.
- **Per-host capability probe** (the seat sets byokModels only when its closure
  carries the package): viable and D5-legal, but it would keep the flag off
  everywhere until this staging landed anyway — the flip's purpose (census Gap#1)
  needs the plane actually mounted, so the bytes land first and the flag stays
  unconditional.
- **Curating the pi-ai dist subset** (stage only the files the section mount
  reaches): rejected — the whole-tree js+json rule was already proven on all three
  hosts for the SDK, and a second, narrower rule invites embed-list lag (the #184
  class) for ~1 MB saved.
