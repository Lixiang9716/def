# Agent Note: AOCI harmony build strays: scoped exclude rule, not exclude_dirs[build]

Status: implemented

## Problem

Through rc18 AOCI hard-excluded directory names that can denote build output
(`build`, `dist`, `cache`, ...) against every path component. rc19 (#100) moved
that responsibility to `exclude_dirs` in `.aoci/config.json` so tracked source
under such a name would no longer be silently dropped. This repository's
`exclude_dirs` list (untouched since the #362 init) never carried `build` —
harmless while the built-in rule covered it, load-bearing the moment rc20
scanned a materialized hvigor tree: `hosts/harmony/entry/build/` holds byte
copies of the committed officialweb rawfile assets, and the builtin observe
rules (`**/fonts/**`, `**/*.map`) captured 59 KaTeX font files plus 4 source
maps. The copies entered observe fingerprints with
`observe_change_policy: review_required`, parked the scope stage at
`observed_evidence_review_required` (63 items pending), and every rc21-era
authoring session would have to sweep this hygiene before reaching the
authoring batch loop.

## Decision

One project-owned Managed Scope rule, `harmony-entry-build-exclude` — action
`exclude`, glob `hosts/harmony/entry/build/**` — added through
`aoci scope rule add` and applied through `aoci scope activate` (transaction
`2b320bfeb812523bbd1f9adf`, authorization `policy_bound_auto`). The rule
evaluates at priority 500 and outranks the builtin observe rules (100s): the
KaTeX and source-map probes classify `exclude` with `observe fingerprint
false`, while the indexed sources `build/build.sh` and `build/check-closures.sh`
stay `index`. The 63 strays left the observe set without an acknowledge pass
(`observed_pending_review` 63 → 0, observe_count 164 → 101); the scope stage
now reads `authoring_required`, which is the state rc21 authoring sessions
enter directly. Index Entries remain 1339 with no new orphans (the #117
byte-identical trio is unchanged); the machine repainted `.aoci/baseline.json`
and appended the rule to `.aoci/config.json`, both landing in this PR.

## Alternatives considered

`exclude_dirs` += `"build"` — the door the rc19 changelog names for exactly
this regression — lost: exclude_dirs matches every path component (the same
mechanism that excludes `runtime/dsh/vendor/` via the `vendor` entry), so it
would flip the tracked, indexed sources under the repository-root `build/`
directory to excluded and orphan their entries — precisely the silent-drop
class rc19 #100 removed — and would blind any future source directory named
`build`. Acknowledge-only, following the KaTeX canonical-path precedent (fonts
stay observe-not-indexed in `**/fonts/**`), lost as the sole measure: the
fingerprints re-float on every hvigor build, so review fatigue returns each
rebuild; the precedent still holds where it belongs — canonical vendored
assets stay observed, generated copies get excluded. Hand-deleting the 63
observe fingerprints from `.aoci/` state lost: those are machine-owned bytes,
zero-hand-edit by the AOCI rule.

## Consequences

The rule is scoped to the incident site. The other generated trees
(`runtime/dsh/build/`, `hosts/android/app/build/`, `build/cmake-*/`) are quiet
today — git-ignored with no observe-rule matches — and stay unruled; if a
future toolchain emits fonts or maps there, they float the same way and earn a
sibling rule, or the owner revisits the `exclude_dirs`-level policy with full
knowledge of the `build/` source collision. The `#117` orphan trio remains
blocked upstream and documented in the 2026-10-12 orphan-sweep note.
