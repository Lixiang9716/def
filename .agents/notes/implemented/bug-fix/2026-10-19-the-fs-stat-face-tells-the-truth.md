# Agent Note: the fs stat face tells the truth — kind fidelity and outside-root metadata visibility (issue #259)

Status: implemented
Related: #259, #239 (the pin that made the fork's async-context testable), the W5-R/W6-V rounds this face builds on

## Problem

Two lies in `fs-stat.js`'s real-disk fallback blocked the lsp-stdio family:

1. **Kind flattening**: `statRealFallback` mapped every non-directory to a
   regular file (`isDir ? 'dir' : 'file'`), so a FIFO reported `isFile() === true`
   — consumers' own regular-file checks never fired, and the read died later at
   open with an ENOENT that named nothing (the lsp `readSource` contract expects
   `not a regular file`).
2. **Outside-root invisibility**: `statSync`'s real-disk branch answered the real
   stat and then refused it (`realSeamInsideRoot` gate → `wsOutsideRootError`) for
   every path outside the workspace. The vendored `dsh-subprocess`
   `resolveExecutable` stats `process.execPath` (always outside) inside a
   `try/catch{}` — the refusal was swallowed, every candidate skipped, and 34
   lifecycle/provider tests cascaded into `is not an executable file`. The
   fallback's own docblock names this consumer as its reason to exist (W5-R); the
   R3-G1 tightening had locked it out.

## Decision

- **Kind truth**: the fallback derives the face from the seam's real
  S_ISREG/S_ISDIR booleans — a FIFO/device reports `isFile() === false` (new
  `'other'` kind), with real mode bits.
- **Visibility is not access**: metadata faces (`stat`, `access`, and thereby
  `exists`) answer the real disk for absolute paths outside every staged view —
  aligned with the `existsSync` precedent; the data faces (`open`/`read`/
  `write`/`readdir`) keep their outside-root refusals unchanged, and a missing
  outside path stays ENOENT (R3-G1 untouched). `accessSync` inherits real-mode
  X_OK, so an outside-root non-executable file fails X_OK and the vendored
  non-executable rejection flows.
- Pins: `test/panel/fs-stat-metadata-face.test.js` (13 new) +
  `tool-fs-outside-root-order.test.js` redrawn; 20-spec upstream regression net
  green.

## Alternatives considered

- Widening the stat seam refusal for executables only (mode & 0o111): rejected —
  a magic-bit carve-out inside the containment law is harder to reason about than
  the metadata/data split, and the next consumer would trip it again.
- Pre-resolving executables in the child-process pump before handing to the
  vendored spawn: rejected — the vendored `resolveExecutable` re-stats internally,
  so the shim-side answer would be dead code; the fs face is the only seam the
  package actually reads.
- Serving FIFO reads non-blocking: rejected for this round — the consumer
  contract wants the rejection, not the read.

## Consequences

`lsp-stdio` goes host 21/0, provider 15/0, framing 12/0; lifecycle 29/2 where the
two remaining failures are a transpiler module-identity artifact (the spec spies
its inlined `connection.ts` class while the provider uses the vendored lib's —
filed separately, not an fs defect). The spawn face can now see host executables
the workspace never staged; anything reading outside-root files still fails loud.
