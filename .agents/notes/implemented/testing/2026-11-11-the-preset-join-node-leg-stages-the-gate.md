# Agent Note: the preset-join node leg stages the gateway seam and a project-root marker

Status: implemented

## Problem

The fs seam collapse (see the architecture note "The fs seam collapse: the dsh-fs cordis
face becomes the product `ctx.fs` provider", same seat) turned the preset-join node leg
(`run-session-preset-join-node.sh` → `test/upstream-suite/session-preset-join.mjs`) red in
two stacked ways, both invisible until the leg actually ran a turn:

1. The product boot's `ctx.fs` now serves over the gateway fs primitives, which on the C
   host means `__dshGatewayCall`. The node driver never staged that seam: the old
   fs-local-over-VFS world answered every `ctx.fs` question in-process, so the driver
   (and its `session-preset-join-gateway-node.mjs` adapter, whose charter is exactly the
   C-host seams) never needed it. After the collapse the first turn died with
   `globalThis.__dshGatewayCall is not a function` — the timer shim's arm warn and
   `dsh.turn-recovery`'s "turn failed" line were the only traces; no request reached the
   wire.
2. With the gateway staged, the joined composition's instruction row
   (`@deepseek-ai/dsh-agent-instructions`, mounted by the mobile preset the seat joins)
   walks parents from the session cwd hunting a project-root marker (`.git`) through
   `ctx.fs`. Its documented contract (`existsAsMarker` in the vendored lib) climbs on
   missing-path answers but re-throws any other provider error — and the provider refuses
   paths outside the workspace with `FS_SANDBOX_DENIED` (the collapse's declared
   containment posture). A bare `mkdtemp` workspace has no marker inside the scope, so the
   walk escaped and killed the turn.

## Decision

`test/upstream-suite/session-preset-join.mjs` + `session-preset-join-gateway-node.mjs`
stage the two environment facts the C host provides for free:

- `installGatewaySeams(scopeRoot)` in the gateway-node adapter installs
  `globalThis.__dshGatewayCall` Node-side (the `test/panel/spine/spine-seams.mjs`
  precedent): `timerSchedule`/`timerCancel` over REAL node timers (imported from
  `node:timers` — arming through the ambient global would recurse into the timers shim's
  own gateway-backed `setTimeout`), fires riding the §5 channel, unref'd so the seam never
  holds the driver's event loop open; plus the fs family (`fsRead`/`fsWrite`/`fsStat`/
  `fsList`/`fsMkdir`/`fsRemove`/`fsRename`/`fsPublishAtomic`/`fsSync`) over real node fs
  under the granted scope root, with the contract's §3-§4 shapes (missing path rejects
  `io` naming the path, escapes reject `invalid`, listings sorted by name, publish is the
  one-step same-dir temp→rename). Unstaged primitives fail loud (`unimplemented`).
- The workspace `WS` is now a real `mkdtemp` dir (the `/p5probe` label was only ever the
  retired VFS's spelling), and a `.git` directory is staged inside it: on every real seat
  the granted workspace IS a project root, so the marker settles the instruction walk at
  the workspace root — the honest environment shape, not a widened boundary. The driver's
  E2E-by-logs assertions (A/B/C: composedPreset, the wired persona, the preset-only tool
  rows, the negative control, the join debug line) are byte-identical — the gate failure
  was the environment, not the verdict.

## Alternatives considered

- Soften the provider so escapes answer absence-shaped instead of `FS_SANDBOX_DENIED` —
  rejected: the refusal is the collapse's declared containment posture, asserted by
  `scenario/tool-fs-probe.js` ("outside-write names the boundary"), and a stat that
  answers "denied" for model-driven tool paths is the product behavior worth keeping; a
  bare workspace was the leg's fiction, not the seat's truth.
- Keep fs-local for this node leg (the parity/suite-leg carve-out) — rejected: this leg
  boots the PRODUCT spine on purpose (the preset-join proof needs the real boot the
  harmony seats run); swapping its fs backend would assert a seat the product no longer
  mounts.
- Hard-code the walk's cwd to a fake root with a marker above the workspace — rejected:
  same fiction with more moving parts; the marker inside the granted root is one
  `mkdirSync` line.
