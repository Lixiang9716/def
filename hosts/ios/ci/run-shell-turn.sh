#!/bin/sh
# run-shell-turn.sh — the T-0216 shell-turn leg on the iOS simulator: the
# user-facing SessionServe seat (AppDelegate.swift:54 — a launch with
# `-dsh-serve` opts the DEBUG harness binary into the same bootRelease path
# a release build takes), a mock-LLM turn whose scripted tool call drives
# the ONE shell tool, and the evidence that the tool ran IN THE APP — the
# rendered tool card, the on-disk fsWrite, and the durable session journal.
#
# The shape is the Android leg's (hosts/android/ci/run-shell-turn.sh) with
# the iOS realities swapped in:
#   1. materialize (no rebuild by default): the vendor closure, the official
#      dist, and the client bundles are verified/rebuilt by their ensure
#      scripts; `build/build.sh sync ios` regenerates the embed + project.
#      The INSTALLED io.github.lixiang9716.def is driven as-is (the owner's build);
#      --build opts into gen.sh + xcodebuild when a rebuild is warranted.
#   2. the vendored dsh-llm-mock on the HOST loopback (the simulator shares
#      host loopback — no reverse step), script `tool_call_success` then
#      `success`, tool name/args pointed at the shell (overridable);
#   3. the seat's container trees staged in: Documents/official-web/dist,
#      Documents/web-plugins (the run-ios-live-write.sh recipe), and the
#      credential <Documents>/profiles/default/llm/config.json
#      (SessionServe.swift loadCredential) — the credential is REMOVED again
#      on every exit path (calendar-live discipline);
#   4. launch with -dsh-serve capturing stdout/stderr (simctl launch
#      --stdout/--stderr lands the NSLog stream on the host), poll the
#      stderr capture for `dsh.serve: origin token=` (SessionServe.swift:496)
#      and read the bound port off lsof;
#   5. the prompt enters through the composer's OWN wire: POST
#      /api/session/prompt with the client-request envelope, the token as
#      the query parameter (CarrierRequest.isAuthed) and the pageSession
#      from GET /api/state (CarrierAPIBridge.snapshotState);
#   6. verdict: the mock's two attempts completed AND note.txt on the
#      container disk carries the exact expected bytes AND the evidence
#      files exist — pass; any missing piece settles partial; a stage that
#      cannot run at all settles blocked (never a faked pass).
#
# usage: run-shell-turn.sh [--build] [--skip-materialize]
#   (env: DSH_IOS_UDID, DSH_SHELLTURN_OUT, DSH_MOCK_TOOL_NAME,
#    DSH_MOCK_TOOL_ARGS)
set -eu

ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$ROOT" || exit 1
UDID="${DSH_IOS_UDID:-A4AE41BF-026A-441E-85DF-F53522996073}"   # dsh-iphone
APP_BUNDLE_ID=io.github.lixiang9716.def
OUT="${DSH_SHELLTURN_OUT:-hosts/ios/artifacts/shell-turn}"
TOOL_NAME="${DSH_MOCK_TOOL_NAME:-shell}"
TOOL_ARGS="${DSH_MOCK_TOOL_ARGS:-{\"command\":\"echo hi-from-ios > note.txt && cat note.txt\"}}"
PROBE_TEXT=hi-from-ios
APP_DATA=""
MOCK_PID=""
MOCK_LOG=""

DO_BUILD=0
SKIP_MATERIALIZE=0
for arg in "$@"; do
    case "$arg" in
        --build) DO_BUILD=1 ;;
        --skip-materialize) SKIP_MATERIALIZE=1 ;;
        *) echo "usage: run-shell-turn.sh [--build] [--skip-materialize]" >&2; exit 2 ;;
    esac
done

say() { echo "run-shell-turn: $*"; }

# The honest endings: blocked writes a receipt naming the wall, then exits 1
# (partial is computed at the evidence step, never here).
write_blocked_receipt() {
    reason=$1
    mkdir -p "$OUT/screens"
    TREE_LINE="origin/main $(git rev-parse --short=12 HEAD)$(git diff-index --quiet HEAD -- || echo ' (dirty working tree at receipt time)')"
    printf '{\n  "host": "iOS Simulator %s",\n  "phase": "t0216.shell.turn",\n  "verdict": "blocked",\n  "blockers": ["%s"],\n  "tree": "%s",\n  "producedAt": "%s"\n}\n' \
        "$UDID" "$reason" "$TREE_LINE" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        > "$OUT/receipt.json"
}
die() {
    echo "::error::run-shell-turn: $*" >&2
    write_blocked_receipt "$(echo "$*" | sed 's/"/\\"/g')"
    exit 1
}

