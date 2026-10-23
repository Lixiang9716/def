#!/bin/sh
# runtime/dsh/ci/run-models-byok-add-e2e.sh — the CLI proof run for the
# models 设置页's BYOK ADD flow: boots the mobile profile with the GATED
# `llm.piaiSection` (the vendored @deepseek-ai/dsh-llm-pi-ai plugin over an
# EMPTY base — the catalog directory, the "llm-pi-ai" settings section, and
# the credentials service; zero staged routes) beside the undialed gateway
# route, and drives the page's REAL save order through the write surface
# (`fullCoverage: true`): settings/describe (the llm-pi-ai namespace and its
# protocol union), settings/mutate `set providers/acme` (the plugin's section
# watcher re-registers the route), credentials/set (the app-scope
# credentials.json the write surface serves — the same file the gate's
# CredentialsStore reads), then ONE dial through pi-ai's real
# openai-completions wire to the in-process loopback record server.
#
# TWO record servers, one per transport class:
#   loopback — the in-process `http`-shim server (the llm-piai-probe face);
#     it demands the canary bearer and records per-request FACTS (booleans),
#     so the wire event proves the STORED credential answered (the container
#     env carries a decoy under the same ref — the store must shadow it).
#   bridge   — the node-side vendored mock (ci/mock-llm-server.mjs, the
#     run-llm-piai-user-endpoint companion pattern), re-spelled to
#     http://localhost:PORT: `localhost` sits outside the loopback address
#     rule, so the SECOND save (the same row, non-loopback endpoint) arms the
#     fetch→gateway bridge through the section-write leg, and the dial
#     crosses the frozen gateway httpFetch seam to the mock's REAL socket —
#     where the mock demands the canary, making the streamed text the
#     acceptance proof.
#
# The collision leg (a throwaway boot with a `deepseek` gateway route) proves
# the DUPLICATE_DIRECTORY fail-loud names BOTH sides before any of it runs.
#
# The captured log is verified one-to-one against
# test/e2e/scenarios/models-byok-add.json. The key audit greps the RAW log
# for the canary AND the decoy — neither may appear (the matcher is proven
# on a seeded line first; the run-security-byok-leak.sh discipline).
# Artifacts: runtime/dsh/artifacts/macos-cli-models-byok-add/.
#
# usage: run-models-byok-add-e2e.sh
#        (artifacts: runtime/dsh/artifacts/macos-cli-models-byok-add)
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/runtime/dsh"

ART_DIR="$ROOT/runtime/dsh/artifacts/macos-cli-models-byok-add"
CANARY="byok-acme-canary-0001"
DECOY="decoy-launch-env-acme-key"

# 1. vendored upstream closure: pinned + sha256-verified.
sh ../../external/ensure.sh > /dev/null
sh ../../external/ensure-dsh.sh

# 2. build the spike host when the binary is missing.
[ -x build/dsh-cli ] || sh ../../src/build.sh
mkdir -p "$ART_DIR"

# 3. the bridge record server companion: start, poll to readiness (rule 8,
#    bounded 15s), and re-spell 127.0.0.1 → localhost — the hostname is the
#    routing decision that puts the endpoint outside the loopback address
#    rule (the socket stays loopback, which is all the CLI host's httpFetch
#    ever serves).
BRIDGE_LOG="$ART_DIR/bridge-mock.log"
DSH_MOCK_LLM_KEY="$CANARY" DSH_MOCK_SEQUENCE='success' \
    DSH_MOCK_SUCCESS_TEXT='Bridged through the gateway' \
    node ci/mock-llm-server.mjs > "$BRIDGE_LOG" 2>&1 &
MOCK_PID=$!
trap 'kill "$MOCK_PID" 2>/dev/null || true' EXIT
BRIDGE_URL=""
GUARD=0
while [ "$GUARD" -lt 60 ] && [ -z "$BRIDGE_URL" ]; do
    BRIDGE_URL="$(sed -n 's/^MOCK_BASE_URL=//p' "$BRIDGE_LOG" | head -1)"
    GUARD=$((GUARD + 1))
    [ -n "$BRIDGE_URL" ] || sleep 0.25
done
if [ -z "$BRIDGE_URL" ]; then
    echo "bridge mock never became ready — see $BRIDGE_LOG" >&2
    exit 1
fi
BRIDGE_URL="$(printf '%s' "$BRIDGE_URL" | sed 's|//127\.0\.0\.1:|//localhost:|')"
case "$BRIDGE_URL" in
    http://localhost:*) ;;
    *) echo "bridge mock URL is not a localhost socket: $BRIDGE_URL" >&2; exit 1 ;;
esac
echo "bridge mock: $BRIDGE_URL" >&2

