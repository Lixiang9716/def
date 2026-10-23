# Agent Note: the version-stream gate — the four sources agree on every run, not only at tag time

Status: implemented
Related: D20, #669, #671

## Problem

The version stream had two writers for the iOS field (the bump writes the
generated plist; xcodegen regenerates it from project.yml), and the drift
survived **three green `gov run` invocations and two merged PRs** before
`check-tag-version.sh` refused it at tag time — the worst possible place to
learn it, after the release workflows had already been triggered. The
per-run gates had no opinion about the version files because no gate read
all four.

## Decision

`packages/release/check-version-stream.sh` + the `version-stream` gate:
version.txt must equal project.yml's CFBundleShortVersionString, the
Android versionName, and the HarmonyOS versionName on **every default DAG
run**. The rule-6 rejection proof rides the gate command (`--self-test`
builds a fixture whose project.yml drifted and requires the checker to
name it — the proof caught a real bug in the checker's first draft: a
`ROOT=.` assignment clobbered the fixture root, so the drifted fixture
passed until the self-test flagged it).

## Alternatives considered

**Extending check-tag-version.sh instead of a new gate**: rejected — the
tag guard runs only in release workflows at tag time; the entire point is
moving the verdict to PR time. **A pre-commit hook**: rejected — the drift
arrives through whole-tree operations (gen.sh inside any gate), not only
through commits. **Hand discipline + issue #671 left open**: rejected by
the owner's standing rule that any promise a command can check is a gate.

## Consequences

A #669-class drift now dies at the first `gov run` with every mismatch
named. The gate re-anchors nothing by itself — the four-source parse is
duplicated from check-tag-version.sh deliberately (refactoring the release
path's guard mid-train was not worth the dedup); the two scripts' next
drift can merge them.
