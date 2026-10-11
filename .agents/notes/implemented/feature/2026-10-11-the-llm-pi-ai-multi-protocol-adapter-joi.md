# Agent Note: the llm-pi-ai multi-protocol adapter joins, boot-gated

Status: implemented

## Problem

The mobile closure serves exactly one LLM adapter family: the gateway
chat-completions transport (`upstream/llm-transport.js`) registered for the
boot's single provider route. The desktop harness serves multi-protocol
backends (anthropic-messages / openai-responses / openai-completions)
through `@deepseek-ai/dsh-llm-pi-ai` (library-backed by
`@earendil-works/pi-ai`), and upstream had deliberately kept that package
out of the mobile closure ("their direct-fetch transport is the desktop's").
A mobile runtime that cannot name a second protocol cannot adopt a
protocol-diverse backend without a new hand-written adapter per protocol —
exactly the per-adapter duplication the vendored plugin already solves.

## Decision

`@deepseek-ai/dsh-llm-pi-ai@0.1.6-alpha.2` joins the product pin table
(`NPM_PACKAGES`, npm face, tarball committed to the tracked mirror; sha
identical to the test-face pin `ensure-dsh-tests.sh` already carried), with
its one not-yet-pinned link-time dep `@deepseek-ai/dsh-launch-environment`
beside it. The mount is a BOOT GATE: `options.llm.piaiProviders` (the
plugin's own providers dict, verbatim) hands the config to the vendored
plugin's `apply` through the new `upstream/llm-piai-mount.js`; an absent
option never imports the package and every existing leg is byte-identical
(proved: `upstream.session` scenario records diff empty against a pristine
cd7b1db3 worktree). The plugin registers its `PiAiAdapter` — an `LlmAdapter`
subclass, the same base contract the gateway adapter serves — through
`ctx.llm.registerAdapter`, so both adapter families answer in the ONE
`LlmRuntime` registry and every public face (`listProviders`,
`listModels`, `resolveModelInfo`, `prepareCall`, `stream`) works unchanged.
The `llm.piai-probe` CLI scenario proves the whole surface deterministically:
one quickjs process, no network — pi-ai's REAL `openai-completions` wire
layer streams against an in-process `http`-shim loopback server (the runtime
fetch's only served face; the gateway `httpFetch` seam is invisible to the
library, and that is the honest mobile transport statement), with the
`apiKeyEnv` credential resolving through the launch env to the wire's Bearer.

## Alternatives considered

- Hand-building `ResolvedPiAiProviderProfile`s in a mobile-side adapter
  (skipping the plugin): lost because profile resolution, protocol table,
  and provider construction are the plugin's internal logic — reimplementing
  them forks upstream semantics the vendored package owns (D6).
- A hand-written per-protocol adapter beside `llm-transport.js` (the
  gateway-adapter pattern per protocol): lost because it duplicates the
  vendorable plugin per protocol and freezes the protocol set at our
  writing speed.
- Mounting the plugin unconditionally with an empty providers dict (the
  plugin's own dormant posture): lost because the load itself pays the
  pi-ai bridge graph in every boot and the "empty boot-list stays silent"
  precedent keeps dormant rows out of the mount set entirely.
- Streaming the probe against the node-side `dsh-llm-mock-server`: lost
  because the runtime fetch has no gateway route — the mock would be
  unreachable from pi-ai's fetch; the in-process loopback is the face the
  library actually reaches in this runtime.

## Consequences

Cross-host embeds (iOS TREES / harmony CLOSURE / android stager rows) stay
unregenerated — the package rides the runtime closure and the CLI leg only;
staging it per host is the follow-up, together with the not-served protocol
SDK faces (`@anthropic-ai/sdk`, `@google/genai`, `@aws-sdk/*`): those
protocol routes fail loud at API construction until their SDK specifiers get
shim faces like `openai-client.js`. The `upstream.session` leg is red on
pristine cd7b1db3 already (tool-catalog drift, `tools` 15→17) — pre-existing
on main, not this change.
