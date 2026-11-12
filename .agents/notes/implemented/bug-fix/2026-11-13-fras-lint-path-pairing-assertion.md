# fras-lint gains the path-pairing assertion

## Problem

During the 2026-11-12 AOCI closeout (#767), a candidate batch was assembled by
pairing authored entry lines to machine candidates **by array index**. The
line file's order drifted from the candidate order across the trio members
(`.i18n.yaml`/`.md`/`.zh`), so content shifted across paths — and the batch
reached the machine validator, which flagged F-length findings on entries the
author did not think it was linting. A session surprise
(`fras-lint-precheck-green-means`) recorded the confusion as "the local lint's
finding-to-path mapping is unreliable"; the investigation for this change
corrects that: the lint was faithful to the array it was given. The defect was
the un-validated line-to-candidate pairing, and nothing in the toolchain
named that class — the entry line's own leading `<path>[<tag>]` is exactly the
fact needed to catch it, and the lint ignored it.

## Decision

`tools/aoci/fras-lint.mjs` gains two checks:

- **`path-mismatch`** — the entry line's leading path must agree with the
  candidate's `path` field **on basenames** (the entry line carries the
  section-local filename — `aoci.code.txt` entries read `README.md[SB8T]: …`
  under a section header — while the candidate path is repo-relative, so an
  exact compare would false-positive every correctly-paired batch; basenames
  are the load-bearing agreement). On mismatch the lint names the class and
  stops checking that entry.
- **`path-shape`** — a candidate with no non-empty `path` field is named
  instead of silently linting an unattributable entry.

The header comment documents both. Verified with three fixtures: a
correctly-paired entry passes with zero findings; a deliberately shifted
pairing (the #767 session's exact failure shape) is flagged `path-mismatch`
naming both basenames; a pathless candidate is flagged `path-shape`.

## Alternatives considered

- **Correct the surprise record instead** — rejected: the ledger is
  append-only telemetry; the record honestly describes the session's belief at
  record time. This note is the correction of record, and the lint change is
  the structural fix.
- **Full-path equality** — rejected by measurement: the entry line's leading
  path is the section-local filename by format, so full-path equality
  false-positives every correctly-paired batch (verified against a fixture
  before settling on basenames).
- **Validate `source_sha256`/`candidate_id` presence too** — rejected for
  scope: those are machine-batch plumbing the machine already enforces; the
  lint stays the FRAS-and-pairing judge.

## Consequences

The #767 failure shape (index-paired content across trio members) is now
caught at lint time with both basenames named, instead of surfacing as
mis-attributed machine findings. The one-time pairing script pattern in that
session (line array → candidate array by index) is the anti-pattern this
check makes loud.
