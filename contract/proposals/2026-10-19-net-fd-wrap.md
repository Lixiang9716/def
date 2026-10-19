# Proposal: the net fd-wrap face — Socket({fd}) for the dsh-subprocess control seam (v1.12.0 candidate)

> **Status: DRAFT (D5 proposal — nothing frozen, nothing implemented).**
> English | [简体中文](2026-10-19-net-fd-wrap.zh.md)

## Motivation

Issue #260 established that `node:net` **fd-wrap sockets** — `new
Socket({fd})` — are unserved, and that the dsh-subprocess family needs them:
its control seam opens on exactly that constructor. The gap was named by the
socket seam's own landing (PR #251) as a follow-up: fd adoption is "out of
the v1.8.0 grant class by design" — the seam grants doors the runtime opens
(`socketListen` / `socketConnect`), never a descriptor it already holds.
T-0264 tracks this proposal.

The consumer, verbatim (vendored `subprocess@0.1.6-alpha.2`,
`lib/control.js`): `openInheritedControlChannel()` consumes the launch
marker `DSH_SUBPROCESS_CONTROL` (:7, :16-18 — read, deleted, `"pipe"` or
throw) and returns `new Socket({ fd: 7, readable: true, writable: true,
allowHalfOpen: true })` (:19-24) — one extra full-duplex byte pipe inherited
on a reserved descriptor, not a stdio takeover. The package states its own
law (:9-13): "The returned stream owns the descriptor", "Call once before
executing untrusted code; messages remain untrusted even though the endpoint
was inherited". The other end is written against the plain `net.Socket`
duplex face, and more of it than the usual list: `ptc-runtime-node@0.1.6-alpha.2`
runs `runNodeMain(openInheritedControlChannel(), maxMessageBytes, …)`
(lib/process-entry.js:4, lib/process.js:1061) and drives a JSON-framed
channel over `stream.on("data")` (:224), `stream.on("error")` (io, :225,
:230-231), `stream.on("end")` (:226 — load-bearing: a read-EOF before the
program settles is itself the protocol failure "ended before the program
settled", io, :236-238), `stream.cork()` / `stream.write(header)` /
`stream.write(body, cb)` / `stream.uncork()` (:295-300), `stream.off(...)`
(:315-316), `stream.destroy()` (:317) and `stream.once("close")` (:1074) —
the frame cap rides the call, above the seam.

The host already carries the fd reality for both roles of that seam. As
**parent**, the v1.5.0-era subprocess seam's extras ARE duplex byte pipes:
`dsh_proc_fork_exec` builds one `socketpair(AF_UNIX, SOCK_STREAM)` per piped
extra, `dup2`s the child end to fd 3+i, and keeps the parent end
non-blocking in `dsh_proc.extra_r[5]` (src/dsh_runtime_host.c:1906-1914,
:1955, :2003-2008; the ptc control channel rides child fd 7 — :146). The
QuickJS parent side serves `child.stdio[7]` — "the operative consumer" — as
a duplex-lite over the `(pid, slot)` intrinsics (`wireExtraChannels`,
shims/node-child-process.js:176-210). As **child**, the CLI host — the C
host CLI (BUILD.md) — is itself just a process: launched by a
dsh-subprocess launcher with `stdio: { stdin: 4, stdout: 5, stderr: 6,
control: 7 }` (the vendored launcher's own request shape,
subprocess-local@0.1.6-alpha.2/lib/spawn-runner.js:240), descriptor 7 sits
in its descriptor table — and today's `node:net` face refuses it with an
honest throw whose wording claims a "named non-goal" the v1.8.0 record does
not carry (shims/node-socket-tcp.js:455-464; the seam's actual named
non-goals are remote scopes, TLS, UDS/multicast and background listening —
2026-09-28-socket-seam.md:95-103 — and primitives.md's seam section carries
no fd language at all).

So the boundary is real but was never named. This proposal names it and
serves the need narrowly: **adopt-an-existing-channel becomes one gateway
primitive that mints the socket seam's own `connectionId`** for a channel
the runtime family created (as parent) or inherited at birth (as child).
Nothing else about `Socket({fd})` changes.

## The primitive (one, additive)

Additive per the §8 minor rule: a `gateway@1` host without the face answers
`unavailable` per call, and negotiation keeps every current floor.

### `procChannel` — adopt one existing subprocess channel

```ts
export type ProcChannelRequest =
  | { source: "spawn"; pid: number; slot: number }  // parent leg: slot 0..4 ↔ child fds 3..7
  | { source: "inherited"; fd: number };            // child leg: the armed control fd (v0: 7)
