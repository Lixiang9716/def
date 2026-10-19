# Agent Note: the android dsh-appshell assets re-staged to the pins

Status: implemented
Related: D6/D9 (canonical closure, staged host copies), the closures gate,
#301 gate-greening round (2026-10-19)

## Problem

`build/build.sh sync android` on a freshly materialized worktree re-staged
`hosts/android/app/src/main/assets/dsh/system-plugins/dsh-appshell/index.js`
and `.../lib/catalog.js` to bytes DIFFERENT from HEAD: the pinned dsh
closure (local tarballs, sha256-verified by `external/ensure-dsh.sh`) carries
`p('image', { emoji, color })` template rows (banner-card hcard-row,
mini-player) where HEAD's committed assets hold the older
`p('text', { text: emoji })` generation. The staging script's byte-identity
proof — "staged + verified byte-identical to the runtime pins" — fails on
the committed assets: main's committed android staging is behind its own
pins. The drift is invisible to `git status` on the primary seat because
the vendor closure is untracked there; it surfaced the moment the matrix
worktree materialized its closure (2026-10-19) and the proof could finally
compare bytes.

## Decision

The landing carries the two re-staged asset files (the pin-mandated bytes).
The closures/staging gates require committed bytes == pin bytes; these files
are that requirement, healed.

## Alternatives considered

- Reverting the assets to HEAD: leaves the byte-identity proof red on every
  materialized tree, including CI's — the gate doing exactly its job.
- Re-pinning the dsh closure back to the older generation: lost — the pin
  is the reviewed upstream generation; the staged assets trail it, not the
  other way around.
