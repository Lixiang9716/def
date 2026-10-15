"""OSV.dev vulnerability queries + CVSS v3.1 arithmetic.

OSV.dev aggregates the GitHub Advisory Database npm audit draws on, and a
`querybatch` judges exact name+version pairs with no lockfile — which is
why the vendored closure (deliberately not an npm project) is auditable
this way while `npm audit` is not. Severity: the advisory's own
qualitative severity when present, else the CVSS v3.1 base score computed
per the FIRST specification from the record's vector.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

OSV_QUERYBATCH_URL = "https://api.osv.dev/v1/querybatch"
OSV_VULN_URL = "https://api.osv.dev/v1/vulns/"
OSV_PAGE_URL = "https://osv.dev/vulnerability/"
HTTP_TIMEOUT = 30
RETRY_ATTEMPTS = 3
QUERYBATCH_CHUNK = 500
USER_AGENT = "dsh-mobile-supply-audit/1.0"

_KNOWN_SEVERITIES = ("CRITICAL", "HIGH", "MODERATE", "MEDIUM", "LOW")


def _http_json(url: str, payload: dict | None = None) -> dict:
    body = json.dumps(payload).encode() if payload is not None else None
    headers = {"User-Agent": USER_AGENT}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        url,
        data=body,
        method="POST" if payload is not None else "GET",
        headers=headers,
    )
    last_error: Exception | None = None
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt < RETRY_ATTEMPTS:
                time.sleep(2 ** (attempt - 1))  # bounded 1s/2s backoff
    raise SystemExit(
        f"supply-audit: OSV request failed after {RETRY_ATTEMPTS} attempts: "
        f"{url} ({last_error})"
    )


def query_osv(packages: list[dict]) -> dict[str, list[dict]]:
    """querybatch every package; return {"name@version": [vuln details]}."""
    keys = [f"{pkg['name']}@{pkg['version']}" for pkg in packages]
    found: dict[str, list[str]] = {key: [] for key in keys}
    for start in range(0, len(packages), QUERYBATCH_CHUNK):
        chunk = packages[start:start + QUERYBATCH_CHUNK]
        _query_chunk(chunk, keys, start, found)
    return _fetch_details(found)


def _query_chunk(
    chunk: list[dict], keys: list[str], start: int, found: dict[str, list[str]]
) -> None:
    queries = [
        {
            "package": {"name": pkg["name"], "ecosystem": "npm"},
            "version": pkg["version"],
        }
        for pkg in chunk
    ]
    response = _http_json(OSV_QUERYBATCH_URL, {"queries": queries})
    results = response.get("results", [])
    if len(results) != len(queries):
        raise SystemExit(
            f"supply-audit: OSV querybatch returned {len(results)} results "
            f"for {len(queries)} queries — refusing to guess the alignment"
        )
    for offset, result in enumerate(results):
        key = keys[start + offset]
        for vuln in result.get("vulns", []):
            if vuln.get("id"):
                found[key].append(vuln["id"])


def _fetch_details(found: dict[str, list[str]]) -> dict[str, list[dict]]:
    fetched: dict[str, dict] = {}
    unique_ids = sorted({vid for ids in found.values() for vid in ids})
    for vuln_id in unique_ids:
        fetched[vuln_id] = _http_json(OSV_VULN_URL + vuln_id)
    details: dict[str, list[dict]] = {}
    for key, ids in found.items():
        if ids:
            details[key] = [fetched[vid] for vid in ids]
    return details


def cvss31_base_score(vector: str) -> float | None:
    """CVSS v3.1 base score for a `CVSS:3.1/...` vector.

    FIRST v3.1 equations: ISS = 1-(1-C)(1-I)(1-A); Impact(S:U) = 6.42*ISS;
    Impact(S:C) = 7.52*(ISS-0.029) - 3.25*(ISS-0.02)^15;
    Exploitability = 8.22*AV*AC*PR*UI; Score(S:U) = Roundup(min(I+E,10)),
    Score(S:C) = Roundup(min(1.08*(I+E),10)). Roundup is Appendix A's
    integer recipe (round to 5 decimals, ceiling to 1 decimal).
    """
    metrics = _parse_vector(vector)
    if metrics is None:
        return None
    try:
        weights = _metric_weights(metrics)
    except KeyError:
        return None
    iss = 1.0 - (1.0 - weights["C"]) * (1.0 - weights["I"]) * (1.0 - weights["A"])
    if metrics["S"] == "C":
        impact = 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15
    else:
        impact = 6.42 * iss
    exploitability = 8.22 * weights["AV"] * weights["AC"] * weights["PR"] * weights["UI"]
    if impact <= 0:
        return 0.0
    score = impact + exploitability
    if metrics["S"] == "C":
        score = min(1.08 * score, 10.0)
    else:
        score = min(score, 10.0)
    scaled = round(score * 100000)
    return (scaled // 10000 + (1 if scaled % 10000 else 0)) / 10.0


def _parse_vector(vector: str) -> dict[str, str] | None:
    parts = vector.strip().split("/")
    if not parts or parts[0] != "CVSS:3.1":
        return None
    metrics: dict[str, str] = {}
    for part in parts[1:]:
        if ":" not in part:
            return None
        key, value = part.split(":", 1)
        metrics[key] = value
    return metrics


def _metric_weights(metrics: dict[str, str]) -> dict[str, float]:
    av = {"N": 0.85, "A": 0.62, "L": 0.55, "P": 0.2}[metrics["AV"]]
    ac = {"L": 0.77, "H": 0.44}[metrics["AC"]]
    ui = {"N": 0.85, "R": 0.62}[metrics["UI"]]
    pr_n = {"N": 0.85, "L": 0.62, "H": 0.27}
    pr_c = {"N": 0.85, "L": 0.68, "H": 0.5}
    pr = (pr_c if metrics["S"] == "C" else pr_n)[metrics["PR"]]
    cia = {m: {"H": 0.56, "L": 0.22, "N": 0.0}[metrics[m]] for m in ("C", "I", "A")}
    return {"AV": av, "AC": ac, "PR": pr, "UI": ui, **cia}


def cvss31_severity(score: float) -> str:
    if score <= 0.0:
        return "NONE"
    if score < 4.0:
        return "LOW"
    if score < 7.0:
        return "MEDIUM"
    if score < 9.0:
        return "HIGH"
    return "CRITICAL"


def vuln_severity(vuln: dict) -> tuple[str, float | None]:
    """(qualitative severity, cvss score or None) for one OSV record."""
    specific = (vuln.get("database_specific") or {}).get("severity")
    if isinstance(specific, str) and specific.upper() in _KNOWN_SEVERITIES:
        return specific.upper(), None
    for entry in vuln.get("severity", []):
        if entry.get("type") != "CVSS_V3":
            continue
        score_text = entry.get("score")
        if isinstance(score_text, str):
            score = cvss31_base_score(score_text)
            if score is not None:
                return cvss31_severity(score), score
    return "UNKNOWN", None


def fixed_versions(vuln: dict, package_name: str, ecosystem: str = "npm") -> list[str]:
    fixed = []
    for affected in vuln.get("affected", []):
        pkg = affected.get("package") or {}
        if pkg.get("name") != package_name:
            continue
        if pkg.get("ecosystem") != ecosystem:
            continue
        for ranget in affected.get("ranges", []):
            for event in ranget.get("events", []):
                if "fixed" in event:
                    fixed.append(event["fixed"])
    return sorted(set(fixed))


def summarize_vulns(details: list[dict], name: str) -> list[dict]:
    out = []
    for vuln in details:
        severity, score = vuln_severity(vuln)
        text = vuln.get("summary") or vuln.get("details") or ""
        out.append({
            "id": vuln.get("id", "?"),
            "summary": text.split("\n")[0][:300],
            "severity": severity,
            "cvssScore": score,
            "url": OSV_PAGE_URL + vuln.get("id", ""),
            "fixedIn": fixed_versions(vuln, name),
        })
    return sorted(out, key=lambda v: v["id"])
