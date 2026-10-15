#!/usr/bin/env bash
# gate: staging-check
# Proves the staging-manifest verifier catches the disease it exists for
# (the 2026-09 fresh-install death): a file the import graph REACHES that
# the hand manifest no longer stages. Vehicle: the upstream/boot.js row in
# harmony's Index.ets BUNDLE_FILES — a boot entry every reached file hangs
# from, so dropping its single row is the minimal real gap. Runs the checker
# against the real tree with the row removed, asserts the red names the file
# as a GAP on a blocking host, restores byte-identically, and proves the
# same run goes green.
#
# #443 hardening: the old script judged its fixture BEFORE arming its EXIT
# trap, so a 10s-budget SIGKILL mid-window leaked BOTH the mutated Index.ets
# and the pristine .case-tmp backup PERMANENTLY (replayed: the mutation
# survived reruns as a tracked-file edit no case ever restored). Now: the
# trap is armed before any early exit; a leaked .case-tmp is recovered
# before the fixture judgment; the pristine backup is taken INSIDE the lock
# (a pre-acquire cp could snapshot a concurrent window's mutated bytes and
# later "restore" them, cementing the leak); a preflight asserts the tree
# green BEFORE the mutation; and both failure messages carry the gate's
# residual output inline (govrail's report quotes only the first output
# line, so the evidence rides ON that line).
#
# The mutation window holds the live-tree case lock: self-test runs project
# cases on a ThreadPoolExecutor (CONCURRENCY=4, no mutex), and this case's
# window (Index.ets row gone) turns case-bundle-files' green leg red — the
# reverse holds too (its composer-web-live.js mv turns this green leg red
# with a STALE row). Serialize the windows; see the Agent Note
# 2026-09-29-the-staging-check-gate-closes-its-govern for the measured pair.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
IDX="$REPO/hosts/harmony/entry/src/main/ets/pages/Index.ets"
CHECKER="$REPO/tools/check-staging.mjs"

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
      echo "case-staging-check: live-tree lock held >60s — failing loud" >&2
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

restore() { mv "$IDX.case-tmp" "$IDX" 2>/dev/null || true; }
OUT="$(mktemp)"
trap 'release_tree_lock; rm -f "$OUT"; restore' EXIT

# 443: recover a killed prior instance's leak BEFORE judging the fixture.
if [ -e "$IDX.case-tmp" ]; then
  restore
  echo "case-staging-check: recovered Index.ets.case-tmp leaked by a killed prior instance" >&2
fi
rm -f "$IDX.case-tmp.2"   # a strangled mid-splice sed twin has no pristine value
[ -f "$IDX" ] || { echo "case-staging-check: FAIL — Index.ets absent" >&2; exit 1; }
grep -q "^\s*'upstream/boot\.js',$" "$IDX" || {
  echo "case-staging-check: FAIL — fixture row 'upstream/boot.js' absent from BUNDLE_FILES" >&2
  exit 1
}

acquire_tree_lock

# Harmony-only: the case's assertion lives entirely on harmony's
# BUNDLE_FILES (the vehicle row IS harmony's), and under the full DAG's
# gate concurrency the three-host walk stretched the case past its 10s
# budget (measured 2026-09-30, T-0078). One host, same proof.
#
# 443: preflight — the tree must be green BEFORE this case mutates it (this
# pins the red leg's red on OUR row removal). A red here is someone else's
# pollution: one bounded settle-retry gives a same-batch sibling's recovery a
# beat to land; a persistent red fails loud with the full gate output.
preflight_green() {
  local attempt out="$1"
  for attempt in 1 2; do
    if node "$CHECKER" --json --block harmony > "$out" 2>&1; then return 0; fi
    [ "$attempt" -eq 1 ] || break
    sleep 2
  done
  return 1
}
if ! preflight_green "$OUT"; then
  echo "case-staging-check: FAIL — the tree was red BEFORE this case mutated anything (persistent across one settle-retry); residual gate output: $(head -2 "$OUT" | tr '\n' ' | ')" >&2
  cat "$OUT" >&2
  exit 1
fi

cp "$IDX" "$IDX.case-tmp"     # INSIDE the lock: never snapshot a concurrent window
grep -v "^\s*'upstream/boot\.js',$" "$IDX" > "$IDX.case-tmp.2" && mv "$IDX.case-tmp.2" "$IDX"

# --json mode: the gap surfaces as a structured row of the harmony result,
# not the human "GAP … NOT staged" line — assert on the payload itself.
if node "$CHECKER" --json --block harmony > "$OUT" 2>&1; then
  echo "case-staging-check: FAIL — a boot entry missing from BUNDLE_FILES passed the gate" >&2
  exit 1
fi
grep -q '"file": "upstream/boot.js"' "$OUT" || {
  echo "case-staging-check: red but not about the unstaged boot entry; residual gate output: $(head -2 "$OUT" | tr '\n' ' | ')" >&2
  cat "$OUT" >&2
  exit 1
}

restore
if ! node "$CHECKER" --json --block harmony > "$OUT" 2>&1; then
  echo "case-staging-check: FAIL — the restored tree still fails; residual gate output: $(head -2 "$OUT" | tr '\n' ' | ')" >&2
  cat "$OUT" >&2
  exit 1
fi
release_tree_lock
echo "case-staging-check: unstaged boot entry rejected; restored tree green"
