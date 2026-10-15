"""Offline unit tests for the audit (--self-test).

Covers the pieces a silent mistake would corrupt invisibly: the SPDX
expression evaluator and policy classification, the CVSS v3.1 arithmetic
against FIRST reference vectors, and both pin-table parsers against
synthetic tables (including the loud failure on a malformed row). All
offline; exits 3 on any failure.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import licenses
import osv
import pins
from licenses import (
    VERDICT_ALLOW,
    VERDICT_DENY,
    VERDICT_REVIEW,
    classify_license_id,
    eval_spdx_expression,
    license_field_to_expression,
)


def run() -> int:
    failures: list[str] = []

    def check(label: str, actual: object, expected: object) -> None:
        if actual != expected:
            failures.append(f"{label}: got {actual!r}, want {expected!r}")

    _test_spdx(check)
    _test_license_fields(check)
    _test_cvss(check)
    _test_parsers(check)
    _test_classification(check)

    if failures:
        for failure in failures:
            print(f"self-test FAIL: {failure}", file=sys.stderr)
        print(
            f"supply-audit self-test: {len(failures)} failure(s)",
            file=sys.stderr,
        )
        return 3
    print("supply-audit self-test: all green", file=sys.stderr)
    return 0


def _test_spdx(check) -> None:
    check("MIT", eval_spdx_expression("MIT"), VERDICT_ALLOW)
    check("ISC", eval_spdx_expression("ISC"), VERDICT_ALLOW)
    check("GPL-3.0-or-later", eval_spdx_expression("GPL-3.0-or-later"),
          VERDICT_DENY)
    check("LGPL-3.0-only", eval_spdx_expression("LGPL-3.0-only"),
          VERDICT_DENY)
    check("AGPL-1.0", eval_spdx_expression("AGPL-1.0"), VERDICT_DENY)
    dual_a = eval_spdx_expression("(MIT OR GPL-3.0)")
    dual_b = eval_spdx_expression("(GPL-3.0 OR MIT)")
    check("dual (MIT OR GPL-3.0)", dual_a, VERDICT_ALLOW)
    check("dual (GPL-3.0 OR MIT)", dual_b, VERDICT_ALLOW)
    check("AND with GPL denies", eval_spdx_expression("MIT AND GPL-2.0-only"),
          VERDICT_DENY)
    check("AND permissive", eval_spdx_expression("MIT AND ISC"),
          VERDICT_ALLOW)
    nested_ok = eval_spdx_expression("((MIT OR GPL-2.0) AND BSD-3-Clause)")
    nested_deny = eval_spdx_expression("((MIT OR ISC) AND (GPL-3.0 OR AGPL-3.0))")
    check("nested allow", nested_ok, VERDICT_ALLOW)
    check("nested deny", nested_deny, VERDICT_DENY)
    check("unlisted is review", eval_spdx_expression("WTFPL"), VERDICT_REVIEW)
    check("BlueOak is review", eval_spdx_expression("BlueOak-1.0.0"),
          VERDICT_REVIEW)
    with_exc = eval_spdx_expression("Apache-2.0 WITH LLVM-exception")
    gpl_exc = eval_spdx_expression("GPL-2.0 WITH Classpath-exception-2.0")
    check("WITH exception keeps base", with_exc, VERDICT_ALLOW)
    check("GPL WITH exception still deny", gpl_exc, VERDICT_DENY)
    check("MIT+ legacy suffix", eval_spdx_expression("MIT+"), VERDICT_ALLOW)
    check("BSD-2-Clause", eval_spdx_expression("BSD-2-Clause"),
          VERDICT_ALLOW)


def _test_license_fields(check) -> None:
    check("object form", license_field_to_expression({"type": "MIT"}), "MIT")
    check("alias", license_field_to_expression("Apache 2.0"), "Apache-2.0")
    listed = license_field_to_expression(["MIT", {"type": "ISC"}])
    check("list form", listed, "(MIT OR ISC)")
    try:
        license_field_to_expression({"nope": 1})
        check("object without type raises", "no-raise", "ValueError")
    except ValueError:
        check("object without type raises", "raised", "raised")


def _test_cvss(check) -> None:
    check("cvss 9.8", osv.cvss31_base_score(
        "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"), 9.8)
    check("cvss 10.0", osv.cvss31_base_score(
        "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H"), 10.0)
    check("cvss 8.8", osv.cvss31_base_score(
        "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H"), 8.8)
    check("cvss 7.5", osv.cvss31_base_score(
        "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N"), 7.5)
    check("cvss 5.9", osv.cvss31_base_score(
        "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N"), 5.9)
    check("cvss 7.8 local", osv.cvss31_base_score(
        "CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H"), 7.8)
    check("cvss zero", osv.cvss31_base_score(
        "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N"), 0.0)
    check("cvss 5.3 rounding", osv.cvss31_base_score(
        "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N"), 5.3)
    check("cvss bad vector", osv.cvss31_base_score(
        "CVSS:2.0/AV:N/AC:L/Au:N/C:P/I:N/A:N"), None)
    check("cvss bucket high", osv.cvss31_severity(8.8), "HIGH")
    check("cvss bucket critical", osv.cvss31_severity(9.8), "CRITICAL")


def _test_parsers(check) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _write_runtime_fixture(root)
        npm_rows, dsh_rows = pins.parse_ensure_dsh_tables(
            root / "ensure-dsh.sh"
        )
        check("synthetic npm rows", [r["dir"] for r in npm_rows],
              ["npm/zod@4.4.3", "npm/cordis@4.0.2"])
        check("synthetic dsh rows", [r["dir"] for r in dsh_rows],
              ["dsh/agent-loop@0.1.6-alpha.2"])
        _test_malformed_row(root, check)
        _test_tests_fixture(root, check)


def _write_runtime_fixture(root: Path) -> None:
    sha_a, sha_b, sha_c = "a" * 64, "b" * 64, "c" * 64
    (root / "ensure-dsh.sh").write_text(
        'NPM_PACKAGES="\n'
        f'zod@4.4.3|zod/-/zod-4.4.3.tgz|{sha_a}\n'
        "\n"
        f'cordis@4.0.2|@deepseek-ai/cordis/-/cordis-4.0.2.tgz|{sha_b}\n'
        '"\n'
        'DSH_PACKAGES="\n'
        f'agent-loop|0.1.6-alpha.2|{sha_c}\n'
        '"\n',
        encoding="utf-8",
    )


def _test_malformed_row(root: Path, check) -> None:
    (root / "broken.sh").write_text(
        'NPM_PACKAGES="\nnot-a-row\n"\nDSH_PACKAGES="\n"\n',
        encoding="utf-8",
    )
    try:
        pins.parse_ensure_dsh_tables(root / "broken.sh")
        check("malformed pin row fails loud", "no-raise", "SystemExit")
    except SystemExit:
        check("malformed pin row fails loud", "raised", "raised")


def _test_tests_fixture(root: Path, check) -> None:
    sha_d, sha_e = "d" * 64, "e" * 64
    (root / "ensure-dsh-tests.sh").write_text(
        f'ensure_npm "dsh-agent-loop" "0.1.6-alpha.2" "{sha_d}"\n'
        f'ensure_npm_registry "jose" "6.2.3" "{sha_e}"\n',
        encoding="utf-8",
    )
    rows = pins.parse_ensure_dsh_tests_rows(root / "ensure-dsh-tests.sh")
    check("tests rows", [r["dir"] for r in rows],
          ["npm/@deepseek-ai/dsh-agent-loop@0.1.6-alpha.2", "npm/jose@6.2.3"])


def _test_classification(check) -> None:
    # the finding class that motivated the audit: sharp's libvips pair
    check("sharp libvips is LGPL-deny",
          classify_license_id("LGPL-3.0-or-later"), VERDICT_DENY)
    check("module verdict constants stable",
          licenses.VERDICT_MISSING, "missing")
