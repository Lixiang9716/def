#!/usr/bin/env bash
# gate: staging-generated
# Proves the webclient manifest legs reject the #288 leak class: one
# unsynced (untracked) file inside the whole-tree-staged
# presentation/web-client-v2 directory turns gen-staging-emit --check red
# naming the exact leaked file, and removing it restores green. This is
# the hand counter-proof for A12, re-institutionalized when the retired
# check-webclient-staged-tree.sh count-16 was replaced by the
# webclient*.rows store family (a count only ever noticed the total).
#
# #443 hardening — this case now holds the live-tree case lock, the last
# live-tree case to join it. Its checker (gen-staging-emit --check) READS
# Index.ets's BUNDLE_FILES block and the harmony rawfile mirrors — exactly
# what the locked cases mutate in their windows. Unlocked, its red/green
# legs went red whenever they overlapped a locked window ("gate went red
# but not about the leaked file" / "the restored tree still fails the
# gate" — the #443 signatures; the drift line was real: "Index.ets lacks
# generated row: upstream/boot.js", replayed 2026-10-15). The lock makes
# the windows mutually exclusive by construction. Also: the trap is armed
# before any early exit (a 10s-budget SIGKILL used to leak the leak file),
# a preflight asserts the tree green BEFORE the mutation, and both failure
# messages carry the gate's residual output inline (govrail's report
# quotes only the first output line, so the evidence rides ON that line).
#
# #504 hardening — every failure line is now self-sufficient evidence:
# it records the tool's REAL exit code (bare `if !` negates it away inside
# the then-branch, so drift-1 / structure-error-2 / SIGKILL-137 were
# indistinguishable), an empty residual file is NAMED as such — every
# gen-staging-emit exit path prints before exiting, so empty output means
# the tool died before speaking: an environmental suspect — and a residual
# failure captures df for the $TMPDIR mount ($OUT is a mktemp there; a
# full tmpfs reproduces exactly the zero-output death signature).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$REPO/presentation/web-client-v2"
LEAK="$DIR/web/js/.case-leak-tmp.js"
STORE="$REPO/tools/generated/staging"
TOOL="$REPO/tools/gen-staging-emit.mjs"

# --- the live-tree case lock (the shared discipline of case-bundle-files.sh,
# case-bundle-files-dotfile.sh, case-staging-check.sh, case-asset-mirrors.sh).
# Worktree-scoped: the mutated tree is THIS worktree's product tree. The
# deadline used to be 5s ("this window is sub-second; waiting longer only
# converts contention into a timeout kill") — but on a materialized tree the
# lock-family siblings ahead of this case each hold the lock 1.2–4.7s
# (measured 2026-10-19, solo), so a moderate queue pushed the wait past 5s
# and the case failed on the LOCK while its own window still fit the 10s
# budget. 60s, case-staging-check's deadline, defers to the real bound: the
# runner's 10s SIGKILL kills an over-budget run no matter what this deadline
# says; below it, patience is free.
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
      echo "case-staging-generated-webclient-leak: live-tree lock held >5s — failing loud" >&2
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

restore() { rm -f "$LEAK"; }
OUT="$(mktemp)"
trap 'release_tree_lock; rm -f "$OUT"; restore' EXIT

# 443: a killed prior instance leaks the leak file (SIGKILL never runs the
# trap); remove it BEFORE the preflight.
if [ -e "$LEAK" ]; then
  rm -f "$LEAK"
  echo "case-staging-generated-webclient-leak: removed a leak file left by a killed prior instance" >&2
fi

[ -d "$DIR" ] || {
  echo "case-staging-generated-webclient-leak: FAIL — product directory absent" >&2
  exit 1
}

acquire_tree_lock

# 504: the shared failure-line builder — govrail quotes only the first line,
# so each FAIL carries the gate's real exit code plus its residual output;
# an EMPTY residual is said out loud (the tool exited without speaking:
# environmental suspect), never left as a dangling "residual output: " tail.
residual_tail() { # <rc> <out-file>
  local rc="$1" out="$2"
  if [ -s "$out" ]; then
    printf 'gate exited %s; residual output: %s' "$rc" "$(head -2 "$out" | tr '\n' ' | ')"
  else
    printf 'gate exited %s; residual output: <empty> — tool exited with no output; environmental suspect' "$rc"
  fi
}

# 443: preflight — the derivation must be green BEFORE this case plants
# anything (this pins the red leg's red on OUR leak). A red here is someone
# else's drift (a stale store, a sibling case's leak awaiting its owner's
# recovery, a concurrent stager): one bounded settle-retry gives a same-batch
# sibling a beat to land; a persistent red fails loud with the full output.
preflight_green() {
  local attempt out="$1" rc=0
  for attempt in 1 2; do
    rc=0
    # 504: capture the real exit code — `if !` consumes it (in the then-branch
    # $? is the negation's 0), which is how drift-1 / structure-2 / kill-137
    # all read as one undifferentiated red.
    node "$TOOL" --check "$STORE" > "$out" 2>&1 || rc=$?
    if [ "$rc" -eq 0 ]; then return 0; fi
    [ "$attempt" -eq 1 ] || break
    sleep 2
  done
  return "$rc"
}
preflight_rc=0
preflight_green "$OUT" || preflight_rc=$?
if [ "$preflight_rc" -ne 0 ]; then
  echo "case-staging-generated-webclient-leak: FAIL — the tree was red BEFORE this case mutated anything (persistent across one settle-retry); $(residual_tail "$preflight_rc" "$OUT")" >&2
  cat "$OUT" >&2
  df -h "${TMPDIR:-/tmp}" >&2
  exit 1
fi

printf '/* rejection-case leak: an unsynced file the HAP cannot carry */\n' > "$LEAK"
red_rc=0
node "$TOOL" --check "$STORE" > "$OUT" 2>&1 || red_rc=$?
if [ "$red_rc" -eq 0 ]; then
  echo "case-staging-generated-webclient-leak: FAIL — an unsynced file in the staged tree PASSED the gate" >&2
  exit 1
fi
grep -q "leak or new): web/js/.case-leak-tmp.js" "$OUT" || {
  echo "case-staging-generated-webclient-leak: gate went red but not about the leaked file; $(residual_tail "$red_rc" "$OUT")" >&2
  cat "$OUT" >&2
  df -h "${TMPDIR:-/tmp}" >&2
  exit 1
}
restore
restore_rc=0
node "$TOOL" --check "$STORE" > "$OUT" 2>&1 || restore_rc=$?
if [ "$restore_rc" -ne 0 ]; then
  echo "case-staging-generated-webclient-leak: FAIL — the restored tree still fails the gate; $(residual_tail "$restore_rc" "$OUT")" >&2
  cat "$OUT" >&2
  df -h "${TMPDIR:-/tmp}" >&2
  exit 1
fi
release_tree_lock
echo "case-staging-generated-webclient-leak: unsynced file rejected (exact name named); restored tree green"
