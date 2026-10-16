# Agent Note: the gateway audit-completeness invariant leg

Status: implemented
Related: D5

## Problem

Contract `primitives.md` §6 makes per-call audit records mandatory and
host-fixed ("primitive name, caller identity, permission verdict, outcome
code — never payload contents"), and §7 #2 makes them a `gateway@1`
conformance requirement. The existing evidence is per-seam and
count-based: `run-socket-seam.sh` and `run-security-gateway-fuzz.sh` grep
fixed record counts for the socket plane only, and the iOS
`gateway-audit.json` manifest pins a hand-written subset. Nothing asserts
the actual invariant — that EVERY gateway call leaves exactly one paired,
ordered, payload-free record — so a primitive whose audit row goes missing
(a new face wired without its audit, a double-audit refactor, a payload
slipping into a record) lands silently on every seat at once.

## Decision

A three-file leg lands the invariant as machine assertions:

- `runtime/dsh/scenario/gateway-audit-invariant.js` drives every primitive
  of the frozen v1.x table through the states the CLI seat can reach —
  granted+ok roundtrips, one contract-§3 rejection per reachable row, and
  the honest `unavailable` rows — over the raw `__dshGatewayCall` seam,
  ledgering each call (cell, primitive, expected audit record name,
  state, observed code) as it settles: 48 calls plus the host-initiated
  `socket.accept`.
- `test/e2e/scenarios/gateway-audit-invariant.json` pins the ledger
  one-to-one in order (53 expectations) through the standard checker.
- `runtime/dsh/ci/run-gateway-audit-invariant.sh` runs the seat with a
  loopback mock (`--http`), then walks ledger vs audit stream and fails
  NAMED: any unpaired call (a §6 violation even when the call succeeds),
  any orphan record, any order violation, and any metadata violation
  (key allowlist over both audit-plane shapes, closed outcome/verdict
  vocabularies, a 320-byte record bound, and a payload-canary scan whose
  markers ride every payload-bearing argument).

The pairing gate's rejection classes are self-tested against fixtures
(clean → pass; order, orphan, leak, bad-key each named). The leg first ran
on the un-fixed host and the pairing gate named 44 unpaired calls — the
red output WAS the finding (the desktop embedder audited the socket seam
only). This change completes the invariant on the host side, and the leg
runs green: 49 calls, 49 paired records, zero orphans.

The host half (`example/main_cli.c`): the smoke backend now emits one
metadata-only `{"audit":"<name>","outcome":"<code>"}` record per gateway
call at its settle — the point where every call's outcome lands. The
socket listen/connect calls arm skip=1 (the seam's depth layer and the
serve-layer denial sites already emit their richer records; doubling them
would orphan), the fire-and-forget abort face emits its own accepted-record
inline (it never settles), and dispatch names are clamped to the audit
alphabet so attacker-controlled names never reach a record (an unspellable
name lands as `unknown.primitive` — an unaudited call is the violation, not
a leak). The three exact-count audit gates that grep the stream
(`run-socket-seam.sh`, `run-security-jail.sh`,
`run-security-gateway-fuzz.sh`) hold unchanged: their socket-plane counts
are untouched by the non-socket records, re-run green on the fixed host.
File names are distinct from the existing audit legs
(`gateway-audit.json` is the iOS manifest; the fuzz and socket-seam
runners keep their names).

## Alternatives considered

- Asserting the iOS `dsh.gateway.audit:` stream instead (it already emits
  per-call records): lost because it needs the simulator leg for every
  run and pins one host's records, not the contract invariant; the CLI
  seat runs everywhere CI does.
- Emitting the records from the scenario itself: vacuous — the test
  would verify its own wrapper (rule 6), not the host.
- Keeping the per-seam count gates and adding nothing: lost because they
  cannot see a missing record on any face they do not already count.
- Wiring the pairing gate into gates.json now: deferred — it would hold
  every tree red until the embedder gains per-call audit emission, which
  is this PR's finding, not its change.
