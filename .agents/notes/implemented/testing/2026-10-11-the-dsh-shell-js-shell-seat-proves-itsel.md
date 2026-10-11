# Agent Note: The dsh-shell-js shell seat proves itself by log on the CLI carrier (run-dsh-shell-js-e2e.sh)

Status: implemented
Related: D6

## Problem

The 2026-10-11 seat switch gave dsh-shell-js the one `shell` tool seat and
booted it on every host, but its only machine proof was unit-level: the
panel suites drive the executor directly through a gateway shim, so nothing
asserted the seat's SESSION behavior — the `shell` tool dispatched through
the REAL ToolRuntime on a booted mobile profile, the outputs landing in the
gateway fs scope, and the refusal vocabulary (exit 2 naming the construct,
exit 2 naming the missing primitive + the D5 path, exit 127 naming the
applet list) surfacing in-band to a tool caller. A regression that only
shows up across the boot boundary — a wrong workdir pin, a declined
capability grant, a refusal that throws instead of returning — would keep
every panel suite green.

## Decision

A CLI-carrier e2e leg in the house pattern (the open-design leg's shape):
`runtime/dsh/ci/run-dsh-shell-js-e2e.sh` boots the mobile profile with the
vendored spine exactly as upstream.session does, then drives NINE command
lines through `ctx.tools.execute({ name: 'shell' })` — no test double on
the dispatch path:

- quotes + variables: a prefix assignment seeding the table, double quotes
  folding over `$VAR`/`${VAR}` expansion, single quotes staying literal;
- redirects: `>` create and `>>` append, round-tripped BOTH through the
  shell (`cat notes.txt`) AND out-of-band through the gateway itself
  (`fsRead` — the `shell/persisted` event, so persistence is proven against
  the scope, not shell-private memory);
- pipelines: three members (`cat | sort | head -n 1`) over the 64KB-window
  pipes;
- by-name refusals, one per exit-code family: command substitution `$(…)`
  (exit 2, construct named), `chmod` (exit 2, the missing permission
  primitive + the contract-proposal path named), an unknown program (exit
  127, the applet list named).

Each command emits exactly one `shell/call` → one `shell/stdout` or
`shell/refused` → one `shell/exit`; the driver demands exact stdout and
refusal needles BEFORE emitting, and `test/e2e/scenarios/dsh-shell-js.json`
matches the 35 records one-to-one in order (scenario-id `dsh-shell-js`,
unique in test/e2e/scenarios/). The checker's negative control was run by
hand on this tree: a one-byte stdout drift and a dropped refusal record
each fail the verdict loud (exit 1, first-mismatch diagnosis). The leg is
wired into `build/build.sh` test core after run-open-design-e2e.sh;
artifacts land in `runtime/dsh/artifacts/macos-cli-dsh-shell-js/`. The
scenario rides the iOS `scenario=` whole-dir embed by existing; it joins no
android/harmony staging list — CLI-only legs are not device-staged (the
open-design precedent).

## Alternatives considered

- Extending the panel suites (drive the shell tool through a shimmed
  ToolRuntime) — rejected: a shimmed runtime re-creates the gap, the boot
  boundary is exactly the untested surface; the house e2e contract is
  log-verified runs, not more unit scope.
- Driving the shell through an agent turn (mock LLM emitting tool calls) —
  rejected: it would pin the LLM loop's plumbing on top of the shell
  semantics and make refusals depend on prompt/model noise; the direct
  ToolRuntime dispatch isolates the seat's own contract.
- Pinning the full stderr texts in the manifest — rejected: the refusal
  wordings are living UX; the driver demands the load-bearing needles
  (construct name, primitive name, D5 path, applet list) and the manifest
  pins the compact `{exitCode, missing}` shape, so wording polish cannot
  flicker the leg while a semantic loss still fails it.
