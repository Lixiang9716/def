#!/bin/sh
# runtime/dsh/ci/run-gateway-audit-invariant.sh — the CLI proof run for the
# gateway AUDIT-COMPLETENESS invariant (contract/primitives.md §6: audit is
# mandatory and host-fixed — primitive name, caller identity, permission
# verdict, outcome code, never payload contents; §7 #2 makes the records a
# conformance requirement). scenario/gateway-audit-invariant.js drives every
# primitive of the frozen v1.x table through the states this seat can reach
# (success / §3 rejection / unavailable) over the raw seam and LEDGERS each
# call; this runner pairs that ledger against the host's audit stream
# (the `{"audit":...}` lines beside the log) and fails naming any:
#   - UNPAIRED CALL — a gateway call with no audit record (§6 violation);
#   - ORPHAN RECORD — an audit record no call explains (double-audit class);
#   - ORDER VIOLATION — a record paired out of call order;
#   - PAYLOAD LEAK / BAD KEY — anything beyond metadata inside a record
#     (key allowlist, closed outcome/verdict vocabulary, canary scan, a
#     320-byte line bound — §6 records carry no free text).
#
# Four gates, layered like run-security-gateway-fuzz.sh:
#   1. build; 2. the mock loopback http server (--http face); 3. the JS gate
#   (check.mjs one-to-one over the ledger's own records); 4. THE pairing
#   gate above — the invariant itself. Any unpaired call is RED and named.
#
# usage: run-gateway-audit-invariant.sh [--art-dir DIR] [--skip-build]
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/runtime/dsh"

ART=artifacts/macos-cli-gateway-audit-invariant
SKIP_BUILD=0
while [ $# -gt 0 ]; do
    case "$1" in
        --art-dir) ART="$2"; shift 2 ;;
        --skip-build) SKIP_BUILD=1; shift ;;
        *) echo "run-gateway-audit-invariant: unknown argument '$1'" >&2; exit 2 ;;
    esac
