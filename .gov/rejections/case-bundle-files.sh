#!/usr/bin/env bash
# gate: bundle-files
# Proves the harmony BUNDLE_FILES ↔ rawfile cross-check rejects the
# #56/#57 drift class: a BUNDLE_FILES entry whose rawfile copy is missing
# (the direction that kills every fresh launch at copyRawFile before a
# single scenario line — silent E2E starvation). Runs the checker against
# the real tree with one rawfile file temporarily removed, asserts the red
# names the missing copy, restores, and proves the same run goes green.
#
# #443 hardening (the self-test flake: four cases flipped red on a pristine
# tree, then green minutes later). Three defenses live here now:
#   1. the EXIT trap is armed BEFORE any early exit — the old script judged
#      its fixture before arming anything, so a 10s-budget SIGKILL mid-window
#      leaked both the mutation and the lock PERMANENTLY (replayed: Index.ets
#      sat mutated across reruns; nothing ever restored it);
#   2. the case recovers its OWN artifact class (a leaked .case-tmp from a
#      killed prior instance) before judging the fixture;
#   3. a preflight run asserts the tree green BEFORE the mutation, and both
#      the red-leg and green-leg failure messages carry the gate's residual
#      output inline — "still fails" without evidence is how #443 cost two
#      debugging sessions (govrail's report quotes only the first output
#      line, so the evidence rides ON that line).
#
# The mutation window holds the live-tree case lock: self-test runs project
# cases on a ThreadPoolExecutor (CONCURRENCY=4, no mutex), and this case's
# window (composer-web-live.js mv'd) turns case-staging-check's green leg
# red with a STALE row — the reverse holds too (its Index.ets row removal
# turns this green leg red). Serialize the windows; see the Agent Note
# 2026-09-29-the-staging-check-gate-closes-its-govern for the measured pair.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
REL="web-live/composer-web-live.js"
RAW="$REPO/hosts/harmony/entry/src/main/resources/rawfile/dsh/$REL"
CHECKER="$REPO/hosts/harmony/ci/check-bundle-files.mjs"

# --- the live-tree case lock (shared with case-staging-check.sh) ----------
# Worktree-scoped: the mutated tree (composer-web-live.js) is THIS worktree's,
# so the serialization window is per-worktree too — a global /tmp lock made
# parallel fleet agents' cases contend (and the 10s case budget SIGKILL
# leaks the lock, cascading timeouts; measured 2026-09-30, T-0078). The
# per-worktree git dir is the one per-worktree, always-writable,
# never-tracked home (a linked worktree's .git is a FILE — measured:
# mkdir .git/... fails fast and the acquire loop burned its whole deadline).
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
      echo "case-bundle-files: live-tree lock held >60s — failing loud" >&2
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

restore() { mv "$RAW.case-tmp" "$RAW" 2>/dev/null || true; }
trap 'release_tree_lock; restore' EXIT

# 443 defense 2: a killed prior instance leaks the mv (RAW gone, pristine
# bytes stranded in .case-tmp). Recover BEFORE judging the fixture — the old
# script failed "fixture absent" here forever, cementing the leak.
if [ ! -f "$RAW" ] && [ -f "$RAW.case-tmp" ]; then
  restore
  echo "case-bundle-files: recovered composer-web-live.js.case-tmp leaked by a killed prior instance" >&2
fi
[ -f "$RAW" ] || {
  echo "case-bundle-files: FAIL — fixture file absent; materialize rawfile first (vendor-official.sh)" >&2
  exit 1
}

OUT="$(mktemp)"
trap 'release_tree_lock; rm -f "$OUT"; restore' EXIT

acquire_tree_lock

# 443 defense 3: the tree must be green BEFORE this case touches it — this is
# what pins the red leg's red on OUR mutation. A red preflight is someone
# else's pollution (a sibling case's leak awaiting its owner's recovery, a
# concurrent stager on a shared checkout): one bounded settle-retry gives a
# same-batch sibling's recovery a beat to land; a persistent red fails loud
# with the full gate output — never a bare flake that "goes green minutes
# later". The assertion itself is never waived.
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
  echo "case-bundle-files: FAIL — the tree was red BEFORE this case mutated anything (persistent across one settle-retry); residual gate output: $(head -2 "$OUT" | tr '\n' ' | ')" >&2
  cat "$OUT" >&2
  exit 1
fi

mv "$RAW" "$RAW.case-tmp"
if node "$CHECKER" > "$OUT" 2>&1; then
  echo "case-bundle-files: FAIL — a missing rawfile copy passed" >&2
  exit 1
fi
grep -q "missing from rawfile" "$OUT" || {
  echo "case-bundle-files: red but not about the missing rawfile copy; residual gate output: $(head -2 "$OUT" | tr '\n' ' | ')" >&2
  cat "$OUT" >&2
  exit 1
}
restore
if ! node "$CHECKER" > "$OUT" 2>&1; then
  echo "case-bundle-files: FAIL — the restored tree still fails; residual gate output: $(head -2 "$OUT" | tr '\n' ' | ')" >&2
  cat "$OUT" >&2
  exit 1
fi
release_tree_lock
echo "case-bundle-files: missing rawfile copy rejected; restored tree green"
