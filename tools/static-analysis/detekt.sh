#!/bin/sh
# tools/static-analysis/detekt.sh — the detekt leg of the static-analysis CI
# workflow (test-hardening row 9): defect-class detekt over the Android host
# Kotlin (hosts/android/app/src — the only Kotlin tree in the repo).
#
# Baseline discipline (warn level, row 9): existing findings live in
# baselines/detekt.xml — the detekt-native baseline (rule id + source-range
# signatures), regenerated with `gen` and consumed with `check`; the leg goes
# red ONLY on findings not in the baseline — new violations, zero tolerance.
# Regenerate in the PINNED CI toolchain (the workflow's update_baselines
# dispatch run), never by hand mid-flight, so the baseline always describes
# what the gating detekt actually flags.
#
# The CLI jar is version + sha256 pinned below (the gov.yml actionlint/shellcheck
# install pattern): verified on EVERY run — a poisoned cache goes red, not
# green. Style-class rulesets (style, naming, complexity, empty-blocks,
# comments) stay OFF — config: tools/static-analysis/detekt-config.yml.
#
# usage: detekt.sh gen|check
# exit: 0 = no new findings; 1 = new findings; 2 = invocation or setup error.

set -eu
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

MODE="${1:-}"
case "$MODE" in
gen | check) ;;
*)
    echo "usage: $0 gen|check" >&2
    exit 2
    ;;
esac

DETEKT_VERSION=1.23.8
DETEKT_SHA256=2ce2ff952e150baf28a29cda70a363b0340b3e81a55f43e51ec5edffc3d066c1
JAR="tmp/detekt-cli-${DETEKT_VERSION}-all.jar"
CONFIG="tools/static-analysis/detekt-config.yml"
BASELINE="baselines/detekt.xml"
# The Android host's Kotlin: one source root, no test tree today
# (hosts/android/app/src/main/java/com/dshmobile/host).
INPUT="hosts/android/app/src"
REPORT="tmp/detekt-report.txt"

if ! command -v java >/dev/null 2>&1; then
    echo "detekt: FAIL — java not found on PATH (detekt needs a JDK; CI pins temurin 17)" >&2
    exit 2
fi

# Fetch the pinned jar on first use; verify the digest on EVERY use — the
# cache is an accelerator, never a source of truth (same rule as the vendored
# trees). shasum -a 256 -c - (the external/ensure.sh helper): present on the
# runner images and on macOS dev machines alike.
mkdir -p tmp
if [ ! -f "$JAR" ]; then
    curl --fail --location --silent --show-error --retry 3 -o "$JAR" \
        "https://github.com/detekt/detekt/releases/download/v${DETEKT_VERSION}/detekt-cli-${DETEKT_VERSION}-all.jar" ||
        {
            echo "detekt: FAIL — could not fetch detekt-cli ${DETEKT_VERSION}" >&2
            exit 2
        }
fi
if ! echo "${DETEKT_SHA256}  $JAR" | shasum -a 256 -c - >/dev/null 2>&1; then
    rm -f "$JAR"
    echo "detekt: FAIL — sha256 mismatch for $JAR (expected ${DETEKT_SHA256});" \
        "refusing a poisoned cache — refetch or re-pin deliberately" >&2
    exit 2
fi

# gen: --create-baseline rewrites the baseline from the full current finding
# set. check: --baseline suppresses exactly the baseline's findings; any
# finding beyond it fails the leg (build.maxIssues: 0 in the config).
DET_ARGS=""
if [ "$MODE" = "gen" ]; then
    DET_ARGS="--create-baseline --baseline $BASELINE"
else
    if [ ! -f "$BASELINE" ]; then
        echo "detekt: FAIL — $BASELINE missing; regenerate it via the workflow's" \
            "update_baselines dispatch (or: $0 gen with the same pinned jar)" >&2
        exit 2
    fi
    DET_ARGS="--baseline $BASELINE"
fi

DET_EXIT=0
# DET_ARGS is deliberately a word split — two flags or zero, by mode.
# shellcheck disable=SC2086
java -jar "$JAR" \
    --input "$INPUT" \
    --config "$CONFIG" \
    --build-upon-default-config \
    --report "txt:$REPORT" \
    $DET_ARGS >tmp/detekt-out.txt 2>&1 || DET_EXIT=$?

sed -n '/issues found/,$p' "$REPORT" 2>/dev/null || true
tail -n 20 tmp/detekt-out.txt

if [ "$MODE" = "gen" ]; then
    if [ ! -f "$BASELINE" ]; then
        echo "detekt: FAIL — gen mode left no $BASELINE behind (detekt exit $DET_EXIT)" >&2
        exit 2
    fi
    echo "detekt: baseline regenerated — $BASELINE (detekt exit $DET_EXIT in gen mode is" \
        "informational: findings are being recorded, not enforced)"
    exit 0
fi

if [ "$DET_EXIT" -ne 0 ]; then
    echo "detekt: FAIL — findings outside the baseline above (detekt exit $DET_EXIT);" \
        "full report: $REPORT — fix the code, or — only when a finding is" \
        "addressed by suppression/design — regenerate the baseline via the" \
        "workflow's update_baselines dispatch" >&2
    exit 1
fi

echo "detekt: green — no findings outside the baseline ($BASELINE)"
