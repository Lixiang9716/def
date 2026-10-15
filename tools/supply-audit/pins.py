"""Pin-table enumeration — the tracked provenance record of the closure.

Ground truth is the PIN TABLE, never the on-disk tree alone: a dev tree
can carry stale faces a fresh fetch would not produce (the
copy-never-prunes trap). Two tables cover the closure:

* ``external/ensure-dsh.sh`` — NPM_PACKAGES (`dir|tgz-suffix|sha`, the
  runtime's third-party closure) and DSH_PACKAGES (`name|ver|sha`, the
  mirror-served first-party face materialized at dsh/<bare-name>@<ver>).
* ``external/ensure-dsh-tests.sh`` — imperative ensure_npm rows (bare
  @deepseek-ai names landing at npm/@deepseek-ai/<name>@<ver>) and
  ensure_npm_registry rows (full registry names).

Every row is normalized to a `<face>/<dir>` spelling so on-disk
enumeration compares apples to apples.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

_SHA256 = re.compile(r"[0-9a-f]{64}")


def _extract_block(text: str, var: str, script: Path) -> str:
    match = re.search(rf'^{var}="\n(.*?)^"\s*$', text, re.S | re.M)
    if match is None:
        raise SystemExit(f"supply-audit: {var} block not found in {script}")
    return match.group(1)


def _parse_rows(block: str, script: Path, table: str) -> list[str]:
    rows = []
    for line in block.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("|")
        if len(parts) != 3 or not _SHA256.fullmatch(parts[2]):
            raise SystemExit(
                f"supply-audit: malformed {table} row in {script}: {line!r}"
            )
        rows.append(line)
    return rows


def parse_ensure_dsh_tables(script: Path) -> tuple[list[dict], list[dict]]:
    """NPM_PACKAGES + DSH_PACKAGES rows of external/ensure-dsh.sh."""
    text = script.read_text(encoding="utf-8")
    npm_rows, dsh_rows = [], []
    npm_block = _extract_block(text, "NPM_PACKAGES", script)
    for line in _parse_rows(npm_block, script, "NPM_PACKAGES"):
        parts = line.split("|")
        # NPM_PACKAGES `dir` values are relative to the npm/ face.
        npm_rows.append({
            "dir": f"npm/{parts[0]}",
            "sha": parts[2],
            "table": "ensure-dsh.sh:NPM_PACKAGES",
        })
    dsh_block = _extract_block(text, "DSH_PACKAGES", script)
    for line in _parse_rows(dsh_block, script, "DSH_PACKAGES"):
        name, ver, sha = line.split("|")
        dsh_rows.append({
            "dir": f"dsh/{name}@{ver}",
            "sha": sha,
            "table": "ensure-dsh.sh:DSH_PACKAGES",
        })
    return npm_rows, dsh_rows


def parse_ensure_dsh_tests_rows(script: Path) -> list[dict]:
    """ensure_npm / ensure_npm_registry pin rows of the tests closure."""
    text = script.read_text(encoding="utf-8")
    pattern = re.compile(
        r'^ensure_(npm|npm_registry)\s+"([^"]+)"\s+"([^"]+)"'
        r'\s+"([0-9a-f]{64})"',
        re.M,
    )
    rows = []
    for match in pattern.finditer(text):
        kind, name, ver, sha = match.groups()
        # ensure_npm takes the bare @deepseek-ai name; ensure_npm_registry
        # the full registry name.
        full = f"@deepseek-ai/{name}" if kind == "npm" else name
        rows.append({
            "dir": f"npm/{full}@{ver}",
            "sha": sha,
            "table": f"ensure-dsh-tests.sh:ensure_{kind}",
        })
    if not rows:
        raise SystemExit(
            f"supply-audit: no ensure_npm/ensure_npm_registry rows in {script}"
        )
    return rows


def enumerate_vendored_dirs(npm_root: Path, dsh_root: Path) -> set[str]:
    """Every on-disk package dir as `<face>/<name>@<ver>` under the root."""
    found: set[str] = set()
    for root, prefix in ((npm_root, "npm"), (dsh_root, "dsh")):
        found.update(_dirs_under(root, prefix))
    return found


def _dirs_under(root: Path, prefix: str) -> set[str]:
    found: set[str] = set()
    if not root.is_dir():
        return found
    for entry in sorted(root.iterdir()):
        if not entry.is_dir():
            continue
        if entry.name.startswith("@"):
            found.update(_scoped_dirs(entry, prefix))
        else:
            found.add(f"{prefix}/{entry.name}")
    return found


def _scoped_dirs(scope_dir: Path, prefix: str) -> set[str]:
    found: set[str] = set()
    for sub in sorted(scope_dir.iterdir()):
        if sub.is_dir():
            found.add(f"{prefix}/{scope_dir.name}/{sub.name}")
    return found


def git_revision(repo: Path) -> str:
    try:
        done = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repo,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "unknown"
    return done.stdout.strip()
