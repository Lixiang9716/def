# Agent Note: the version stream's iOS face: xcodegen owns Info.plist, project.yml is the source

Status: implemented
Related: D12, #655

## Problem

The first v0.0.3 tag attempt (2026-10-23) was refused by
`check-tag-version.sh` on all three release workflows: the tag said v0.0.3
but `hosts/ios/App/Info.plist` said 0.1.0 — a file the bump had written
0.0.3 to not forty minutes earlier, and which the bump commit did not
contain at all. Reproduced live: write 0.0.3 into the plist, run
`gov run`, watch the file revert with a fresh mtime while 27 gates pass.

The mechanism: `hosts/ios/Tools/gen.sh` runs xcodegen, and xcodegen
REGENERATES `App/Info.plist` from the `info.properties` block in
`hosts/ios/project.yml` — where #655 (the def identity round) had pinned
`CFBundleShortVersionString: "0.1.0"`, unreconciled with the version
stream. Any gate or build that runs gen.sh silently reverts a plist-side
bump. The version stream had two writers for one field, and the generated
one won every time after 2026-10-22. Nothing caught it until the tag
guard — the exact drift `check-tag-version.sh` exists to catch, and it
caught it (three failures, zero bad packages shipped, Release never
created).

## Decision

The version stream's iOS face moves to the generation source:

- `bump-version.py`'s EDITS table writes `hosts/ios/project.yml`
  (CFBundleShortVersionString) instead of the generated plist;
- `check-tag-version.sh` reads project.yml — the guard guards SOURCES;
- `project.yml` says 0.0.3 (this round), and `gen.sh` regenerated
  `App/Info.plist` to follow;
- `doc/release.md` + zh: the version-stream table and the bump step name
  project.yml with the xcodegen relationship stated.

## Alternatives considered

**Teach the bump to write BOTH the plist and project.yml**: rejected —
the plist is a generated artifact; writing it by hand recreates the
two-writers race the moment gen.sh runs, and the closures gate's claim is
"gen.sh exits 0", not bytes in the index, so nothing would re-sync it
before the next tag attempt either.

**Stop committing App/Info.plist**: rejected for this round — it is
tracked today and other tooling may read it; regenerating and committing
the follower keeps the tree self-consistent. (Separating generated files
from the index is the generated-store workstream's call, not a release
hotfix's.)

**Leave project.yml at 0.1.0 and release as 0.1.0**: rejected — plan.md
§2.1 (updated 2026-10-23) pins the next tag as v0.0.3, and 0.1.0 entered
project.yml as an unreconciled hand-edit, never a version-stream decision.
