#!/usr/bin/env bash
# gate: bundle-files
# Proves the harmony BUNDLE_FILES cross-check rejects the HAP-packer class:
# a hidden file under rawfile/spike can NEVER ride the HAP (the packer drops
# dotfiles at packaging — the 2026-09-30 device-leg deaths at
# materializeBundle on the pi-ai providers manifest), so the checker must
# reject one whether listed or not. Drops a dotfile into the live rawfile
# tree, asserts the red names the packer fact, removes it, and proves the
# same run goes green.
#
# #443 hardening: the EXIT trap is armed before any early exit; a leaked
# .case-dotfile.json from a 10s-budget SIGKILL of a prior instance is
# removed before the preflight (its hidden name turns EVERY concurrent
# check-bundle-files run red — including the other cases' green legs); the
# preflight asserts the tree green BEFORE the mutation; and both failure
# messages carry the gate's residual output inline (govrail's report quotes
# only the first output line, so the evidence rides ON that line).
#
# The mutation window holds the live-tree case lock (the shared discipline
# of case-bundle-files.sh — see its header for the measured collision pair).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DOT="$REPO/hosts/harmony/entry/src/main/resources/rawfile/dsh/scenario/.case-dotfile.json"
CHECKER="$REPO/hosts/harmony/ci/check-bundle-files.mjs"

# Worktree-scoped lock (see case-bundle-files.sh for the measured rationale).
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
      echo "case-bundle-files-dotfile: live-tree lock held >60s — failing loud" >&2
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
# --------------------------------------------------------------------------

cleanup() { rm -f "$DOT"; release_tree_lock; }
trap cleanup EXIT

# 443: a killed prior instance leaks the dotfile (SIGKILL never runs the
# trap). Remove it BEFORE the preflight — its hidden name makes every other
# case's check-bundle-files leg red until someone notices.
if [ -e "$DOT" ]; then
  rm -f "$DOT"
  echo "case-bundle-files-dotfile: removed a .case-dotfile.json leaked by a killed prior instance" >&2
fi

OUT="$(mktemp)"
trap 'rm -f "$OUT"; cleanup' EXIT

acquire_tree_lock
# 443: preflight — the tree must be green BEFORE the mutation (this pins the
# red leg's red on OUR dotfile). A red here is someone else's pollution: one
# bounded settle-retry gives a same-batch sibling's recovery a beat to land;
# a persistent red fails loud with the full gate output. Never waived.
preflight_green() {
  local attempt out="$1"
  for attempt in 1 2; do
    if node "$CHECKER" > "$out" 2>&1; then return 0; fi
    [ "$attempt" -eq 1 ] || break
    sleep 2
  done
  return 1
}
if ! preflight_green "$OUT"; then
  echo "case-bundle-files-dotfile: FAIL — the tree was red BEFORE this case mutated anything (persistent across one settle-retry); residual gate output: $(head -2 "$OUT" | tr '\n' ' | ')" >&2
  cat "$OUT" >&2
  exit 1
fi

echo '{}' > "$DOT"
if node "$CHECKER" > "$OUT" 2>&1; then
  echo "case-bundle-files-dotfile: FAIL — a hidden rawfile file passed" >&2
  exit 1
fi
grep -q "packer drops dotfiles" "$OUT" || {
  echo "case-bundle-files-dotfile: red but not about the hidden file; residual gate output: $(head -2 "$OUT" | tr '\n' ' | ')" >&2
  cat "$OUT" >&2
  exit 1
}
rm -f "$DOT"
if ! node "$CHECKER" > "$OUT" 2>&1; then
  echo "case-bundle-files-dotfile: FAIL — the cleaned tree still fails; residual gate output: $(head -2 "$OUT" | tr '\n' ' | ')" >&2
  cat "$OUT" >&2
  exit 1
fi
release_tree_lock
echo "case-bundle-files-dotfile: hidden rawfile file rejected; cleaned tree green"
