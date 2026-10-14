#!/bin/sh
# runtime/dsh/ci/check-quickjs-boot-parse.sh — the `quickjs-boot-parse` gate.
#
# WHY: node --check passing is not "QuickJS can parse". The 2026-09-29 shim
# splits (fs.js -> fs-seeded.js, buffer.js -> buffer-codecs.js) landed
# node-clean and QuickJS-fatal — a class of error only the real engine
# exposes. This gate compiles the break surface on purpose: a throwaway
# scenario importing the two split roots, booted under the vendored
# quickjs-ng through the desktop CLI, requiring exit 0 — so the next
# node-clean/QuickJS-fatal edit goes red here, at the gate, instead of red
# in a scenario nobody ran. The stub is deleted on every exit path; closure
# stagers enumerate scenarios from explicit pin lists, so the transient file
# cannot trip closures/bundle-files.
#
# Arch-neutral since the iSH engine retired (2026-10): the CLI link carries
# no AArch64 asm anymore, so any runner that builds the CLI can run this
# gate (it rides the gov.yml gates DAG's materialized vendored closure).
#
# Budget: sub-second with the prebuilt CLI (measured 0.04s); on a miss the
# CLI is built first (src/build.sh — the same rule run-*-e2e.sh uses; a cold
# CI build is the one path that can exceed the steady-state budget).
#
# usage: check-quickjs-boot-parse.sh   (cwd-independent; exit 0 = boot graph compiles)
set -eu
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT/runtime/dsh"

# 1. The engine exists — build on miss (rule 5: a missing engine is a loud
#    build, never a silent skip).
if [ ! -x build/dsh-cli ]; then
    echo "quickjs-boot-parse: build/dsh-cli missing — building (src/build.sh)"
    sh ../../src/build.sh
fi

# 2. The stub scenario: imports the two split roots under the real loader.
#    Logging goes through the unified logger (rule L3) so the gate's log
#    stream stays shaped; the imports are the point — they pull fs ->
#    fs-seeded -> buffer -> buffer-codecs and the bridges, exactly the
#    surface a shim split touches.
STUB="scenario/ci-quickjs-parse-probe.js"
cleanup() { rm -f "$STUB"; }
trap cleanup EXIT INT TERM
cat > "$STUB" <<'STUB_EOF'
// Throwaway stub of the quickjs-boot-parse gate — created and deleted by
// runtime/dsh/ci/check-quickjs-boot-parse.sh, never committed.
import { createLogger } from '../logger.js';
import * as fs from 'upstream/shims/fs.js';
import { DshBuffer } from 'upstream/shims/buffer.js';

const log = createLogger('ci.quickjs-parse-probe');
log.debug('quickjs parse probe: boot graph resolved', {
  fs: typeof fs,
  DshBuffer: typeof DshBuffer,
});
globalThis.__dshComplete(true, 'quickjs parse probe: boot graph compiled');
STUB_EOF

# 3. The vendored dsh closure: the shim graph pulls dsh: modules (fs.js ->
#    dsh:util-crypto), materialized by ensure-dsh.sh — NOT by ensure.sh,
#    so a fresh CI runner needs it here (measured 2026-10-13 on
#    ubuntu-24.04-arm: 'cannot load module dsh:util-crypto'). Idempotent;
#    network only on first fetch.
sh ../../external/ensure-dsh.sh

# 4. Boot it: exit 0 only when the whole graph compiles AND evaluates under
#    the vendored engine.
./build/dsh-cli . "$STUB"
