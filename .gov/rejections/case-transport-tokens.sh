#!/usr/bin/env bash
# gate: transport-tokens
# Proves the transport-tokens checker rejects the exact defect class it
# exists for: a pre-rename token spelling resurfacing in a live layer file.
# Vehicle: append a comment carrying 'dsh.spike.log' to runtime/dsh/logger.js
# — the 2026-10 rename's most-contagious old spelling (139 verdict/tool
# files carried it), planted in the canonical closure a comment-only edit
# cannot reach. Asserts the red names the file AND the token, restores
# byte-identically, and proves the same run goes green.
#
# The live-tree case lock (the shared discipline of case-bundle-files.sh,
# case-staging-check.sh, case-staging-generated-webclient-leak.sh, ...):
# this case USED to run lock-free — "the mutation is one inert comment line;
# measured against every other case's checker, nothing flips verdicts" — a
# claim measured on an un-materialized tree and falsified on a materialized
# one: under self-test's 4-way pool the checker's green leg raced a sibling
# case's window and read scanned bytes mid-mutation, failing "the restored
# tree still fails" in three consecutive full-DAG runs (2026-10-19) while
# passing solo every time. The mutation stays inert; the GREEN LEG is not
# immune to siblings, so the window takes the lock like every other case.
# 60s deadline, per the family: the runner's 10s SIGKILL is the bound that
# actually kills; below it, patience is free.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="$REPO/runtime/dsh/logger.js"
[ -f "$TARGET" ] || { echo "case-transport-tokens: FAIL — logger.js absent" >&2; exit 1; }

GITDIR="$(git -C "$REPO" rev-parse --git-dir 2>/dev/null || true)"
case "$GITDIR" in
  /*) ;;                       # already absolute
  [A-Za-z]:[/\\]*) ;;          # Windows drive-letter absolute (win32 worktree: git prints D:/...)
  "") GITDIR="$TMPDIR" ;;      # no git — fall back to the shared tmp lock
  *) GITDIR="$REPO/$GITDIR" ;;
esac
LOCKDIR="$GITDIR/dsh-gov-live-tree-case.lock"
TREE_LOCK_HELD=0
acquire_tree_lock() {
  local deadline=$(( SECONDS + 60 ))
  while ! mkdir "$LOCKDIR" 2>/dev/null; do
    if [ -n "$(find "$LOCKDIR" -maxdepth 0 -mmin +2 2>/dev/null)" ]; then
      rmdir "$LOCKDIR" 2>/dev/null || true   # stolen: a killed case left it
      continue
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "case-transport-tokens: live-tree lock held >60s — failing loud" >&2
      return 1
    fi
    sleep 0.05
  done
  TREE_LOCK_HELD=1
}
release_tree_lock() {
  [ "$TREE_LOCK_HELD" -eq 1 ] || return 0   # never rmdir a lock we don't hold
  rmdir "$LOCKDIR" 2>/dev/null || true
  TREE_LOCK_HELD=0
}

# 443 discipline: recover a killed prior instance's leak BEFORE arming the
# window — a 10s-budget SIGKILL mid-window leaves logger.js mutated with the
# pristine .case-tmp beside it, and the next run restores instead of
# inheriting the poison.
if [ -e "$TARGET.case-tmp" ]; then
  mv "$TARGET.case-tmp" "$TARGET" 2>/dev/null || true
  echo "case-transport-tokens: recovered logger.js.case-tmp leaked by a killed prior instance" >&2
fi

cp "$TARGET" "$TARGET.case-tmp"
restore() { mv "$TARGET.case-tmp" "$TARGET" 2>/dev/null || true; }
OUT="$(mktemp)"
trap 'release_tree_lock; restore; rm -f "$OUT"' EXIT

acquire_tree_lock

# The injection: the old log-line prefix family, in a comment — the shape a
# copy-paste from a pre-rename artifact or a stale fixture reintroduces.
printf '\n// case-transport-tokens probe: the old prefix dsh.spike.log must be rejected\n' >> "$TARGET"

if node "$REPO/tools/check-transport-tokens.mjs" > "$OUT" 2>&1; then
  echo "case-transport-tokens: FAIL — a pre-rename spelling passed the checker" >&2
  exit 1
fi
grep -q 'runtime/dsh/logger.js' "$OUT" && grep -q "dsh.spike." "$OUT" || {
  echo "case-transport-tokens: red but not about the injected logger.js spelling" >&2
  exit 1
}

restore
if ! node "$REPO/tools/check-transport-tokens.mjs" >/dev/null 2>&1; then
  echo "case-transport-tokens: FAIL — the restored tree still fails" >&2
  exit 1
fi
release_tree_lock
echo "case-transport-tokens: pre-rename spelling rejected; restored tree green"
