#!/bin/sh
# runtime/dsh/ci/run-byok-piai-anthropic.sh — the CLI proof run for the BYOK
# MULTI-PROTOCOL wire leg: an ANTHROPIC credential saved through the page's
# own onboarding wire resolves into the piaiProviders dict byokRoute builds,
# the pi-ai mount serves the route (the rebind seam in upstream/
# llm-piai-mount.js), and ONE REAL turn streams pi-ai's anthropic-messages
# wire layer — through the composed anthropic-client shim (the openai-client
# precedent) — to the in-process anthropic-protocol SSE server, plus the
# rebind-over-mount round, the 401 face, and the clear leg's LIVE restore.
#
# Determinism: ONE quickjs process, NO network, NO node-side companion — the
# scripted anthropic server is the in-process `http`-shim loopback (the
# llm-piai-probe pattern). The canary rides the launch env under the BYOK
# ref name (ANTHROPIC_API_KEY — the apiKeyEnv seam); it is NEVER reproduced
# in any log line, which the runner AUDITS (matcher self-check + raw grep,
# the run-security-byok-leak.sh discipline).
#
# Idempotent and CI-safe: re-fetches any missing vendored package and
# rebuilds the host only when needed.
#
# usage: run-byok-piai-anthropic.sh
#        (artifacts: runtime/dsh/artifacts/macos-cli-byok-piai-anthropic)
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/runtime/dsh"

ART_DIR="$ROOT/runtime/dsh/artifacts/macos-cli-byok-piai-anthropic"
CANARY="byok-anthropic-canary-0001"
WRONG_KEY="byok-wrong-key-0000"

# 1. vendored upstream closure: pinned + sha256-verified (network only for
#    packages missing on disk).
sh vendor/ensure.sh > /dev/null
sh vendor/ensure-dsh.sh

# 2. build the spike host when the binary is missing.
[ -x build/dsh-cli ] || sh host/build.sh

# 3. run the scenario and verify one-to-one against the manifest.
mkdir -p "$ART_DIR"
LOG="$ART_DIR/logs.txt"
RC=0
./build/dsh-cli . scenario/byok-piai-anthropic.js --http \
    --env "ANTHROPIC_API_KEY=$CANARY" > "$LOG" 2>&1 || RC=$?
grep '"scenario":"byok.anthropic-wire"' "$LOG" > "$ART_DIR/scenario.jsonl" || true
node "$ROOT/test/e2e/check.mjs" \
    --manifest "$ROOT/test/e2e/scenarios/byok-anthropic-wire.json" \
    --log "$LOG" --out "$ART_DIR/verdict.json"
if [ "$RC" -ne 0 ]; then
    echo "   FAIL: the host exited $RC (crash, or the scenario reported failure — see $LOG)" >&2
    exit 1
fi

# 4. the MATCHER SELF-CHECK: the audit grep must be PROVEN to fire.
SCRATCH="$(mktemp /tmp/dsh-byok-piai-audit.XXXXXX)"
printf 'seeded line with %s inside\n' "$CANARY" > "$SCRATCH"
if ! grep -F -q -e "$CANARY" "$SCRATCH"; then
    rm -f "$SCRATCH"
    echo "byok-piai-anthropic: FAIL — the audit matcher cannot catch its own seeded leak" >&2
    exit 1
fi
rm -f "$SCRATCH"
echo "   self-check: the audit matcher fires on a seeded leak"

# 5. the KEY AUDIT: neither secret value may appear anywhere in the raw
#    capture (stdout + stderr + every debug line — the whole stream).
if grep -F -e "$CANARY" -e "$WRONG_KEY" "$LOG" >/dev/null; then
    echo "byok-piai-anthropic: FAIL — a credential value leaked into the log (HIGH finding)" >&2
    exit 1
fi
echo "   audit: canary + wrong-key probe absent from the raw log"

# 6. the receipt (what this run proves; one JSON document).
EVENTS="$(grep -c '"scenario":"byok.anthropic-wire"' "$ART_DIR/logs.txt")"
node - "$EVENTS" > "$ART_DIR/receipt.json" <<'NODE'
const events = Number(process.argv[2]);
const receipt = {
  host: `${process.platform}-cli (${process.platform} ${process.arch})`,
  engine: 'quickjs-ng',
  engineVersion: '0.17.0',
  upstream: '@deepseek-ai/dsh-llm-pi-ai@0.1.6-alpha.2 + @earendil-works/pi-ai@0.85.1 (vendored verbatim, tgz sha256-pinned by runtime/dsh/vendor/ensure-dsh.sh)',
  scenario: 'byok.anthropic-wire',
  events,
  proves: [
    "the BYOK save leg (the page's own onboarding wire) persists the credential into the frozen keychain ref and rebinds LIVE through the piai leg: the anthropic credential resolves into the piaiProviders dict (api anthropic-messages, apiKeyEnv ANTHROPIC_API_KEY, the one-model catalog with its context capacity, userEndpoint declared) — the dict names the credential REF, never the value",
    "the rebind seam mounts the vendored dsh-llm-pi-ai plugin over the byok dict through its own settings section: the registry serves the 'anthropic' route beside the boot gateway route, the plugin's directory declares the row (settingsNs llm-pi-ai), and a SECOND save takes the section-replace path (rebind-over-mount)",
    "ONE REAL turn streams pi-ai's anthropic-messages wire layer END TO END through the composed anthropic-client shim: the wire request is the protocol's own shape (POST /v1/messages, x-api-key present, anthropic-version 2023-06-01, stream:true) and the SSE reply translates into the harness StreamChunk vocabulary (block-start → text-delta → block-end → usage → finish stop) with the assembled text asserted",
    "the 401 face refuses with neither key value in the error (the byok-leak discipline), and the clear leg restores the boot route LIVE: the keychain ref is gone, the plugin no longer serves the route",
    "the key audit: the canary and the wrong-key probe appear NOWHERE in the raw captured log (matcher self-check proven), and the wire records key PRESENCE (a boolean), never the value",
  ],
};
process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
NODE
