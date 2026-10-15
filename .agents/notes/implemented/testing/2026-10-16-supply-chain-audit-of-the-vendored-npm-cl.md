# Agent Note: supply-chain audit of the vendored npm closure (CVE + license)

Status: implemented
Related: D6

## Problem

The vendored npm closure — the pin tables in `external/ensure-dsh.sh`
(NPM_PACKAGES + DSH_PACKAGES) and `external/ensure-dsh-tests.sh`
(ensure_npm / ensure_npm_registry) — is the project's entire third-party
supply chain, and nothing scanned it. The license discipline lived in
prose and one-off diligence notes (the bash-parser revocation recorded
UNKNOWN as UNKNOWN; the minimatch pin held at 10.0.3 to dodge BlueOak),
and no gate or workflow ever asked "does anything pinned carry a known
CVE or a license outside the repo's policy?" The test-hardening program
(doc/test-coverage.md row 10) named the missing method: a supply-chain
audit of the vendored closure covering CVEs and license compliance with a
machine-readable report. `npm audit` itself cannot judge this closure:
the vendor tree is deliberately not an npm project (no lockfile —
`npm audit` needs one, and its `--offline` mode only replays a cached
audit payload).

## Decision

`tools/supply-audit.py` (stdlib-only Python) audits the PIN TABLES — the
tracked provenance record — not the on-disk tree: every row of both
tables (389 unique pins at time of writing) is license-scanned from the
materialized `package.json` and queried against OSV.dev's `querybatch`
(the aggregator behind npm audit's advisory database), with per-vuln
details, CVSS v3.1 scores computed per the FIRST spec when the record
carries only a vector, and fix versions listed as information — the
script never bumps versions. License policy encodes the decisions on
record: GPL-family denied outright, UNKNOWN recorded as UNKNOWN, an
allow-list where any unlisted SPDX identifier lands in `review` (fail
loud, never a silent pass). On-disk vendor directories the tables do not
name are reported as drift, never scanned as the supply chain. Exit codes:
1 = license violation (`--strict` escalates review-tier), 2 = `--fail-on-cve`
threshold, 4 = environment (missing/unparseable pins). `--self-test` runs
offline unit tests over the SPDX evaluator, CVSS arithmetic (FIRST
reference vectors), and both pin-table parsers.

The optional CI leg is a NEW workflow, `.github/workflows/supply-audit.yml`
(scheduled Mondays + vendor-touching PRs + on demand) — it materializes
the pinned closure, self-tests, audits, publishes the JSON artifact and a
job summary, and is REPORT-ONLY by design: remediation belongs to the
vendor-package flow, so the leg surfaces the exit verdict in its summary
without blocking unrelated merges. `static-analysis.yml` (the static-analysis
seat's file) is untouched.

## Alternatives considered

- **`npm audit` over a synthesized lockfile** — rejected: it would need a
  synthetic `package-lock.json` forever re-derived from the pin tables, and
  npm's audit endpoint serves only the registry's own advisory view; OSV
  querybatch covers the same GHSA corpus in one request for 389 packages
  and needs no lockfile at all.
- **Blocking CI on CVE findings** — rejected for this PR: the brief forbids
  auto-remediation, and a hard red with no in-scope fix path would stall
  every PR. The report carries severity + fix versions; flipping the leg
  to blocking later is a one-line `--fail-on-cve HIGH,CRITICAL` opt-in.
- **Auditing the on-disk tree instead of the pin tables** — rejected: a dev
  tree can carry stale faces a fresh fetch would not produce (the
  copy-never-prunes trap); the pin tables are what CI's closures gate
  verify, so they are the shipped supply chain. Drift is still reported.

## Consequences

First audit findings (2026-10-16, 389 pins): `@img/sharp-libvips-linux-{arm64,x64}@1.3.2`
(pinned by the tests closure) carry **LGPL-3.0-or-later** — GPL-family, a
license-policy violation sitting in the tracked mirror; 28 known CVEs
(15 HIGH) concentrated in `undici@8.10.0` (13), `minimatch@10.0.3` (3,
ReDoS — whose fix versions 10.2.x are exactly the BlueOak-1.0.0 licensing
the pin deliberately avoided, a real policy tension for the owner),
`js-yaml@4.1.0`/`4.3.1` (4+1), `sharp@0.35.3` (2), `picomatch@2.3.1`,
`compression@1.8.1`, `@modelcontextprotocol/client@2.0.0`,
`fflate@0.8.2`, `@hono/node-server@1.19.14`. All reported, none
auto-remediated.
