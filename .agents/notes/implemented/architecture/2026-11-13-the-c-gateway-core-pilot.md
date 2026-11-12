# Agent Note: the C gateway core pilot — the timer family dispatches through src/dsh_gateway_core.c on the CLI

Status: implemented
Related: D5 (contract first), D2 (one serial runtime thread)

## Problem

The gateway's trust-root logic — which primitive serves a call, which
permission flag gates it, what the §6 audit record says, and how a call
settles — is hand-maintained three times over, once per product host:
GatewayCore.swift (iOS), GatewayCore.kt (Android), and HostPhase.ets +
gateway_smoke.cpp (harmony). The capability-bus machinery (#773) already
derives every host's DESCRIPTOR from one source table
(tools/generated/capability-registry.json), but the RUNTIME dispatch is
still 3×: each new capability row means three hand-written handler
registrations, three permission-check sites, three audit-emit sites, and
three chances for the per-host copies of the same security decision to
drift. The duplicated logic is exactly the part the contract calls
host-fixed and mandatory (primitives.md §6: audit is mandatory and
host-fixed; §3: the rejection vocabulary is closed) — drift there is not
a bug, it is a conformance break, and the E2E pairing gate can only
catch it per host after the fact.

## Decision

A C gateway core pilot: `src/dsh_gateway_core.c/h` — the same layer the
shared C spine already proves. It owns, for the rows registered into it:

- the dispatch table: one `dsh_gateway_row` per primitive, carrying the
  capability-registry.json schema (name → handler fn ptr +
  permissionFlag + auditClass + schemaVersion), populated by the host
  shell at boot — the table IS the registry-derived data, not a second
  hand-maintained copy of it;
- the dispatch function: permission check (the row's flag against the
  host-declared grant set) → handler call → §6 audit record emission →
  settle, in that fixed order;
- the audit emission: the metadata-only §6 record, through a
  host-settable sink with a stderr default — the exact design
  dsh_socket.c already ships (its `g_audit`/`dsh_socket_audit_set`
  plumbing), whose whole security policy has lived in C since v1.8.0
  under the jail/fuzz/ASan batteries. On the CLI seat the record is the
  two-key audit-plane line the E2E pairing gate reads here
  (`{"audit":"<name>","outcome":"<code>"}`), emitted byte-identical to
  the pre-pilot stream; the platform hosts carry the same §6
  metadata-only policy on their own richer per-call records
  (ts/primitive/caller/verdict/outcome — the union both shapes make is
  the pairing gate's key allowlist).

The pilot family is the timer pair (timerSchedule/timerCancel): the
simplest audited pair on this seat, and the C-facing ABI is already
proven on harmony where TimerPrimitive.ets delegates to the gateway's C
face. The CLI host (example/main_cli.c) now dispatches
timerSchedule/timerCancel through the core instead of its hand-written
if-chain branches — the desktop proof face. The pilot scope is honest:
this is ONE family on ONE host, not a rewrite. What stays in the
platform languages is the irreducible rest — the OS calls themselves
(CoreBluetooth/SecItem/HUKS/URLSession, the 30-40% that cannot move),
the consent UI, and lifecycle. The follow-up this pilot earns is the
three-host rollout (Swift via Bridge.h where C symbols are already
exposed, Kotlin via the dsh_jni_binding.c JNI pattern, ArkTS via the
napi_init.cpp NAPI pattern), then the fs-core family
(fsRead/fsWrite/fsScope) whose dsh_fs_port.c precedent shows portability
across Darwin/Android/OHOS/Linux.

Security posture: C removes ARC/GC from the trust root. The mitigations
are structural — the core is a small table-driven design (one struct, a
fixed dispatch order, no parser of its own beyond a bounded integer
scan), the same surface the jail/fuzz/ASan batteries already attack, and
the audit sink never receives payload bytes (metadata-only, closed
vocabulary, the §6 rule). The permission check lands BEFORE the handler
runs, so an ungranted call can never reach host code — the property the
three hand-maintained copies each had to get right alone now has one
owner.

## Alternatives considered

- Rust for the gateway core: memory-safe by construction, the paper-best
  choice for trust-root code — but it adds a second systems toolchain to
  every host build (and the OHOS NAPI story would be a third binding
  layer), while the C spine's surface is already compiled, audited, and
  sanitizer-battered on all four platforms. The toolchain cost is paid
  now, the safety difference is on a surface the batteries already
  cover; rejected for this pilot, revisitable if the core grows
  parser-shaped logic.
- KMP (Kotlin Multiplatform) as the one dispatch implementation: no OHOS
  target — the third host would still hand-maintain its copy, so the 3×
  becomes 2× plus a cross-compile; rejected.
- Status quo (keep the three hand-maintained dispatches): the trust root
  stays in memory-safe languages, which is genuinely safer per copy —
  but the 3× cost is real and paid per capability row forever, and the
  drift risk across three security-critical copies grows with every
  row. The registry already collapsed the descriptor half; leaving the
  runtime half 3× keeps the worst duplication exactly where the
  contract demands uniformity. Rejected once a proven C-hosting pattern
  exists (dsh_socket.c since v1.8.0).