done
case "$ART" in
    /tmp/*) echo "run-gateway-audit-invariant: --art-dir must not be under /tmp (evidence lives with the repo)" >&2; exit 2 ;;
esac
case "$ART" in /*) ;; *) ART="$PWD/$ART" ;; esac
mkdir -p "$ART"

echo "== 1/4 build =="
if [ "$SKIP_BUILD" -eq 0 ]; then
    sh ../../src/build.sh >/dev/null
fi

echo "== 2/4 mock loopback http server (--http face) =="
# shellcheck disable=SC2016  # the server script is quoted for node, not sh
MOCK_SERVER='const http = require("node:http");
const srv = http.createServer((req, res) => {
    res.writeHead(200, {"content-type": "text/plain"});
    res.end("audit-invariant-mock");
});
srv.listen(0, "127.0.0.1", () =>
    console.log(`MOCK_BASE_URL=http://127.0.0.1:${srv.address().port}`));'
MOCK_LOG="$(mktemp "${TMPDIR:-/tmp}/dsh-mock-http-audit-inv.XXXXXX")"
PAIR="$(mktemp "${TMPDIR:-/tmp}/dsh-audit-pair.XXXXXX.cjs")"
node -e "$MOCK_SERVER" > "$MOCK_LOG" 2>&1 &
MOCK_PID=$!
cleanup() {
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
    rm -f "$MOCK_LOG" "$PAIR"
}
trap cleanup EXIT INT TERM
polled=0
until grep -s '^MOCK_BASE_URL=' "$MOCK_LOG" > /dev/null; do
    kill -0 "$MOCK_PID" 2>/dev/null || {
        echo "mock http server died before announcing:" >&2; cat "$MOCK_LOG" >&2; exit 1; }
    polled=$((polled + 1))
    if [ "$polled" -gt 300 ]; then
        echo "mock http server did not announce within 15s" >&2; exit 1
    fi
    sleep 0.05
done
MOCK_URL="$(sed -n 's/^MOCK_BASE_URL=//p' "$MOCK_LOG" | head -1)"
echo "   mock http server: $MOCK_URL" >&2

echo "== 3/4 JS gate: the full-matrix ledger =="
LOG="$ART/logs.txt"
rm -f "$LOG"
RC=0
(cd . && DSH_SPIKE_TMPDIR="$(mktemp -d)" ./build/dsh-cli . \
    scenario/gateway-audit-invariant.js --http \
    --env "DSH_MOCK_HTTP_URL=$MOCK_URL" > "$LOG" 2>&1) || RC=$?
grep '^dsh.runtime.log:' "$LOG" > "$ART/scenario.jsonl" || true
grep '^{"audit"' "$LOG" > "$ART/gateway-audit.jsonl" || true
node "$ROOT/test/e2e/check.mjs" \
    --manifest "$ROOT/test/e2e/scenarios/gateway-audit-invariant.json" \
    --log "$LOG" --out "$ART/verdict-gateway-audit-invariant.json"
if [ "$RC" -ne 0 ]; then
    echo "   FAIL: the host exited $RC (crash, or the scenario reported failure — see $LOG)" >&2
    exit 1
fi

echo "== 4/4 pairing gate: every call <-> exactly one audit record =="
cat > "$PAIR" <<'PAIR_EOF'
// The pairing gate: ledger (call half) vs audit stream (record half).
const fs = require('node:fs');
const strip = (line) => {
    const at = line.indexOf(': ');
    return JSON.parse(line.slice(at + 2));
};
const ledger = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean)
    .map(strip).map((env) => env.data[0])
    .filter((r) => r.event === 'audit.probe' || r.event === 'audit.host');
const lines = fs.readFileSync(process.argv[3], 'utf8').split('\n').filter(Boolean);
const records = lines.map((l) => JSON.parse(l));

// §6 metadata-only: the union of this repository's two audit-plane shapes
// (the CLI socket plane and the iOS per-call plane). Anything else is a key
// violation; the closed vocabularies and the 320-byte bound catch prose.
const KEYS = new Set(['audit', 'ts', 'caller', 'primitive', 'verdict', 'outcome',
    'detail', 'direction', 'grant', 'scope', 'port', 'peer', 'serverId',
    'connectionId', 'reason']);
const OUTCOMES = new Set(['ok', 'granted', 'denied', 'invalid', 'io', 'network',
    'timeout', 'cancelled', 'unavailable']);
const VERDICTS = new Set(['granted', 'denied']);
const CANARIES = ['audit-inv-canary', 'YXVkaXQtaW52LWNhbmFyeS1ieXRlcw==',
    'YXVkaXQtaW52LWNhbmFyeS1zb2NrZXQ=', '169.254.169.254'];

const problems = [];
const used = new Array(records.length).fill(false);
const pairOf = new Array(ledger.length).fill(-1);
for (let i = 0; i < ledger.length; i++) {
    const want = ledger[i].audit;
    const at = records.findIndex((r, j) => !used[j] && r.audit === want);
    if (at < 0) {
        problems.push(`UNPAIRED CALL cell=${ledger[i].cell} primitive=${ledger[i].primitive}`
            + ` expected audit record "${want}" — none in the stream (contract §6)`);
        continue;
    }
    used[at] = true;
    pairOf[i] = at;
}
for (let i = 1; i < ledger.length; i++) {
    if (pairOf[i - 1] >= 0 && pairOf[i] >= 0 && pairOf[i] < pairOf[i - 1]) {
        problems.push(`ORDER cell=${ledger[i].cell} record "${ledger[i].audit}"`
            + ` pairs at stream position ${pairOf[i]}, BEFORE cell=${ledger[i - 1].cell}'s`
            + ` position ${pairOf[i - 1]}`);
    }
}
records.forEach((r, j) => {
    if (!used[j]) problems.push(`ORPHAN RECORD no call claims ${JSON.stringify(r)}`);
});
records.forEach((r, j) => {
    const bad = Object.keys(r).filter((k) => !KEYS.has(k));
    if (bad.length > 0) problems.push(`BAD KEY record#${j + 1} carries ${bad.join(',')} — beyond §6 metadata`);
    if (r.outcome !== undefined && !OUTCOMES.has(r.outcome)) {
        problems.push(`BAD OUTCOME record#${j + 1} outcome=${r.outcome} — outside the §3 vocabulary`);
    }
    if (r.verdict !== undefined && !VERDICTS.has(r.verdict)) {
        problems.push(`BAD VERDICT record#${j + 1} verdict=${r.verdict}`);
    }
});
lines.forEach((line, j) => {
    const hit = CANARIES.find((c) => line.includes(c));
    if (hit) problems.push(`PAYLOAD LEAK record#${j + 1} carries canary ${hit} — §6 forbids payload contents`);
    if (line.length > 320) problems.push(`RECORD TOO LARGE record#${j + 1} is ${line.length} bytes — records are metadata, not payloads`);
});

const paired = pairOf.filter((p) => p >= 0).length;
console.log(`gateway-audit: pairing calls=${ledger.length} records=${records.length}`
    + ` paired=${paired} unpaired=${ledger.length - paired}`
    + ` orphans=${records.length - paired}`);
if (problems.length > 0) {
    for (const p of problems) console.error(`gateway-audit: FAIL ${p}`);
    console.error(`gateway-audit: FAIL ${problems.length} pairing violation(s)`
        + ` — the audit-completeness invariant (contract §6) does not hold on this host`);
    process.exit(1);
}
console.log('gateway-audit: PASS every gateway call has exactly one paired,'
    + ' ordered, metadata-only audit record');
PAIR_EOF
if node "$PAIR" "$ART/scenario.jsonl" "$ART/gateway-audit.jsonl"; then
    PAIRING=pass
else
    PAIRING=fail
fi

N_AUDITS=$(grep -c '^{"audit"' "$LOG" || true)
cat > "$ART/receipt.json" <<EOF
{
 "host": "macOS $(uname -m) (the desktop CLI, no simulator)",
 "phase": "gateway audit-completeness invariant (contract §6) — every v1.x primitive driven success/rejection/unavailable over the raw seam, each call paired against the host's audit stream",
 "launchConfiguration": "./build/dsh-cli . scenario/gateway-audit-invariant.js --http --env DSH_MOCK_HTTP_URL=<loopback mock>",
 "scenarios": [
  {
   "id": "gateway.audit-invariant",
   "checker": "test/e2e/scenarios/gateway-audit-invariant.json",
   "result": "pass",
   "note": "the 49-call ledger (31 contract primitives + the socket connection faces + the abort control face) matched one-to-one in order by check.mjs"
  }
 ],
 "audit": "counts quoted FROM THIS RUN's gate above, generated not hardcoded: audit records=$N_AUDITS, pairing gate=$PAIRING — unpaired calls, orphan records, order and payload-leak violations are named by the gate (artifacts/macos-cli-gateway-audit-invariant/gateway-audit.jsonl)",
 "notes": "The pairing gate is the invariant: an unaudited call is a §6 violation even when the call succeeds, so this leg stays red until the host audits every call."
}
EOF

if [ "$PAIRING" != "pass" ]; then
    echo "run-gateway-audit-invariant: FAIL — the pairing gate named the violations above" >&2
    exit 1
fi
echo "run-gateway-audit-invariant: PASS — evidence in $ART"