# 4. run the scenario and verify one-to-one.
LOG="$ART_DIR/logs.txt"
RC=0
./build/dsh-cli . scenario/models-byok-add.js --http \
    --env "DSH_BYOK_CANARY=$CANARY" \
    --env "DSH_BYOK_BRIDGE_BASE_URL=$BRIDGE_URL" > "$LOG" 2>&1 || RC=$?
grep '^dsh.runtime.log:' "$LOG" > "$ART_DIR/scenario.jsonl" || true
node "$ROOT/test/e2e/check.mjs" \
    --manifest "$ROOT/test/e2e/scenarios/models-byok-add.json" \
    --log "$LOG" \
    --out "$ART_DIR/verdict.json"
if [ "$RC" -ne 0 ]; then
    echo "e2e: FAIL — the host exited $RC (crash, or the scenario reported failure — see $LOG)" >&2
    exit 1
fi

# 5. the key audit: the canary and the decoy appear nowhere in the raw
#    capture — after first proving the matcher fires on a seeded line (an
#    audit that cannot match is an audit that cannot catch).
SCRATCH="$(mktemp /tmp/dsh-byok-add-audit.XXXXXX)"
printf 'seeded line with %s and %s inside\n' "$CANARY" "$DECOY" > "$SCRATCH"
if ! grep -F -q -e "$CANARY" -e "$DECOY" "$SCRATCH"; then
    rm -f "$SCRATCH"
    echo "models-byok-add: FAIL — the audit matcher cannot catch its own seeded values" >&2
    exit 1
fi
rm -f "$SCRATCH"
if grep -F -e "$CANARY" -e "$DECOY" "$LOG" "$BRIDGE_LOG" >/dev/null; then
    echo "models-byok-add: FAIL — a credential value leaked into a log" >&2
    exit 1
fi

# 6. the receipt (what this run proves; one JSON document).
EVENTS="$(grep -c '"scenario":"models.byok-add"' "$LOG")"
cat > "$ART_DIR/receipt.json" <<EOF
{
  "host": "$(uname -s | tr '[:upper:]' '[:lower:]')-cli ($(uname -sr) $(uname -m))",
  "engine": "quickjs-ng",
  "engineVersion": "0.17.0",
  "quickjsTag": "v0.17.0",
  "quickjsCommit": "6d46d07d04041b40f4f49eaa7fdebe44c314c699",
  "upstream": "@deepseek-ai/dsh-* 0.1.6-alpha.2 (vendored verbatim, tgz sha256-pinned by external/ensure-dsh.sh)",
  "kernel": "@deepseek-ai/cordis@4.0.2",
  "scenario": "models.byok-add",
  "proves": [
    "the DUPLICATE_DIRECTORY collision fails loud naming BOTH sides: a throwaway boot with a deepseek gateway route plus the pi-ai section gate is refused at mount with the colliding catalog id AND the live row (provider deepseek, settings ns llm-deepseek) and the two ways out — never a quiet partial mount",
    "the GATED pi-ai section boot mounts the vendored plugin over an EMPTY base: settings/describe answers the llm-pi-ai namespace (base layer providers:{}, user layer free) whose schema offers the whole protocol union (openai-completions / openai-responses / anthropic-messages), and llm/listConfigurableProviders answers only the staged route row — acme does not exist before the page saves it",
    "the page's save is real through the wire: settings/mutate set providers/acme lands the row in the user layer over the intact empty base and the plugin's section watcher registers it — llm/listConfigurableProviders then answers the acme row (settingsNs llm-pi-ai, settingsPath [providers, acme])",
    "the credential half of the same save rides the page store: credentials/set writes the app-scope credentials.json the write surface serves — the SAME file the gate's CredentialsStore reads — and describe proves configured without ever returning the value",
    "the saved route SERVES with the STORED credential: pi-ai resolves ctx.get('credentials') before the launch environment, the in-process record server observes the canary bearer (the container env's decoy did NOT ride the wire), and the openai-completions SSE stream assembles end to end",
    "the BRIDGE variant: re-saving the row against a non-loopback endpoint (localhost-spelled node-side record server) arms the fetch→gateway bridge through the section-write leg (the honesty set names localhost, hostnames only), and the dial crosses the frozen gateway httpFetch seam to the mock's real socket — which demands the canary, so the streamed text is the acceptance proof",
    "the cleanup leaves the store empty (credentials/unset → describe configured:false), so re-runs start from the same state; the canary and the decoy appear nowhere in the raw capture"
  ],
  "checker": "test/e2e/scenarios/models-byok-add.json",
  "events": $EVENTS,
  "exitCode": 0
}
EOF

echo "e2e: PASS $ART_DIR" >&2
