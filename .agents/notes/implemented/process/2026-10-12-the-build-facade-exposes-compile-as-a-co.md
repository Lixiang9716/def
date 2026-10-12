# Agent Note: the build facade exposes compile as a command

Status: implemented
Related: D17

## Problem

The facade's three stages (sync / compile / test, build/build.sh:7-11) were
not equally invocable: `sync` and `test` existed as commands, `compile` did
not — it was reachable only through the full `build`, which appends the
platform's whole e2e suite. A caller that wanted exactly one thing — the
toolchain leg, no closure re-stage, no e2e legs (this session's ask:
`build/build.sh compile core` for the C host CLI) — had no expression for
it. The asymmetry had no recorded rationale: no decision, note, or
alternative-considered entry ever chose to withhold `compile`; the verb was
simply absent from the arg parser (build/build.sh case arm), so the facade
answered a reasonable invocation with `unknown platform or flag 'compile'`.
Meanwhile the facade's own header comment and BUILD.md's CI-mapping table
already describe `compile` as one of the three stages — the docs promised a
surface the CLI did not ship.

## Decision

`build/build.sh` accepts `compile` as a command: `[build|compile|test|check|sync]`
× platform(s). `compile <platform>` runs `stage_compile` for each named
platform and nothing else — the exact command the matching dev/<platform> CI
workflow runs (for core: `runtime/dsh/host/build.sh`, plus `--release` flavor
with the flag). `--release` now composes with a stage-only command, which it
previously could not do without also running the e2e legs. Discovery surface
moved in the same change: the script's usage comment, example block, and both
`unknown`-token usage strings; BUILD.md + BUILD.zh.md (grammar line + an
examples row, pairing re-confirmed); the ARCHITECTURE.md/.zh.md layout-tree
comment; and AGENTS.md's build-entry line. D17's decision row and the
2026-09-23 facade note are left untouched — they record what was decided
when; this note is the amendment.

## Alternatives considered

- No code change — declare the invocation invalid and point at
  `build/build.sh build core`: loses. It leaves the named command failing,
  and `build core` is not equivalent — it runs the ten CLI e2e legs after
  the compile, so "just compile" stays inexpressible and the documented
  three-stage model keeps lying about the surface.
- Fold compile into `test`/`build` flags (e.g. `build --skip-test`): loses —
  a negation flag re-creates the asymmetry it hides, and `--skip-*` flags
  contradict the facade's fail-loud posture (rule 5) by making "the check
  did not run" a first-class success state.
- A separate script (build/compile.sh): loses — D17's whole point is ONE
  entry; a second script re-fragments the discovery surface the facade
  consolidated.
