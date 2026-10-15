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
(clean → pass; order, orphan, leak, bad-key each named). On today's CLI
seat the leg runs green through the JS gate (53/53) and the pairing gate
fails naming 44 unpaired calls: the desktop embedder audits the socket
seam only, so the 30 non-socket primitives carry no §6 records — the red
output IS the finding, and the leg flips green the day the host audits
every call. File names are distinct from the existing audit legs
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
