# Agent Note: The dsh-shell-js parser closure joins the pinned vendor round (33 npm faces, flat-layout seam)

Status: implemented
Related: D6

## Problem

The dsh-shell-js system plugin shipped with its third-party bytes staged
inside the plugin directory (`system-plugins/dsh-shell-js/vendor/`, five
trees + a VENDOR.md pin record). That staging was deliberately invisible to
`ensure`/`closures`: no pin row in `NPM_PACKAGES`, no stamp, no embed list —
so CI could not materialize it, the syntax-class checker had to be kept away
from upstream bytes by path conventions alone, and the trees would silently
diverge from anything a fresh fetch produces (the vendor-package skill's
first trap). Device builds had no path to these bytes at all: no host embed
list carried them, so the plugin could never ship. The transitional window
was accepted only on the promise that the formal vendor round would replace
it — this note records that round.

## Decision

The closure is now pinned and embedded the standard way. 33 packages —
bash-parser@0.5.0 (exact pin; unmaintained since 2017), its full 28-package
transitive dependency closure, shelljs@0.10.0, and the minimatch@10.0.3
ISC-ceiling chain — are mirrored as tarballs under
`runtime/dsh/vendor/dsh-tarballs/` and pinned by sha256 in `NPM_PACKAGES`
(`runtime/dsh/vendor/ensure-dsh.sh`), with the license notes on record in
the comment block above the pin table (shelljs is BSD-3-Clause carrying the
wrench-js MIT notice verbatim at src/cp.js:90-96 and src/rm.js:12-19;
curry@1.2.0 and filter-iterator@0.0.1 ship no license field and are recorded
as UNKNOWN, not assumed MIT; minimatch stays at 10.0.3 because 10.1.0+
relicenses BlueOak-1.0.0).

parser.js's CJS vendor seam swapped to the repo's flat layout: the
name→tree map grew 5 → 33 rows, `VENDOR_PREFIX` widened from the plugin's
own `vendor/` subtree to the repo vendor root (two lexical `..` hops from
the plugin dir in BOTH path spaces — bundle-relative `vendor/` on device,
the real `runtime/dsh/vendor/` under Node), and the nested-`node_modules`
walk-up branch is retired: the trees are flat, so a bare name outside the
map fails loud. The plugin's staging `vendor/` + VENDOR.md are deleted in
the same change; the pin-record duty moved into the ensure-dsh.sh comment
block. Embed rows landed on all three hosts: iOS TREES (30 whole-tree rows
+ the minimatch chain's domino double-rows), harmony CLOSURE +
Index.ets BUNDLE_FILES (the same 175-row set both directions), and android
stage blocks each with a `--check` verify twin — drift injection on a
tracked staged file was tested red on both byte-check legs before trusting
the green. The plugin's own five sources land in the same change (the
harmony CLOSURE rows reference them; android's whole-dir mirror stages
them). Two commits, per the closures ordering: runtime closure + rows
first, regenerated embeds second.

## Alternatives considered

- Keeping the in-plugin staging and extending VENDOR.md — rejected: a tree
  without a pin+stamp is invisible to ensure, cannot be materialized in CI,
  and can never reach a device embed list; the divergence risk grows every
  round it survives (the skill's trap list; DECISION §5.3's own transition
  clause promised exactly this replacement).
- Pruning babylon from the closure (60% of the weight, serves only the
  refused `$((…))` arm) — rejected: bash-parser's
  arithmetic-expansion.js:5 requires it at module load, so pruning means
  editing upstream bytes, which breaks D6 and the pristine-repin property;
  the accepted-cost decision stands (DECISION §1).
- Resolving bare names by walking nested `node_modules` inside the vendor
  root — the transitional design — rejected now that the layout is flat:
  the walk-up branch silently depends on directory shape, while the map
  makes every bare name a grep-able pin and a missing row a loud
  resolution error at the exact place a re-pin would touch.

## Consequences

The closure embeds grew ~0.7MB per host (babylon rides unconditionally);
the iOS generated bundle is 1558 files / ~12.1MB and regenerates
byte-identically from a cold clone (verified). A future minimatch bump past
10.0.3 is a license-policy decision, not a re-pin. curry/filter-iterator
license gaps are on record; filing an upstream issue with bash-parser to
confirm intended licensing is open follow-up (the package has been
unmaintained since 2017 — exact-pin forever).
