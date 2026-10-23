#!/bin/sh
# Assert the four version sources agree with version.txt on EVERY run —
# not only at tag time. The drift this catches is real: the first v0.0.3
# tag attempt (2026-10-23) was refused because xcodegen regenerates
# hosts/ios/App/Info.plist from hosts/ios/project.yml, where a stale hand
# pin said 0.1.0 while the bump had written 0.0.3 — and three gov runs
# blessed the tree in between (def#669 carries the full story).
#
# --self-test runs the rejection proof first (rules.md rule 6): a fixture
# whose project.yml drifted must FAIL, then the live tree is judged.
#
# Exit 0 agreement, 1 mismatches named, 2 invalid fixture.

set -eu

ROOT="${ROOT:-.}"   # --self-test re-invokes with ROOT pointed at its fixture
if [ "${1:-}" = "--self-test" ]; then
  FIXTURE=$(mktemp -d)
  trap 'rm -rf "$FIXTURE"' EXIT
  mkdir -p "$FIXTURE/hosts/ios" "$FIXTURE/hosts/android/app" "$FIXTURE/hosts/harmony/AppScope"
  printf '0.0.3' > "$FIXTURE/version.txt"
  printf 'CFBundleShortVersionString: "0.0.3"' > "$FIXTURE/hosts/ios/project.yml"
  printf 'versionName = "0.0.3"' > "$FIXTURE/hosts/android/app/build.gradle.kts"
  printf '{"versionName": "0.0.3"}' > "$FIXTURE/hosts/harmony/AppScope/app.json5"
  # the drift: one source quietly disagrees
  printf 'CFBundleShortVersionString: "0.1.0"' > "$FIXTURE/hosts/ios/project.yml.drift"
  mv "$FIXTURE/hosts/ios/project.yml.drift" "$FIXTURE/hosts/ios/project.yml.bak"
  sed 's/0.0.3/0.1.0/' "$FIXTURE/hosts/ios/project.yml" > "$FIXTURE/hosts/ios/project.yml.drift"
  mv "$FIXTURE/hosts/ios/project.yml" "$FIXTURE/hosts/ios/project.yml.bak2"
  mv "$FIXTURE/hosts/ios/project.yml.drift" "$FIXTURE/hosts/ios/project.yml"
  if ROOT="$FIXTURE" sh "$0" >/dev/null 2>&1; then
    echo "version-stream --self-test: FAIL — the drifted fixture passed (rule 6: a gate that never fails is vacuous)" >&2
    exit 2
  fi
  echo "version-stream --self-test: rejection proof green (drifted fixture named)"
fi

fail=0
check() { # <label> <expected> <actual>
  if [ "$2" != "$3" ]; then
    echo "MISMATCH $1: version.txt says $2 but the file says $3" >&2
    fail=1
  fi
}

want=$(tr -d '[:space:]' < "$ROOT/version.txt")

ios=$(sed -n 's/^[[:space:]]*CFBundleShortVersionString:[[:space:]]*"\([^"]*\)".*/\1/p' \
  "$ROOT/hosts/ios/project.yml" | head -1)
check "hosts/ios/project.yml CFBundleShortVersionString" "$want" "$ios"

android=$(sed -n 's/^[[:space:]]*versionName[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' \
  "$ROOT/hosts/android/app/build.gradle.kts" | head -1)
check "hosts/android/app/build.gradle.kts versionName" "$want" "$android"

harmony=$(sed -n 's/.*"versionName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
  "$ROOT/hosts/harmony/AppScope/app.json5" | head -1)
check "hosts/harmony/AppScope/app.json5 versionName" "$want" "$harmony"

if [ "$fail" -ne 0 ]; then
  echo "" >&2
  echo "The version stream disagrees with itself. Bump through" >&2
  echo "packages/release/bump-version.py (it writes all four in one command);" >&2
  echo "a hand edit of one source is the drift this gate exists to name." >&2
  exit 1
fi

echo "version-stream check: $want == version.txt == project.yml == build.gradle.kts == app.json5"
