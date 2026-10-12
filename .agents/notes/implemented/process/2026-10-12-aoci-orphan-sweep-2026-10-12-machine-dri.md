# Agent Note: AOCI orphan sweep 2026-10-12: machine-driven recovery after the reset divergence

Status: implemented

## Problem

The P0 AOCI refresh inherited three stacked problems in the main checkout. First, an
earlier `git reset --hard` (during the #472 landing) reverted the tracked machine-written
exports — `aoci.code.txt` and `.aoci/baseline.json` — while the ignored runtime state
(`.aoci/ledger.jsonl`, `.aoci/transactions/`) survived, leaving disk bytes diverged from
the ledger-recorded truth. Second, 47 index entries pointed at files already deleted by
merged PRs (the shell-ish/shell-wasm seat teardown, #402-renamed scenarios, harmony
rawfile old legs), and the machine (aoci rc18, volumes-v1 layout) withholds all
authoring batches while orphans exist. Third, 151 observe-evidence items were stuck in
`observed_evidence_review_required`, which also refuses downstream scope commands.

## Decision

Recovery ran entirely through machine commands; no machine-owned byte was hand-edited.
The applied scope transaction (5ecdba5e) was confirmed complete, and the observe
evidence was reviewed and re-acknowledged (transaction 96e5919a, `--reviewed-by
zcode-main-agent`), clearing the review gate. All 44 orphan candidates that rc18 can
express were removed one-by-one through the MCP `aoci_remove_entry` pipeline; the final
volume hash (b219ea63…) reproduces the pre-reset end state byte-for-byte. Each removal
leaves a residual transaction receipt that must be archived by hand into
`.aoci/transactions/history/` before non-remove commands work again — rc18 loses the
ledger append on every removal (`remove_ledger_completion_failed`), which is reported
upstream. The 3 remaining entries (android-officialweb-web-live.js in two sections plus
the staged dsh-shell-wasm/programs.js) each have a byte-identical twin line and are
mechanically unremovable in rc18 (upstream #117); they stay, documented, until an
upstream fix. `aoci.code.txt` (44 entry lines and 2 empty section headers gone, 1383→1339
entries) and the repainted `.aoci/baseline.json` land through this PR.

## Alternatives considered

Hand-editing `aoci.code.txt` to drop the 3 stuck lines lost: machine-owned cognition
is zero-hand-edit by rule (AGENTS.md AOCI section), and a hand-edited volume would fail
the machine's own CAS on the next write. Scope-excluding the 3 deleted paths lost: the
exclude policy classifies on-disk files at scan time, so it is meaningless for deleted
paths and would only paper over the upstream defect. Waiting for an upstream rc19 before
landing anything lost: the 44-line sweep plus the re-acknowledged scope is
machine-written and self-consistent today, and leaving it uncommitted in the main
checkout is exactly how the last session's work was lost to a reset.
