#!/usr/bin/env python3
"""Supply-chain audit of the vendored npm closure (test-hardening row 10).

Run: python3 tools/supply-audit/__main__.py [flags]

Audits EVERY package the vendor pin tables commit to — the runtime closure
(``external/ensure-dsh.sh``: NPM_PACKAGES + DSH_PACKAGES) and the test
closure (``external/ensure-dsh-tests.sh``: ensure_npm / ensure_npm_registry
rows) — which together are the direct-dependency + transitive closure the
hosts embed. Ground truth is the PIN TABLE (the tracked provenance record),
never the on-disk tree alone; on-disk directories the tables do not name
are reported as DRIFT, not scanned as the supply chain.

Two checks per package:

* **License compliance** — the ``license`` field is evaluated against the
  policy in ``licenses.py`` (GPL-family denied; UNKNOWN recorded, never
  assumed; closed allow list, unlisted licenses are review findings).
* **Known vulnerabilities** — OSV.dev queried by exact name+version for
  every pinned package (``osv.py``; the aggregator behind npm audit's
  advisory database — ``npm audit`` needs a lockfile the vendor tree
  deliberately does not have, and its ``--offline`` mode only replays a
  cached audit payload). The script NEVER upgrades versions — a CVE is a
  finding for the vendor-package flow, not an auto-remediation trigger.

Output: a machine-readable JSON report (``--out`` or stdout) plus a human
summary on stderr.

Exit codes:
  0  clean, or only report-only findings
  1  license-policy violation in the pinned closure (GPL-family); with
     ``--strict``, review-tier licenses fail too
  2  a CVE met the ``--fail-on-cve`` threshold (report-only by default)
  3  ``--self-test`` failed
  4  environment error: missing/unparseable pin tables, missing vendor
     root (materialize first: ``sh external/ensure-dsh.sh``)

Usage:
  python3 tools/supply-audit/__main__.py                      # full audit
  python3 tools/supply-audit/__main__.py --offline            # no CVE queries
  python3 tools/supply-audit/__main__.py --out tmp/report.json --fail-on-cve CRITICAL,HIGH
  python3 tools/supply-audit/__main__.py --self-test          # offline tests
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import audit
import selftest


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="supply-audit",
        description=(
            "Supply-chain audit (CVE + license) of the vendored npm closure."
        ),
    )
    parser.add_argument(
        "--repo", type=Path, default=None,
        help="repository root (default: the checkout this script lives in)",
    )
    parser.add_argument(
        "--out", type=Path, default=None,
        help="write the JSON report here ('-' or omit: stdout)",
    )
    parser.add_argument(
        "--offline", action="store_true",
        help="skip the OSV vulnerability queries (license + drift only)",
    )
    parser.add_argument(
        "--fail-on-cve", type=str, default=None,
        help="comma-separated severities (CRITICAL, HIGH, MEDIUM, LOW, ANY) "
             "that make the audit exit 2 (default: report-only)",
    )
    parser.add_argument(
        "--strict", action="store_true",
        help="review-tier licenses also fail (exit 1)",
    )
    parser.add_argument(
        "--no-fail-license", action="store_true",
        help="never fail on license findings (report-only)",
    )
    parser.add_argument(
        "--self-test", action="store_true",
        help="run the offline unit tests and exit",
    )
    return parser


def _exit_code(report: dict, args: argparse.Namespace) -> int:
    summary = report["summary"]
    if not args.no_fail_license and summary["licenseFailures"]:
        return 1
    if args.strict and summary["licenseReview"]:
        return 1
    if args.fail_on_cve:
        wanted = {token.strip().upper() for token in args.fail_on_cve.split(",")}
        counts = summary["vulnsBySeverity"]
        any_trip = "ANY" in wanted and summary["vulnCount"] > 0
        sev_trip = any(counts.get(sev, 0) > 0 for sev in wanted)
        if any_trip or sev_trip:
            return 2
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.self_test:
        return selftest.run()
    repo = args.repo or Path(__file__).resolve().parent.parent.parent
    report = audit.run_audit(repo, offline=args.offline)
    audit.write_report(report, args.out)
    audit.print_summary(report)
    return _exit_code(report, args)


if __name__ == "__main__":
    sys.exit(main())