export declare function procChannel(
  request: ProcChannelRequest,
): Promise<{ connectionId: string }>;
```

Resolves with an id in the socket seam's own `connectionId` namespace:
`data` / `close` / `error` ride the `socket` channel (§5) keyed by that
`connectionId` — an adopted id has no `serverId` and never emits
`connection.accepted` (the fold adds this sentence to §5's row prose).
Writes go through `connection.write`, half-close through
`connection.end()` — `shutdown(SHUT_WR)`, the exact face `__dshProcEndFd`
already serves (src/dsh_runtime_host.c:2541-2553). Read-EOF is not a §5
event kind and stays one: the shim synthesizes node's `end` from the pump's
EOF indication — the socket shim's existing mechanism (`res.eof` → `emit('end')`,
close only once BOTH halves finish, node-socket-tcp.js:217-222, :284-288;
`extraEof` is the same shape on the proc side) — so the vendored channel's
`end` semantics and `allowHalfOpen` hold without extending the frozen §5
payload vocabulary. No new permission flag, never a `null` resolution (§3
reserves that for the user refusing a prompted grant; there is no prompt
here to refuse).

**Where the channel comes from — two legs.** The *parent leg* adopts one
extra channel of THIS runtime's own live child: `(pid, slot)`, slot 0..4 ↔
child fds 3..7 (the C table's own lookup, :153; anything else is `invalid` —
you cannot adopt another runtime's child). The *child leg* adopts exactly
ONE descriptor: the armed control fd — the descriptor the dsh-subprocess
convention names, `SUBPROCESS_CONTROL_FD` = 7 (control.js:5) — not the
whole reserved window. The rest of [3, 8) is launch-shaped, not
channel-shaped: the direct launch pads fds 3-6 with `'ignore'` (/dev/null —
live descriptors whose adoption would mint a phantom channel: reads EOF,
writes vanish) and the runner shape keeps fd 3 for `'ipc'`
(runner-launch.js:110-116, :118-128). An fd that is not the armed
descriptor is `invalid`, the reason naming the law.

**The marker arms; it does not delete.** At boot, before any untrusted
code, the host reads `DSH_SUBPROCESS_CONTROL` from its environment and,
when it is `"pipe"`, arms the control descriptor — host-side state,
recorded once. The runtime NEVER rewrites the environment: control.js's own
consume-order (:16-18 read, delete, verify) then runs verbatim inside
QuickJS — deleting at boot would make its `marker !== "pipe"` check throw
and kill the acceptance path itself. The arm depends only on the boot-time
value, so whatever the vendored code later does to its env face is
irrelevant; and the marker string carries no power — knowing `"pipe"`
grants nothing, because the arm is host state, not the env var.

**Ownership moves; it is never shared, and never twice.** Adoption is a
MOVE: on resolve the descriptor's single owner is the channel, and the proc
poll stops draining the adopted slot (two readers on one socketpair end
would split the byte stream). Destroy or peer close closes the descriptor
exactly once — "the returned stream owns the descriptor" is control.js's
own sentence and becomes this contract's. Adoption is once per channel for
the process's lifetime: a second adopt of an adopted channel is `invalid`,
and so is an adopt of a spent one — after close the arm does not re-arm and
the fd number proves nothing (the W8 hazard: a reused number names whatever
the table now holds). The proc slot's release condition (reaped and every
stream settled, :2164-2177) counts an adopted slot as settled only once its
channel has closed; a hard write error closes the channel and surfaces
`error` + `close`, never silent revival (the :2526 rule, carried over). The
adopted channel occupies one entry in the socket seam's connection table —
that cap's discipline, not the proc table's 64 slots (:142).

**No scope axis.** The v1.8.0 five-rule model grades doors by direction and
peer (primitives.md:515-531); an inherited socketpair has neither — no dial
was made, no door opened, the endpoints were fixed before the runtime
started. `procChannel` therefore takes no scope and needs no socket grant.

**The contract row: no permission flag, one ownership check.** The spawn
face carries no contract gate today — it is a host intrinsic below the
frozen table (the vendored adapter declares
`capabilities: { required: [], optional: [] }`), so there is no gate here to
"reuse", and honesty beats the fiction: the fold's §2 row names permission
flag `—` (the `deviceInfo` precedent) for that reason, streams: no. The
enforcement is structural instead:

- the **parent leg** grants no power the caller's own spawn did not create.
  The host records, per pid, the caller identity that drove the spawn, and
  only that caller may adopt its channels — anyone else is `denied` (plugin
  A cannot mint a socket face onto plugin B's child);
- the **child leg**'s descriptor predates the runtime — no manifest of ours
  ever existed to gate it; what this contract adds is the arm discipline,
  the once-only law and the audit, not a gate that would be theater.

If the subprocess family ever gains a contract flag, the parent leg rides
it additively (§8). On hosts that cannot be a launched child (no app
process is ever handed a control descriptor at exec) the child leg answers
`unavailable` — capability negotiation, not a platform branch (the RFC 0002
anti-pattern rule).

**Errors**, §3's vocabulary: `invalid` for a slot out of range, a pid that
is not this runtime's live child, an fd that is not the armed descriptor, a
missing marker, a second adopt of an adopted — or an adopt of a spent —
channel; `denied` on the parent leg for a caller other than the spawning
one; `io` when the descriptor is dead on arrival (control.js's own
"@throws when the inherited descriptor cannot be opened"); `unavailable`
per the additive rule. Audit per §6: one record at adopt (caller, verdict,
source leg, `(pid, slot | fd)`, outcome) and one at close, which finalizes
the channel's cumulative traffic byte counts — a long-lived channel's bytes
are not per-call facts. Never payload bytes.

**Messages stay untrusted.** The channel carries bytes; framing, size caps
and authentication stay the protocol's business above the seam.
control.js's "messages remain untrusted even though the endpoint was
inherited" is quoted into this contract, not softened by it.

## Implementation strategy: one C spine, two legs

| Leg | Served where | The C-side move |
|---|---|---|
| `inherited` ({fd}) | CLI host only — a process a dsh-subprocess launcher can launch | peek-and-arm at boot (the environment is never rewritten); on adopt, move the armed descriptor into the socket seam's pump table and mint `conn:N` |
| `spawn` ((pid, slot)) | hosts with a live spawn face — the C proc spine compiles on all four (:140-141), but a runtime with no live child has nothing to adopt and answers per-call `unavailable` | move `extra_r[slot]` into the socket seam's table, mark the slot adopted, mint `conn:N` |

The JS shim resolves the vendored constructor literally: with the window
armed, `new Socket({ fd: 7, readable: true, writable: true, allowHalfOpen:
true })` resolves through the child leg and returns a socket-seam-backed
duplex carrying the face the JsonChannel actually drives — `data`,
`write(+callback)`, `off`, `destroy`, `once("close")`, `error`, `end`, and
`cork`/`uncork` (the seam duplex already answers `cork`/`uncork` — today as
no-ops, node-socket-tcp.js:171-172; real batching is shim-side buffering,
no gateway surface). `allowHalfOpen` maps onto the seam's half-close; the
peer's close arrives with trailing bytes delivered, the socket seam's own
rule. The honest throw remains for everything else, reworded to point at
the served face instead of claiming a non-goal that was never named — and
the six committed shim copies (two files × three bundles:
`node-socket-tcp.js` and `npm-bridges-c.js` × runtime/android/harmony) sync
with the fold.

## What v0 deliberately excludes (named non-goals)

- **Arbitrary-descriptor adoption** (the full node `Socket({fd})`
  semantics): stdio, files, listeners, the launch shape's own padding (the
  `'ignore'` fds 3-6, the runner's `'ipc'` fd 3), foreign descriptors —
  still refused. The [3, 8) window stays the subprocess seam's frozen
  geometry (the W8 law: pre-exec close never touches it —
  src/dsh_runtime_host.c:1965-1971), and the child leg adopts exactly the
  ONE armed descriptor inside it (v0: 7), never its neighbors — a raw
  descriptor number in this runtime names nothing stable (W8: raw fd 7
  killed slot 4's just-dup'd end and the control channel arrived dead).
- **No framing protocol**: bytes only — JsonChannel's JSON frames and
  `maxMessageBytes` stay in the consumer, exactly as TLS stays out of the
  socket seam.
- **Not a stdio takeover**: stdin/stdout/stderr faces stay where the
  v1.5.0-era subprocess seam put them; the control channel is the extra
  duplex pipe, nothing else.
- **No change to the shipped parent-side faces**: `wireExtraChannels`'
  duplex-lite remains the parent face until a consumer needs a real
  `net.Socket` there; the parent leg exists so both ends of one seam ride
  one contract row.
- **No prompt, no persistence**: there is no grant to remember; the channel
  lives and dies with its process relationship (the seam's session-scoped
  posture).

## Alternatives considered

- **Keep the duplex-lite, stay excluded (status quo)**: rejected — the
  exclusion was never named (the throw's "named non-goal" wording has no
  carrier in the v1.8.0 record), the family's child role is unrunnable in
  QuickJS, and every consumer quirk grows the duplex-lite ad hoc (the
  `closed` getter, node-child-process.js:189-192, exists for one disposal
  assertion).
- **Raw-fd adoption everywhere (full node semantics)**: rejected outright —
  a descriptor number bypasses grant, audit and direction-grading
  wholesale, the exact hole the host-held-fd-behind-an-audited-id model
  exists to keep shut (dsh_socket.h's `srv:N`/`conn:N` ids; the seam's five
  rules); and the number itself is treacherous (W8, above).
- **Extend the spawn intrinsics only, no contract row**: rejected — D5 is
  contract-first: the face crosses the gateway (JS asks the host for a
  governed stream and receives an audited id), which makes it a primitive;
  an un-governed intrinsic is what the gateway refuses.
- **Two primitives, one per leg**: rejected for v0 — one `source`-
  discriminated request keeps the table narrow (§8's restraint rule) while
  both legs mint the same id; splitting later is additive, merging later is
  not.

## Verification plan

- The issue's acceptance, verbatim: on the CLI host, `new Socket({ fd: 7,
  readable: true, writable: true, allowHalfOpen: true })` under the armed
  launch marker constructs a working duplex stream, and the dsh-subprocess
  control path that wants it (control.js's `openInheritedControlChannel` →
  JsonChannel round-trip, cork/uncork and `end` included) runs green —
  control.js's own marker check (:16-18) passing verbatim is part of the
  test, which is why the runtime arms without deleting.
- The child leg's refusals are tested, not prose: an fd that is not the
  armed descriptor (the launch shape's `'ignore'`-padded 3-6, the runner's
  `'ipc'` 3 — runner-launch.js:110-128), a second adopt, and an adopt after
  close are all `invalid`.
- The geometry regression: the pre-exec close discipline — never touch
  [3, 8) — carries a named test whose rejection case IS the W8 incident
  (a raw fd 7 killing slot 4's channel).
- The parent leg round-trips a payload against the vendored child,
  byte-identical to the duplex-lite path, and refuses a foreign caller with
  `denied`.
- Negotiation floors: hosts without the face answer `unavailable` per call;
  the child leg answers `unavailable` where the host cannot be a launched
  child; no current behavior changes.

## Version

v1.12.0 candidate (additive: one primitive; no new event channel — the
socket seam's own carries the traffic; no new permission flag). The last
frozen minor is v1.11.0 (durable-fs, 2026-10-19); the in-flight drafts carry
stale candidate numbers the folds took (forkpty v1.9.0,
system-capability-plane v1.10.0 — "monotonic fold ordering wins",
primitives.md v1.9.0 note), so v1.12.0 is the next free additive number;
the fold renumbers per the next-free rule at adoption.
