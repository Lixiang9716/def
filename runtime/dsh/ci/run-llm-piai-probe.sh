#!/bin/sh
# runtime/dsh/ci/run-llm-piai-probe.sh — the CLI proof run for the GATED
# multi-protocol LLM row (the llm-pi-ai leg): boots the mobile profile with
# options.llm.piaiProviders naming the 'piai-test' route, so the VENDORED
# @deepseek-ai/dsh-llm-pi-ai plugin registers its PiAiAdapter (an LlmAdapter
# subclass) beside the gateway route in the one LlmRuntime registry, and the
# scenario walks the adapter contract through the public faces
# (listProviders/listModels/resolveModelInfo/prepareCall) plus one FULL
# stream through pi-ai's REAL openai-completions wire layer.
#
# Determinism: ONE quickjs process, NO network, NO node-side companion — the
# scripted chat-completions SSE server is the in-process `http`-shim loopback
# (the same face pi-ai's fetch reaches in this runtime; the gateway httpFetch
# seam is invisible to the library, which is the honest mobile transport
# statement the probe records). The boot's own gateway route stays registered
# and never dialed.
#
# Idempotent and CI-safe: re-fetches any missing vendored package and
# rebuilds the host only when needed.
#
# usage: run-llm-piai-probe.sh   (artifacts: runtime/dsh/artifacts/macos-cli-llm-piai-probe)
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/runtime/dsh"

ART_DIR="$ROOT/runtime/dsh/artifacts/macos-cli-llm-piai-probe"
PIAI_KEY="mock-key-0001"

# 1. vendored upstream closure: pinned + sha256-verified (network only for
#    packages missing on disk) — includes the two llm-pi-ai-leg pins
#    (dsh-llm-pi-ai + its dsh-launch-environment link-time dep). The C host
#    ALSO needs the vendored iSH-AArch64 userland at configure time
#    (CMakeLists refuses without it) — ensure-ish.sh is idempotent.
sh ../../external/ensure.sh > /dev/null
sh ../../external/ensure-dsh.sh
sh ../../external/ensure-ish.sh

# 2. build the spike host when the binary is missing.
[ -x build/dsh-cli ] || sh ../../src/build.sh

# 3. run the scenario and verify one-to-one against the manifest.
./build/dsh-cli . scenario/llm-piai-probe.js --http \
    --env "DSH_PIAI_KEY=$PIAI_KEY" > logs-llm-piai-probe.txt
mkdir -p "$ART_DIR"
cp logs-llm-piai-probe.txt "$ART_DIR/logs.txt"
node "$ROOT/test/e2e/check.mjs" \
    --manifest "$ROOT/test/e2e/scenarios/llm-piai-probe.json" \
    --log logs-llm-piai-probe.txt \
    --out "$ART_DIR/verdict.json"

# 4. per-event evidence line (the structured scenario records, in log order).
grep '"scenario":"llm.piai-probe"' logs-llm-piai-probe.txt > "$ART_DIR/scenario.jsonl"

# 5. the receipt (what this run proves; one JSON document).
EVENTS="$(grep -c '"scenario":"llm.piai-probe"' "$ART_DIR/logs.txt")"
cat > "$ART_DIR/receipt.json" <<EOF
{
  "host": "$(uname -s | tr '[:upper:]' '[:lower:]')-cli ($(uname -sr) $(uname -m))",
  "engine": "quickjs-ng",
  "engineVersion": "0.17.0",
  "upstream": "@deepseek-ai/dsh-llm-pi-ai@0.1.6-alpha.2 + @deepseek-ai/dsh-launch-environment@0.1.6-alpha.2 (vendored verbatim, tgz sha256-pinned by external/ensure-dsh.sh)",
  "scenario": "llm.piai-probe",
  "events": $EVENTS,
  "proves": [
    "the vendored dsh-llm-pi-ai plugin loads VERBATIM inside quickjs-ng behind the GATED boot option (options.llm.piaiProviders): absent option mounts nothing, present option registers its PiAiAdapter for the named routes through ctx.llm.registerAdapter — one LlmRuntime registry serving the gateway adapter family AND the pi-ai family",
    "the LlmAdapter base-class contract answers through the public faces: listProviders reflects the adapter's providerInfo (id piai-test, displayName from the profile), listModels serves the configured catalog, resolveModelInfo carries the context capacity, prepareCall returns the frozen prepared call with the route's captured retry policy",
    "the credential path is real: the profile's apiKeyEnv reference resolves through the launch environment (the no-credentials-service mobile shape) and reaches the wire as the Bearer token the scripted server demands",
    "the transport is pi-ai's REAL openai-completions wire layer over the in-process loopback (the runtime fetch's only served face): the request is the library's own JSON wire shape (path /v1/chat/completions, stream:true) and the SSE reply translates into the harness StreamChunk vocabulary (block-start, text-delta, block-end, usage, finish stop) with the assembled text asserted"
  ]
}
EOF

echo "llm-piai-probe: PASS ($EVENTS scenario events; verdict $ART_DIR/verdict.json)"
