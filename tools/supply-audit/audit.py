"""Audit assembly: pins -> licenses -> CVEs -> drift -> report.

The report is machine-readable JSON (schema dsh-supply-audit/v1) with a
human summary alongside. CVE findings are information only — fix versions
are listed so the vendor-package flow can act, but nothing here bumps a
version. Drift (on-disk vendor dirs the pin tables do not name) is
reported, never scanned as the supply chain.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import licenses
import osv
import pins

REPORT_SCHEMA = "dsh-supply-audit/v1"


def load_pins(external: Path) -> dict[str, dict]:
    """Union every pin table into {<face>/<dir>: row}; conflicts fail loud."""
    runtime_npm, runtime_dsh = pins.parse_ensure_dsh_tables(
        external / "ensure-dsh.sh"
    )
    tests_rows = pins.parse_ensure_dsh_tests_rows(
        external / "ensure-dsh-tests.sh"
    )
    by_dir: dict[str, dict] = {}
    for row in runtime_npm + runtime_dsh + tests_rows:
        existing = by_dir.get(row["dir"])
        if existing and existing["sha"] != row["sha"]:
            raise SystemExit(
                f"supply-audit: conflicting pins for {row['dir']}: "
                f"{existing['sha']} ({existing['table']}) vs "
                f"{row['sha']} ({row['table']})"
            )
        by_dir.setdefault(row["dir"], row)
    if not by_dir:
        raise SystemExit(
            "supply-audit: pin tables parsed to zero rows — refusing to "
            "report an empty audit"
        )
    return by_dir


def judge_pin_licenses(external: Path, by_dir: dict[str, dict]) -> list[dict]:
    """License verdicts for every pinned row (sibling-face fallback)."""
    judged = []
    for dir_name in sorted(by_dir):
        row = by_dir[dir_name]
        info, read_from = _license_for_dir(external, dir_name)
        judged.append({**row, **info, "dir": dir_name,
                       "licenseReadFrom": read_from})
    return judged


def _license_for_dir(external: Path, dir_name: str) -> tuple[dict, str | None]:
    pkg_json = external / dir_name / "package.json"
    if pkg_json.is_file():
        return licenses.license_verdict_for_package(pkg_json), None
    for candidate in _sibling_dirs(dir_name):
        sibling = external / candidate / "package.json"
        if sibling.is_file():
            info = licenses.license_verdict_for_package(sibling)
            return info, candidate
    return {
        "name": dir_name,
        "version": "?",
        "licenseRaw": None,
        "verdict": licenses.VERDICT_MISSING,
        "expression": None,
        "reason": "pinned but not materialized on disk",
    }, None


def _sibling_dirs(dir_name: str) -> list[str]:
    """The same name@version under the OTHER vendor face.

    dsh-face dirs drop the `dsh-` prefix (dsh/agent-loop@… carries
    @deepseek-ai/dsh-agent-loop); try both spellings.
    """
    candidates = []
    if dir_name.startswith("npm/@deepseek-ai/"):
        rest = dir_name[len("npm/@deepseek-ai/"):]
        candidates.append("dsh/" + rest)
        if rest.startswith("dsh-"):
            candidates.append("dsh/" + rest[len("dsh-"):])
    elif dir_name.startswith("dsh/"):
        rest = dir_name[len("dsh/"):]
        candidates.append("npm/@deepseek-ai/" + rest)
        if not rest.startswith("dsh-"):
            candidates.append("npm/@deepseek-ai/dsh-" + rest)
    return candidates


def scan_drift(external: Path, pinned_dirs: set[str]) -> tuple[list[dict], list[str]]:
    """On-disk vendor dirs outside the pin tables + pins missing on disk."""
    on_disk = pins.enumerate_vendored_dirs(external / "npm", external / "dsh")
    drift = []
    for dir_name in sorted(on_disk - pinned_dirs):
        drift.append(_drift_entry(external, dir_name))
    missing = sorted(pinned_dirs - on_disk)
    return drift, missing


def _drift_entry(external: Path, dir_name: str) -> dict:
    pkg_json = external / dir_name / "package.json"
    if not pkg_json.is_file():
        return {"dir": dir_name, "name": dir_name, "version": "?",
                "licenseVerdict": licenses.VERDICT_MISSING,
                "licenseExpression": None}
    info = licenses.license_verdict_for_package(pkg_json)
    return {
        "dir": dir_name,
        "name": info["name"],
        "version": info["version"],
        "licenseVerdict": info["verdict"],
        "licenseExpression": info["expression"],
    }


def run_audit(repo: Path, offline: bool) -> dict:
    external = repo / "external"
    _require_pin_tables(external)
    by_dir = load_pins(external)
    packages = judge_pin_licenses(external, by_dir)
    drift, missing = scan_drift(external, set(by_dir))
    if not offline:
        details = osv.query_osv(packages)
    else:
        details = {}
    for pkg in packages:
        key = f"{pkg['name']}@{pkg['version']}"
        pkg["vulns"] = osv.summarize_vulns(details.get(key, []), pkg["name"])
    return _assemble_report(repo, offline, packages, drift, missing)


def _require_pin_tables(external: Path) -> None:
    for name in ("ensure-dsh.sh", "ensure-dsh-tests.sh"):
        if not (external / name).is_file():
            raise SystemExit(
                f"supply-audit: pin tables missing under {external} — "
                "run from a repository checkout"
            )


def _assemble_report(
    repo: Path, offline: bool, packages: list[dict],
    drift: list[dict], missing: list[str],
) -> dict:
    return {
        "schema": REPORT_SCHEMA,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sourceRevision": pins.git_revision(repo),
        "repo": str(repo),
        "mode": "offline" if offline else "online",
        "policy": {
            "licenseAllowList": sorted(licenses.LICENSE_ALLOW),
            "licenseDenyFamily": list(licenses.LICENSE_DENY_PREFIXES),
            "unlistedLicense": (
                "review (fail-safe: an unlisted license is a finding, "
                "not a pass)"
            ),
            "cveSource": "none (offline)" if offline else (
                "OSV.dev querybatch (aggregates the GitHub Advisory Database)"
            ),
            "cveAutoRemediation": "never — findings go to the vendor-package flow",
        },
        "pinned": [_pin_row(pkg) for pkg in packages],
        "drift": {
            "note": (
                "on-disk vendor dirs the pin tables do not name — stale "
                "dev faces; reported, never scanned as the supply chain"
            ),
            "unpinnedDirs": drift,
            "pinnedButMissingOnDisk": missing,
        },
        "summary": summarize(packages, drift, missing),
    }


def _pin_row(pkg: dict) -> dict:
    return {
        "dir": pkg["dir"],
        "name": pkg["name"],
        "version": pkg["version"],
        "pinSha256": pkg["sha"],
        "pinTable": pkg["table"],
        "licenseReadFrom": pkg["licenseReadFrom"],
        "licenseVerdict": pkg["verdict"],
        "licenseExpression": pkg["expression"],
        "licenseRaw": pkg["licenseRaw"],
        "vulns": pkg["vulns"],
    }


def summarize(packages: list[dict], drift: list[dict], missing: list[str]) -> dict:
    license_counts: dict[str, int] = {}
    severity_counts: dict[str, int] = {}
    for pkg in packages:
        license_counts[pkg["verdict"]] = license_counts.get(pkg["verdict"], 0) + 1
        for vuln in pkg["vulns"]:
            severity_counts[vuln["severity"]] = (
                severity_counts.get(vuln["severity"], 0) + 1
            )
    return {
        "pinnedCount": len(packages),
        "driftCount": len(drift),
        "missingOnDiskCount": len(missing),
        "licenseCounts": license_counts,
        "licenseFailures": _findings(packages, {licenses.VERDICT_DENY}),
        "licenseReview": _review_findings(packages),
        "driftLicenseFailures": [
            {"dir": d["dir"], "licenseExpression": d["licenseExpression"]}
            for d in drift if d["licenseVerdict"] == licenses.VERDICT_DENY
        ],
        "vulnCount": sum(severity_counts.values()),
        "vulnsBySeverity": severity_counts,
        "vulnPinnedDirs": sorted(
            pkg["dir"] for pkg in packages if pkg["vulns"]
        ),
    }


def _findings(packages: list[dict], verdicts: set[str]) -> list[dict]:
    return [
        {"dir": pkg["dir"], "expression": pkg["expression"],
         "reason": pkg["reason"]}
        for pkg in packages if pkg["verdict"] in verdicts
    ]


def _review_findings(packages: list[dict]) -> list[dict]:
    review_verdicts = {
        licenses.VERDICT_REVIEW,
        licenses.VERDICT_MISSING,
        licenses.VERDICT_PARSE_ERROR,
    }
    return _findings(packages, review_verdicts)


def write_report(report: dict, out: Path | None) -> None:
    text = json.dumps(report, indent=2, sort_keys=False)
    if out is None or str(out) == "-":
        sys.stdout.write(text + "\n")
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text + "\n", encoding="utf-8")


def print_summary(report: dict) -> None:
    summary = report["summary"]
    head = (
        f"supply-audit: {summary['pinnedCount']} pinned packages "
        f"({len(summary['licenseFailures'])} license failure(s), "
        f"{len(summary['licenseReview'])} review-tier, "
        f"{summary['vulnCount']} known CVE(s) "
        f"{json.dumps(summary['vulnsBySeverity'], sort_keys=True)}), "
        f"{summary['driftCount']} drift dir(s), "
        f"{summary['missingOnDiskCount']} pinned-but-missing"
    )
    print(head, file=sys.stderr)
    for line in _finding_lines(report):
        print(line, file=sys.stderr)


def _finding_lines(report: dict) -> list[str]:
    summary = report["summary"]
    lines = []
    for failure in summary["licenseFailures"]:
        lines.append(f"  LICENSE-DENY  {failure['dir']}: {failure['expression']}")
    for finding in summary["licenseReview"]:
        lines.append(
            f"  license-review {finding['dir']}: {finding['expression']} "
            f"({finding['reason']})"
        )
    for drift in summary["driftLicenseFailures"]:
        lines.append(
            f"  DRIFT-DENY    {drift['dir']}: {drift['licenseExpression']} "
            "(unpinned on-disk face)"
        )
    for pkg in report["pinned"]:
        lines.extend(_vuln_lines(pkg))
    return lines


def _vuln_lines(pkg: dict) -> list[str]:
    lines = []
    for vuln in pkg["vulns"]:
        fixed = ""
        if vuln["fixedIn"]:
            fixed = f" fixed in {','.join(vuln['fixedIn'])}"
        lines.append(
            f"  CVE {vuln['severity']:8s} {pkg['dir']}: {vuln['id']} "
            f"{vuln['url']}{fixed}"
        )
    return lines
