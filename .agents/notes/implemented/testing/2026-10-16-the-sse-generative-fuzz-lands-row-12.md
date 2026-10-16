# Agent Note: The SSE generative fuzz lands row 12

Status: implemented

## Problem

Row 12 called for generative, structure-aware fuzzing of the gateway wire /
SSE parser; the landed row-1 chaos legs use FIXED hostile profiles, so a
payload the profiles never imagined could still break the parser, and
nothing would notice.

## Decision

`test/panel/fastcheck/llm-sse-fuzz.test.js` drives the REAL `streamChat`
seam (stubbed `fetchImpl`, generated body bytes — no server) with three
properties: (P1) any well-formed stream split at arbitrary byte boundaries
(multi-byte UTF-8 cuts included, \n/\r\n, SSE comments) reassembles
text/reasoning exactly and the counters match; (P2) an unparsable data line
rejects typed `LlmError('invalid')`, never an accidental TypeError; (P3)
bytes after `[DONE]` are drained, not folded — even unparsable ones. The
raw-wire half of the row stays with the landed 21-case gateway-fuzz battery
(security legs); scoping recorded in the row cell.

## Alternatives considered

- **Fuzz the private makeLineSplitter/foldLine directly** — rejected: they
  are module-private and the public seam is the contract; driving
  `streamChat` exercises the decoder, splitter, folder, and [DONE] drain
  exactly as production does.
- **Wire the fastcheck runner into the panel gate in the same change** —
  deferred: it upgrades rows 7 and 12 together but is a sealed gates.json
  ritual (`gov gate add` + verify-plane); row 7 landed unwired first too.
  Open follow-up for the owner.
