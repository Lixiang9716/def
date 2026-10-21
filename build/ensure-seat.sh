#!/bin/sh
# build/ensure-seat.sh — make a cold worktree gate-capable in one command.
#
# WHY: the gates' base checks (bundle-files, closures, staging-generated,
# self-test's baseline probe) read UNTRACKED trees a linked worktree never
# carries — the vendored closure, the pinned engines, the npm pins, the
# tools' node_modules. A fresh seat therefore goes red on those checks
# before any of its code is judged, and the fix was tribal knowledge (three
# sessions re-derived it by hand, 2026-10). The inventory now lives in
# .gov/materialization.json; this script is its only executor, so the list
# cannot rot in a skill file.
#
# HOW: rsync — never cp, whose interrupted run poisons the target — each
# tree from the PRIMARY checkout of this worktree graph, then build.sh's
# sync verbs re-stage the committed host mirrors. Offline by design: the
# primary seat is the only source.
#
# usage: build/ensure-seat.sh [--verify] [seat-path]
#   seat-path  the linked worktree to materialize (default: this checkout)
#   --verify   after staging, probe the base gates (bundle-files, closures)
set -eu

SEAT=""
VERIFY=0
for arg in "$@"; do
    case "$arg" in
        --verify) VERIFY=1 ;;
        -h|--help) echo "usage: $0 [--verify] [seat-path]"; exit 0 ;;
        *) [ -z "$SEAT" ] || { echo "ensure-seat: one seat-path at most (got '$SEAT' and '$arg')" >&2; exit 2; }
           SEAT="$arg" ;;
    esac
done
[ -n "$SEAT" ] || SEAT="$(pwd)"
SEAT="$(cd "$SEAT" && pwd)"

SCRIPT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# The primary checkout of this worktree graph: the common .git dir's parent.
# From the primary itself this resolves to the same root (rsync no-ops).
# rev-parse may answer with a seat-relative path (".git" when the seat is
# the primary), so anchor it to the seat before cd-ing — the script must
# work from any cwd, not only from inside the seat.
COMMON_DIR="$(git -C "$SEAT" rev-parse --git-common-dir)"
case "$COMMON_DIR" in /*) ;; *) COMMON_DIR="$SEAT/$COMMON_DIR" ;; esac
PRIMARY="$(dirname "$(cd "$COMMON_DIR" && pwd)")"

# The seat's own manifest when it has one (the branch carrying this script);
# otherwise the script's own checkout — a seat on an older branch is
# materialized against the newest inventory, not left red on a missing file.
MANIFEST="$SEAT/.gov/materialization.json"
[ -f "$MANIFEST" ] || MANIFEST="$SCRIPT_ROOT/.gov/materialization.json"
[ -f "$MANIFEST" ] || {
    echo "ensure-seat: no materialization manifest at $MANIFEST" >&2
    exit 2
}

echo "ensure-seat: seat $SEAT"
echo "ensure-seat: primary $PRIMARY"
TREES="$(node -e '
    const m = require(process.argv[1]);
    for (const t of m.trees) console.log(t);
' "$MANIFEST")"

for tree in $TREES; do
    src="$PRIMARY/$tree/"
    dst="$SEAT/$tree/"
    if [ "$src" = "$dst" ]; then
        continue
    fi
    if [ ! -d "$src" ]; then
        echo "ensure-seat: SKIP $tree (absent in primary — never materialized there either)" >&2
        continue
    fi
    echo "ensure-seat: rsync $tree"
    rsync -a --delete "$src" "$dst"
done

for verb in $(node -e '
    const m = require(process.argv[1]);
    for (const v of (m.syncVerbs ?? ["core", "harmony"])) console.log(v);
' "$MANIFEST"); do
    echo "ensure-seat: sync $verb"
    (cd "$SEAT" && build/build.sh sync "$verb" >/dev/null)
done

# The seat-only provisions (the manifest's `provision` array — executed here,
# so the inventory stays the single source of what a cold seat must carry).
# The submodule corpus: a linked worktree cannot share the primary's
# submodule gitdir (it is checked out there — `submodule update` refuses a
# second checkout of the same module dir), so the provision CLONES the
# primary's submodule checkout in place — offline, and it lands on the
# pinned gitlink sha because that is the primary's own HEAD. The Node
# resolution farm: built IN the seat, never rsynced — the parity script's
# links are seat-absolute, so a copied farm would silently resolve the
# seat's node leg against the PRIMARY tree's bytes (#627).
while IFS= read -r step; do
    [ -n "$step" ] || continue
    case "$step" in
      "clone-submodule"*)
          name="${step#clone-submodule }"
          if [ ! -e "$SEAT/$name/.git" ]; then
              echo "ensure-seat: provision clone-submodule $name (offline, from the primary's checkout)"
              rm -rf "${SEAT:?}/$name"
              git clone --quiet "$PRIMARY/$name" "$SEAT/$name"
              # The harness repo GITIGNORES its vendored lib/ bytes (upstream's
              # own materialization step writes them; .gitignore:7 `lib/`) — a
              # fresh clone carries the tracked shell only. Overlay the
              # primary's working tree so the corpus carries everything the
              # transpile inlines (same trust model as every rsynced tree:
              # the primary is the one source).
              rsync -a --exclude .git "$PRIMARY/$name/" "$SEAT/$name/"
          fi
          ;;
      "sh "*)
          echo "ensure-seat: provision $step"
          (cd "$SEAT" && sh "${step#sh }" >/dev/null)
          ;;
      *)
          echo "ensure-seat: unknown provision step shape: $step" >&2
          exit 2
          ;;
    esac
done <<PROVISIONS
$(node -e '
    const m = require(process.argv[1]);
    for (const s of (m.provision ?? [])) console.log(s);
' "$MANIFEST")
PROVISIONS

if [ "$VERIFY" -eq 1 ]; then
    GOV="$(command -v gov || true)"
    [ -n "$GOV" ] || GOV="$HOME/.local/bin/gov"
    echo "ensure-seat: probing base gates (bundle-files, closures)"
    (cd "$SEAT" && "$GOV" run --gate bundle-files closures)
fi
echo "ensure-seat: DONE — $SEAT"
