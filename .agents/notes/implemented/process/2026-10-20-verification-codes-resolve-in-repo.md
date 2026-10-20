# Verification codes resolve in-repo

Status: implemented

## Problem

Verification comments across the tree cite work by private codes — wave
slot codes (`W3-K`, `W5-T`, `W8`, `W-INTEG`, …), a contract code (`D-g`),
and a process code (`P0-3`). None of these resolve to anything a reader
can look up: the wave ledger lived in session notes, not in the repo, so
"the W5-T race" is unanswerable from a checkout. The E2E evidence matrix
documents receipt-family codes (`m1-spike`, `b4-write-live`,
`d9-official-web`) but nowhere states what they are, where the decode
table lives, or what naming new evidence families must use. Comment debt
of this kind compounds: every new reader re-derives or mistrusts the
citations.

## Decision

Every verification code inside the repo now resolves in-repo.

- **Wave slot codes** (48 occurrences across `runtime/dsh/scenario/*.js`,
  `test/upstream-suite/*.mjs`, `external/ensure-dsh.sh`) were resolved by
  `git log --follow -S"<code>" -- <file>` to their introducing commit,
  then to the PR whose squash merge is that commit (GitHub commit→PR
  association verified per commit). Each citation now reads as a PR
  reference — `(#238)`, `(#240)`, `(#273)`, `(#58)`, `(#53)`, `(#341)` —
  with dates preserved verbatim. Committed host mirrors were refreshed by
  `build/build.sh sync all`.
- **`D-g`** resolves to PR #253 (the harmony one-click device-parity
  runner — confirmed via `gh pr view 253`). `doc/ARCHITECTURE.md` now
  says "(the device-parity contract, #253)"; the release notes drop the
  bare code next to the existing `#253` reference.
- **`P0-3`** in `.gov/rules.md` is stripped; the reasoning ("a fresh
  install never goes red on day one") stays.
- **Policy going forward, now written into `doc/e2e-matrix.md`
  (§ Receipt family codes, both languages)**: (1) in-repo codes must be
  resolvable — an identifier a checkout cannot decode is comment debt;
  (2) new evidence families take plain feature names (`composer-live-write`
  style) from 2026-10-20 on — the machine decode table is `LEGACY_STEMS`
  in `test/e2e/matrix.mjs`, the single source of truth, never copied into
  prose; (`b2` was never issued); (3) historical artifact directories keep
  their codes — evidence is immutable and is never renamed.

## Alternatives considered

- **Delete the citations outright** (keep dates, drop every code). Rejected
  where the PR was verifiable: the citation is the cheapest audit trail a
  reviewer has, and inventing nothing also means discarding something real.
  Deletion is the fallback only where no PR resolves.
- **Copy the decode table into the docs.** Rejected: the matrix checker
  already reads `LEGACY_STEMS` as its single source; a second copy is a
  drift surface of exactly the kind the register rule (machine-read
  tables, no duplicate copies) exists to prevent.
- **Rename historical evidence directories to feature names** for
  consistency with the new policy. Rejected: receipts and verdicts are
  frozen evidence; renaming breaks the chain between published artifacts,
  committed hashes, and the register rows that cite them. The policy is
  forward-looking only.
- **Keep wave codes and add a wave→PR ledger document.** Rejected: a
  second indirection (code → ledger row → PR) still leaves the in-repo
  comment unresolvable by the standard tooling (`git log`, PR links) that
  a reader already uses.
