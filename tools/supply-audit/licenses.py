"""License policy + SPDX expression evaluation for the vendor audit.

This repository's policy, encoding the decisions on record:

* GPL-family (GPL / LGPL / AGPL, any version) is denied outright. The
  standing state (doc/decisions.md D16 retirement addendum) is that
  nothing GPL links into any build.
* An absent license field is recorded as UNKNOWN, never assumed MIT
  (the bash-parser revocation note, 2026-10-11).
* BlueOak-1.0.0 is review-tier: the minimatch pin deliberately held at
  10.0.3 to avoid the 10.1.0+ relicensing.
* The allow list is deliberate and CLOSED — any identifier not on it
  lands in `review`. An unlisted license is a finding, not a silent
  pass (rules.md 5: fail loud on unknown values).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

VERDICT_ALLOW = "allow"
VERDICT_REVIEW = "review"
VERDICT_DENY = "deny"
VERDICT_MISSING = "missing"
VERDICT_PARSE_ERROR = "parse-error"

LICENSE_ALLOW = frozenset({
    "0BSD",
    "Apache-1.1",
    "Apache-2.0",
    "BSD-1-Clause",
    "BSD-2-Clause",
    "BSD-2-Clause-Patent",
    "BSD-3-Clause",
    "BSD-3-Clause-Clear",
    "CC0-1.0",
    "ICU",
    "ISC",
    "MIT",
    "MIT-0",
    "MIT-Modern-Variant",
    "Python-2.0",
    "Unlicense",
    "Unicode-3.0",
    "Unicode-DFS-2016",
    "X11",
    "Zlib",
})

LICENSE_DENY_PREFIXES = ("GPL", "LGPL", "AGPL")

_VERDICT_RANK = {
    VERDICT_ALLOW: 2,
    VERDICT_REVIEW: 1,
    VERDICT_MISSING: 1,
    VERDICT_PARSE_ERROR: 1,
    VERDICT_DENY: 0,
}

VERDICT_REASON = {
    VERDICT_ALLOW: "expression satisfiable entirely within the allow list",
    VERDICT_REVIEW: "no all-allow branch; at least one branch needs review",
    VERDICT_DENY: "every branch requires a GPL-family license",
}

# Legacy npm license spellings pre-SPDX, mapped to their identifiers.
_LICENSE_ALIASES = {
    "MIT/X11": "MIT",
    "MIT License": "MIT",
    "Apache License, Version 2.0": "Apache-2.0",
    "Apache 2.0": "Apache-2.0",
    "BSD": "BSD-3-Clause",
    "BSD-3": "BSD-3-Clause",
    "BSD-2": "BSD-2-Clause",
    "ISC License": "ISC",
}


def classify_license_id(license_id: str) -> str:
    """Verdict for ONE SPDX identifier (no expression operators)."""
    lid = license_id.strip()
    if re.match(r"^(L?A?GPL)\b", lid, re.IGNORECASE):
        return VERDICT_DENY
    if lid in LICENSE_ALLOW:
        return VERDICT_ALLOW
    return VERDICT_REVIEW


def rank_verdict(verdict: str) -> int:
    """Ordering used to fold expressions: DENY < REVIEW/MISSING < ALLOW."""
    return _VERDICT_RANK[verdict]


def tokenize_spdx(expr: str) -> list[str]:
    tokens: list[str] = []
    buf = ""
    for ch in expr:
        if ch in "()":
            if buf:
                tokens.append(buf)
                buf = ""
            tokens.append(ch)
        elif ch.isspace():
            if buf:
                tokens.append(buf)
                buf = ""
        else:
            buf += ch
    if buf:
        tokens.append(buf)
    return tokens


def eval_spdx_expression(expr: str) -> str:
    """Evaluate an SPDX license expression down to one verdict.

    Grammar (the subset npm package.json files actually carry):
      expr := and ; and := or ("AND" or)* ; or := atom ("OR" atom)*
      atom := id ["WITH" id] | "(" expr ")"
    OR takes the best branch (a dual license "(MIT OR GPL-3.0)" is
    satisfiable via MIT); AND takes the worst conjunct. `WITH <exception>`
    keeps the base license's verdict — exceptions reword, they do not
    move a license out of its copyleft family.
    """
    parser = _SpdxParser(tokenize_spdx(expr), expr)
    verdict = parser.parse_or()
    parser.expect_end()
    return verdict


class _SpdxParser:
    def __init__(self, tokens: list[str], source: str) -> None:
        self.tokens = tokens
        self.pos = 0
        self.source = source

    def peek(self) -> str | None:
        if self.pos < len(self.tokens):
            return self.tokens[self.pos]
        return None

    def next(self) -> str:
        tok = self.peek()
        if tok is None:
            raise ValueError(f"unexpected end of SPDX expression: {self.source!r}")
        self.pos += 1
        return tok

    def parse_or(self) -> str:
        verdicts = [self.parse_and()]
        while self.peek() == "OR":
            self.next()
            verdicts.append(self.parse_and())
        return max(verdicts, key=rank_verdict)

    def parse_and(self) -> str:
        verdicts = [self.parse_atom()]
        while self.peek() == "AND":
            self.next()
            verdicts.append(self.parse_atom())
        return min(verdicts, key=rank_verdict)

    def parse_atom(self) -> str:
        tok = self.next()
        if tok == "(":
            inner = self.parse_or()
            if self.next() != ")":
                raise ValueError(f"unbalanced parentheses in {self.source!r}")
            return inner
        if tok in ("AND", "OR", ")"):
            raise ValueError(f"misplaced operator {tok!r} in {self.source!r}")
        if self.peek() == "WITH":
            self.next()
            exception = self.next()
            if exception in ("AND", "OR", "WITH", ")"):
                raise ValueError(
                    f"misplaced exception {exception!r} in {self.source!r}"
                )
        return self._classify_atom(tok)

    def _classify_atom(self, license_id: str) -> str:
        verdict = classify_license_id(license_id)
        if verdict != VERDICT_REVIEW or not license_id.endswith("+"):
            return verdict
        base = license_id.rstrip("+").rstrip("-0123456789.")
        if base in LICENSE_ALLOW:
            return VERDICT_ALLOW  # legacy "MIT+" style suffix
        return verdict

    def expect_end(self) -> None:
        if self.pos != len(self.tokens):
            trailing = self.tokens[self.pos:]
            raise ValueError(f"trailing tokens {trailing!r} in {self.source!r}")


def license_field_to_expression(raw: object) -> str | None:
    """Normalize a package.json `license` value to an SPDX expression.

    Returns None when absent/empty (the caller records MISSING — unknown
    is recorded, never assumed). Raises ValueError on unusable shapes.
    """
    if raw is None:
        return None
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return None
        return _LICENSE_ALIASES.get(text, text)
    if isinstance(raw, dict):
        license_type = raw.get("type")
        if isinstance(license_type, str) and license_type.strip():
            return license_field_to_expression(license_type)
        raise ValueError(f"license object without a usable type field: {raw!r}")
    if isinstance(raw, list):
        parts = [license_field_to_expression(item) for item in raw]
        parts = [p for p in parts if p]
        if not parts:
            raise ValueError(f"license list without usable entries: {raw!r}")
        return "(" + " OR ".join(parts) + ")"
    raise ValueError(f"unusable license field shape: {raw!r}")


def license_verdict_for_package(package_json: Path) -> dict:
    """Read + judge one package.json's license. Fails loud on bad JSON."""
    try:
        data = json.loads(package_json.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(
            f"supply-audit: unparseable {package_json}: {exc}"
        ) from None
    name = data.get("name") or package_json.parent.name
    version = data.get("version") or "?"
    raw_license = data.get("license")
    result = {
        "name": name,
        "version": version,
        "licenseRaw": raw_license
        if isinstance(raw_license, (str, dict, list))
        else None,
    }
    return _judge_field(result, raw_license)


def _judge_field(result: dict, raw_license: object) -> dict:
    if raw_license is None:
        result["verdict"] = VERDICT_MISSING
        result["expression"] = None
        result["reason"] = (
            "no license field — recorded as UNKNOWN, never assumed "
            "(repo discipline)"
        )
        return result
    try:
        expression = license_field_to_expression(raw_license)
    except ValueError as exc:
        result["verdict"] = VERDICT_PARSE_ERROR
        result["expression"] = None
        result["reason"] = str(exc)
        return result
    if expression is None:
        result["verdict"] = VERDICT_MISSING
        result["expression"] = None
        result["reason"] = "empty license field"
        return result
    try:
        verdict = eval_spdx_expression(expression)
    except ValueError as exc:
        result["verdict"] = VERDICT_PARSE_ERROR
        result["expression"] = expression
        result["reason"] = str(exc)
        return result
    result["verdict"] = verdict
    result["expression"] = expression
    result["reason"] = VERDICT_REASON[verdict]
    return result
