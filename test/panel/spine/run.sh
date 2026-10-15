#!/bin/sh
# test/panel/spine/run.sh — the spine suite runner (node --test over the REAL
# runtime: runtime/dsh/upstream/boot.js + the vendored closure through the
# node_modules farm, provision-modules.mjs; the loader bridge register.mjs
# installs the dsh:/node:-face hooks; spine-seams.mjs stages the host seams).
#
# The farm is machine-local (junctions onto the vendored closure, gitignored
# via runtime/dsh/node_modules) and idempotent to (re)build; a fresh checkout
# needs the vendored closure materialized first (external/ensure.sh
# + ensure-dsh.sh — the same prerequisite the closures gate documents).
#
# Shape: the runner and the suite paths are REPO-ROOT-RELATIVE and the cwd is
# the git toplevel — the loader hooks and the suite anchor their own paths at
# their module URLs, and every other spelling (directory args, absolute file
# args, `..`-ladder cds from a script) measurably misfires on MSYS bash 5.2 +
# Node 24 (imported-as-module / URL scheme 'd:' / one-level-short cwd). New
# suite files join the --test line below.
#
# The journal-migration leg runs in a SECOND, hook-less invocation: it drives
# the vendored jsonl backend on real disk (the journal contract must hold on
# node's own fs, not the workspace VFS the hooks serve), and the hooks remap
# node:fs for every module under runtime/ — which is where the vendored
# packages realpath. Its resolution layer lives in journal-resolution.mjs
# (see there; the parity-node-modules.sh prerequisite it names joins
# external/ensure-dsh.sh in the fresh-checkout list).
set -eu
ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$ROOT"
node test/panel/spine/provision-modules.mjs
# The vendored graph's internal bare imports resolve through the REAL
# ancestor chain of the vendored trees (node realpaths ESM entries) — one
# external/node_modules, skip-loud for absent faces, idempotent.
sh runtime/dsh/ci/parity-node-modules.sh
node --import ./test/panel/spine/register.mjs \
  --test test/panel/spine/composer-journal.test.mjs \
  test/panel/spine/session-delete.test.mjs \
  test/panel/spine/watchdog-abort-wire.test.mjs
exec node --test test/panel/spine/journal-migration.test.mjs
