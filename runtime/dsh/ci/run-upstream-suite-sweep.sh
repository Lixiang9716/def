#!/bin/sh
# run-upstream-suite-sweep.sh — compat shim (2026-10-20). The sweep's
# orchestration — the bounded-parallel pool, the qjs one-shot retry, the
# TSV report + totals, the freshness re-transpile gate — moved to the Node
# driver tools/test/sweep.mjs, driven by the registry's `upstream-sweep`
# entry (test/verifications.mjs, the `drive` field). This wrapper only
# derives the repo root from its own position and execs the driver, so
# existing callers and the registry's runner prose keep working unchanged;
# output and exit codes are the driver's.
#
# usage: runtime/dsh/ci/run-upstream-suite-sweep.sh [--paral N] [--filter S] [--out DIR] [--dry-run]
set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
exec node "$ROOT/tools/test/sweep.mjs" "$@"