cleanup() {
    if [ -n "$APP_DATA" ]; then
        rm -f "$APP_DATA/Documents/profiles/default/llm/config.json" 2>/dev/null || true
    fi
    [ -n "${MOCK_PID:-}" ] && kill "$MOCK_PID" 2>/dev/null || true
    [ -n "${MOCK_LOG:-}" ] && [ -f "${MOCK_LOG:-}" ] && cp "$MOCK_LOG" "$OUT/mock-server-stdout.txt" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ---- 1. materialize (the ask's discipline: 物化先行) -----------------------------
if [ "$SKIP_MATERIALIZE" = "0" ]; then
    say "1/6 materialize: vendor closure + ios sync + official dist + client bundles"
    sh external/ensure.sh >/dev/null || die "external/ensure.sh failed"
    sh external/ensure-dsh.sh >/dev/null || die "external/ensure-dsh.sh failed"
    build/build.sh sync ios >/dev/null || die "build/build.sh sync ios failed"
    # bash-only (set -o pipefail, BASH_SOURCE) — under dash `sh` dies at
    # runtime on pipefail; macOS sh=bash masked it (#301, same fix as the
    # matrix's materialize())
    bash test/e2e/ensure-official-dist.sh || die "ensure-official-dist.sh failed"
    bash test/e2e/ensure-client-bundles.sh || die "ensure-client-bundles.sh failed"
else
    say "1/6 materialize skipped (--skip-materialize)"
fi
if [ "$DO_BUILD" = "1" ]; then
    say "1b/6 rebuild requested: gen.sh + xcodebuild + install"
    sh hosts/ios/gen.sh >/dev/null || die "gen.sh failed"
    xcodebuild build -project hosts/ios/DSHHost.xcodeproj -scheme DSHHost \
        -destination "platform=iOS Simulator,id=$UDID" \
        -derivedDataPath hosts/ios/DerivedData >/dev/null || die "xcodebuild failed"
    xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || true
    xcrun simctl install "$UDID" hosts/ios/DerivedData/Build/Products/Debug-iphonesimulator/DSHHost.app \
        || die "simctl install failed"
fi
bash hosts/ios/Tools/sim-preflight.sh "$UDID" || die "simulator runtime preflight failed (the iOS 18.5 trap)"
xcrun simctl bootstatus "$UDID" -b >/dev/null || die "simulator did not finish booting"
APP_DATA="$(xcrun simctl get_app_container "$UDID" "$APP_BUNDLE_ID" data)" \
    || die "io.github.lixiang9716.def is not installed on $UDID (install it first, or pass --build)"
[ -n "$APP_DATA" ] || die "empty app container path for $APP_BUNDLE_ID"

# ---- 2. the mock in the credential seat ----------------------------------------
say "2/6 mock llm (tool_call_success → $TOOL_NAME) on the host loopback"
pkill -f mock-llm-server 2>/dev/null || true
sleep 1
MOCK_LOG="$(mktemp /tmp/dsh-mock-shellturn-ios.XXXXXX)"
DSH_MOCK_SEQUENCE="tool_call_success success" DSH_MOCK_REPEAT_LAST=0 \
DSH_MOCK_TOOL_NAME="$TOOL_NAME" DSH_MOCK_TOOL_ARGS="$TOOL_ARGS" \
    node runtime/dsh/ci/mock-llm-server.mjs > "$MOCK_LOG" 2>&1 &
MOCK_PID=$!
polled=0
until grep -s '^MOCK_BASE_URL=' "$MOCK_LOG" > /dev/null; do
    kill -0 "$MOCK_PID" 2>/dev/null || { cat "$MOCK_LOG" >&2; die "mock died before announcing"; }
    polled=$((polled + 1))
    [ "$polled" -gt 300 ] && die "mock did not announce within 15s"
    sleep 0.05
done
MOCK_URL="$(sed -n 's/^MOCK_BASE_URL=//p' "$MOCK_LOG" | head -1)"
say "mock at $MOCK_URL (host loopback — the simulator shares it, no reverse)"

# ---- 3. stage the container: dist + web-plugins + credential ---------------------
say "3/6 stage dist + web-plugins + llm credential into the container"
rm -rf "$APP_DATA/Documents/official-web"
mkdir -p "$APP_DATA/Documents/official-web"
cp -R presentation/official-web/dist "$APP_DATA/Documents/official-web/dist" \
    || die "staging the official dist failed"
PKG_SRC="external/npm/@deepseek-ai/dsh-client-modules@0.1.6-alpha.2"
[ -f "$PKG_SRC/lib/client.js" ] || die "vendored bootstrap package missing (ensure-dsh.sh)"
rm -rf "$APP_DATA/Documents/web-plugins"
mkdir -p "$APP_DATA/Documents/web-plugins/npm/@deepseek-ai"
cp -R presentation/official-web/client-bundles/npm/@deepseek-ai/. \
    "$APP_DATA/Documents/web-plugins/npm/@deepseek-ai/" || die "staging client bundles failed"
rm -rf "$APP_DATA/Documents/web-plugins/npm/@deepseek-ai/dsh-client-modules@0.1.6-alpha.2"
cp -R "$PKG_SRC" "$APP_DATA/Documents/web-plugins/npm/@deepseek-ai/" \
    || die "staging the pinned dsh-client-modules failed"
mkdir -p "$APP_DATA/Documents/profiles/default/llm"
printf '{"baseUrl":"%s","apiKey":"mock-key-0001","model":"mock-1"}\n' "$MOCK_URL" \
    > "$APP_DATA/Documents/profiles/default/llm/config.json"
grep -q '"apiKey"' "$APP_DATA/Documents/profiles/default/llm/config.json" \
    || die "credential staging failed"

# ---- 4. launch (-dsh-serve) + wait for the origin token + port -------------------
say "4/6 launch -dsh-serve — polling for the serving line"
mkdir -p "$OUT/screens"
LOG="$OUT/logs.txt"
NSLOG="$OUT/nslog-stderr.txt"
rm -f "$LOG" "$NSLOG"
case "$LOG" in /*) LOG_ABS="$LOG" ;; *) LOG_ABS="$PWD/$LOG" ;; esac
case "$NSLOG" in /*) NSLOG_ABS="$NSLOG" ;; *) NSLOG_ABS="$PWD/$NSLOG" ;; esac
xcrun simctl terminate "$UDID" "$APP_BUNDLE_ID" >/dev/null 2>&1 || true
sleep 1
xcrun simctl launch --terminate-running-process \
    --stdout="$LOG_ABS" --stderr="$NSLOG_ABS" \
    "$UDID" "$APP_BUNDLE_ID" -dsh-serve >/dev/null \
    || die "simctl launch -dsh-serve failed"
APP_PID=""
pid_deadline=$(( $(date +%s) + 15 ))
while [ -z "$APP_PID" ]; do
    APP_PID="$(pgrep -f "DSHHost.app/DSHHost" | head -1)"
    [ -n "$APP_PID" ] && break
    [ "$(date +%s)" -ge "$pid_deadline" ] && die "launched but no DSHHost process found within 15s"
    sleep 1
done

token_deadline=$(( $(date +%s) + 120 ))
: > "$OUT/.token.txt"
until sed -n 's/.*dsh\.serve: origin token=\([0-9a-f]*\).*/\1/p' "$NSLOG" > "$OUT/.token.txt" \
        && [ -s "$OUT/.token.txt" ]; do
    if [ "$(date +%s)" -ge "$token_deadline" ]; then
        grep "dsh.session.serve" "$NSLOG" | head -2 >&2 || true
        die "no 'dsh.serve: origin token=' line within 120s (bootstrap failure above)"
    fi
    sleep 2
done
TOKEN="$(tail -1 "$OUT/.token.txt")"

port_deadline=$(( $(date +%s) + 30 ))
: > "$OUT/.port.txt"
until lsof -nP -a -iTCP -sTCP:LISTEN -p "$APP_PID" 2>/dev/null \
        | sed -n 's/.*127\.0\.0\.1:\([0-9]*\) (LISTEN).*/\1/p' | head -1 > "$OUT/.port.txt" \
        && [ -s "$OUT/.port.txt" ]; do
    [ "$(date +%s)" -ge "$port_deadline" ] && die "no listening carrier port within 30s"
    sleep 1
done
PORT="$(tail -1 "$OUT/.port.txt")"
say "serving: 127.0.0.1:$PORT (pid $APP_PID)"

# ---- 5. the turn through the composer's own wire ---------------------------------
say "5/6 POST /api/session/prompt (client-request envelope)"
# The carrier serves /api the moment the port binds, but the PAGE's session
# only exists after its boot graph runs and the composer creates/restores the
# session — poll for the page's own pageSession (the bridge's notePageSession
# tracks it, CarrierAPIBridge.swift:168-182) instead of inventing an id: the
# runtime answers a synthesized id with session/not-found ("not attached to
# the mobile runtime", measured).
PAGE_SESSION=""
page_deadline=$(( $(date +%s) + 120 ))
while [ -z "$PAGE_SESSION" ]; do
    PAGE_SESSION="$(curl -s -m 5 "http://127.0.0.1:$PORT/api/state?token=$TOKEN" \
        | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{try{const s=JSON.parse(r);process.stdout.write(s.pageSession??"")}catch{}})')" \
        || PAGE_SESSION=""
    [ -n "$PAGE_SESSION" ] && break
    [ "$(date +%s)" -ge "$page_deadline" ] \
        && die "no pageSession in /api/state within 120s — the page never attached a session"
    sleep 2
done
say "pageSession: $PAGE_SESSION"
sleep 2
xcrun simctl io "$UDID" screenshot "$OUT/screens/02-boot-screen.png" >/dev/null 2>&1 || true
# The first-boot onboarding modal (内测声明) overlays the chat if this profile
# has not dismissed it yet — best-effort tap on 继续 (idb when present; the
# wire plane works either way, only the card shots would carry the modal).
if command -v idb >/dev/null 2>&1 || [ -x "$HOME/.local/bin/idb" ]; then
    IDB="$HOME/.local/bin/idb"; command -v idb >/dev/null 2>&1 && IDB=idb
    "$IDB" ui tap 203 589 --udid "$UDID" >/dev/null 2>&1 || true
    sleep 2
fi
curl -s -m 15 -X POST "http://127.0.0.1:$PORT/api/session/prompt?token=$TOKEN" \
    -H 'content-type: application/json' \
    -d "{\"type\":\"client-request\",\"rpcId\":\"rpc-shellturn-1\",\"method\":\"session/prompt\",\"payload\":{\"args\":{\"request\":{\"requestId\":\"req-shellturn-1\",\"sessionId\":\"$PAGE_SESSION\",\"mode\":\"queue\",\"content\":[{\"type\":\"text\",\"text\":\"please run a shell command that echoes $PROBE_TEXT\"}]}}}}" \
    > "$OUT/prompt-response.json" || die "the POST to /api/session/prompt failed"
grep -q '"accepted":true' "$OUT/prompt-response.json" \
    || die "the prompt was not accepted by the serving seat: $(head -c 200 "$OUT/prompt-response.json")"

turn_deadline=$(( $(date +%s) + 180 ))
until grep -q '"scriptBehavior":"success","behavior":"success","outcome":"completed"' "$MOCK_LOG" 2>/dev/null; do
    [ "$(date +%s)" -ge "$turn_deadline" ] && die "the turn did not settle within 180s (mock: $(tail -1 "$MOCK_LOG"))"
    sleep 2
done
say "turn settled (tool_call_success → success, both completed)"
sleep 4   # let the tool card render before the shots

# ---- 6. evidence ------------------------------------------------------------------
say "6/6 evidence: screenshots + fs probe + journal + receipt"
cp "$MOCK_LOG" "$OUT/mock-server-stdout.txt" 2>/dev/null || true
curl -s -m 5 "http://127.0.0.1:$PORT/api/state?token=$TOKEN" > "$OUT/state-snapshot.json" 2>/dev/null || true

xcrun simctl io "$UDID" screenshot "$OUT/screens/03-turn-rendered.png" >/dev/null 2>&1 || true
if command -v idb >/dev/null 2>&1 || [ -x "$HOME/.local/bin/idb" ]; then
    IDB="$HOME/.local/bin/idb"; command -v idb >/dev/null 2>&1 && IDB=idb
    "$IDB" ui tap 113 323 --udid "$UDID" >/dev/null 2>&1 || true
    sleep 2
    xcrun simctl io "$UDID" screenshot "$OUT/screens/04-tool-card.png" >/dev/null 2>&1 || true
    "$IDB" ui tap 120 367 --udid "$UDID" >/dev/null 2>&1 || true
    sleep 2
    xcrun simctl io "$UDID" screenshot "$OUT/screens/05-tool-card-expanded.png" >/dev/null 2>&1 || true
fi

# The fs probe: the executor's round trip through the gateway primitives —
# byte-exact, not a grep wish.
FS_OK=0
PROBE="$APP_DATA/Documents/profiles/default/dsh/note.txt"
if [ -f "$PROBE" ]; then
    cp "$PROBE" "$OUT/note.txt"
    printf '%s\n' "$PROBE_TEXT" | cmp -s - "$OUT/note.txt" && FS_OK=1
fi

# The durable session journal: newest session.v3.jsonl.zstd under the
# workspace's sessions tree.
JOURNAL_OK=0
JDIR="$APP_DATA/Documents/profiles/default/dsh/dsh/sessions"
NEWEST_JOURNAL="$(find "$JDIR" -name 'session.v3.jsonl.zstd' -type f -print0 2>/dev/null \
    | xargs -0 ls -t 2>/dev/null | head -1 || true)"
if [ -n "${NEWEST_JOURNAL:-}" ] && [ -f "$NEWEST_JOURNAL" ]; then
    cp "$NEWEST_JOURNAL" "$OUT/session-journal.jsonl.zstd"
    JOURNAL_OK=1
fi

SCREENS_OK=0
[ -s "$OUT/screens/03-turn-rendered.png" ] && SCREENS_OK=1

VERDICT=partial
if [ "$FS_OK" = "1" ] && [ "$JOURNAL_OK" = "1" ] && [ "$SCREENS_OK" = "1" ]; then
    VERDICT=pass
fi

TREE_LINE="origin/main $(git rev-parse --short=12 HEAD)$(git diff-index --quiet HEAD -- || echo ' (dirty working tree at receipt time)')"
JOURNAL_BYTES=""
[ "$JOURNAL_OK" = "1" ] && JOURNAL_BYTES="$(wc -c < "$OUT/session-journal.jsonl.zstd" | tr -d ' ')"
cat > "$OUT/receipt.json" <<EOF
{
  "host": "iOS Simulator $UDID (pid $APP_PID, -dsh-serve seat)",
  "phase": "t0216.shell.turn",
  "verdict": "$VERDICT",
  "build": "the installed io.github.lixiang9716.def driven with -dsh-serve (AppDelegate.swift:54) — no rebuild; container trees staged per the run-ios-live-write.sh recipe",
  "model": "vendored dsh-llm-mock on the host loopback (no reverse — the simulator shares it); tool_call_success → $TOOL_NAME",
  "drive": "composer's own wire: POST /api/session/prompt (client-request envelope) with the dsh.serve origin token (SessionServe.swift:496) and the /api/state pageSession",
  "proves": [
    "the interactive seat boots and serves the official client (127.0.0.1:$PORT, the previous round's 404 was the legacy harness chain — CarrierRoutes.swift:30 — not the auth gate)",
    "the prompt was accepted through the serving seat's own wire (prompt-response.json)",
    "the mock's two attempts completed (mock-server-stdout.txt) and the official UI renders the shell tool card (screens/)",
    "the executor's fsWrite landed on the container disk byte-exact: Documents/profiles/default/dsh/note.txt",
    "the durable session journal landed (session-journal.jsonl.zstd$([ "$JOURNAL_OK" = "1" ] && echo ", $JOURNAL_BYTES bytes"))"
  ],
  "tree": "$TREE_LINE",
  "producedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
say "receipt written — the shell turn ran in the app — $OUT (verdict: $VERDICT)"
