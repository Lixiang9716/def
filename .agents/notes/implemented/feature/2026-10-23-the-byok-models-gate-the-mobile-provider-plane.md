# Agent Note: the BYOK models gate — the mobile provider plane mounts behind piaiSection

Status: implemented
Related: D20, #674, #671

## Problem

def#674: the official client's Models page on mobile could render only the
seeded llm-mock row — 添加提供方 was inert, and a user installing the v0.0.3
packages could not bring their own key. The research run (three verified
legs) refuted the obvious fix (touching SettingsMemory): the real root is
that **the llm-pi-ai namespace was never registered on mobile** — the
pi-ai plugin's provider directory, its settings section, and its
credential resolution all ride that namespace (pi-ai apply installs the
section itself via ctx.inject(['settings']); the directory syncs from the
settings document; resolveApiKey reads ctx.get('credentials') before the
process env, pi-ai lib resolveApiKey).

## Decision

The provider plane mounts behind an **opt-in gate**: `llm.piaiSection === true`
(a boot-options data forward, default off) makes boot.js await
`mountPiAiSection(ctx, onEvent)` (runtime/dsh/upstream/llm-piai-mount.js) —
a dynamic import of @deepseek-ai/dsh-llm-pi-ai mounted over the **empty
base layer** (the rebind precedent's `mountPlugin(ctx, {})`: zero routes is
the point), preceded by a gate-scoped credentials service
(`runtime/dsh/upstream/credentials-store.js` — extends the cordis Service,
reads the same app-scope credentials.json the Models page writes through
web-write-llm.js, plus the record-face fallbacks credentialStoreFrom
asks for). A write hook in web-write-settings.js re-arms the fetch→gateway
egress bridge when a write lands on the section, so a UI-added
non-loopback provider can actually dial. A collision with a live route's
provider id (the vendored catalog declares all 39 built-ins, all-or-nothing)
fails boot loud naming both sides.

Deliberate scope lines: the provider lifecycle is **session-scoped**
(SettingsMemory persists nothing — the documented staged gap; the
credentials.json key IS durable, the directory row is not; cross-restart
revival is future work). The default boot (product, scenarios, parity)
never passes the gate, so its bytes are unchanged. The staging family
(ios-RESOURCES, harmony BUNDLE_FILES/SPINE_OURS, the android assets copy)
gained exactly one row per copy for credentials-store.js, because
llm-piai-mount.js imports it statically.

## Alternatives considered

**Fixing SettingsMemory.load() to seed the document** (the original
hypothesis): refuted by the verification run — the namespace registration
does not flow through SettingsMemory at all. **Claiming
@deepseek-ai/dsh-credentials**: not in the device embed closure; the local
cordis Service extension is the closure-honest shape. **Always-on mount**:
rejected — the 39-row catalog declaration plus the credentials service
would change MOUNTED_SERVICES-adjacent boot surfaces the E2E manifests pin
byte-for-byte; the gate keeps default boots byte-identical.

## Consequences

A user (or the carrier/E2E) turning `byokModels: true` on gets a working
add-provider form whose credentials resolve for real; turning it off
restores byte-identical behavior. Known limits, declared: the directory row
disappears on restart (settings are volatile) while the key persists —
cross-restart revival is the follow-up; `llm/discoverModels` remains
unclaimed (the editor's model-discovery leg refuses; hand-entered models
work). The spine suite's session-delete leg is red/hangs in this seat for a
test-infrastructure reason unrelated to the feature (the worktree's
absolute `node_modules/upstream` symlink loads MAIN-checkout bytes through
bare specifiers — the spine loader's runtime-root check then mis-scopes;
filed with the landing).
