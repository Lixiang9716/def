# Agent Note: dev/ios and dev/android stop re-fetching the vendored closure, and both iOS checkers always report

Status: implemented
Related: D6, D13

## Problem

Three small, independent defects on the same two workflow files.

**The vendored closure was re-downloaded on every run, by six workflows.**
`runtime/spike/vendor/ensure.sh` fetches the pinned quickjs-ng sources and
`ensure-dsh.sh` fetches the upstream DSH closure — 21 dsh packages and 5 npm
tarballs, each `curl`ed and sha256-checked — and both trees are **untracked by
design** (D6: the content gates must never judge verbatim upstream code), so
nothing in git can supply them. The callers are `dev/ios`, `dev/android`,
`dev/harmonyos`, `release/ios`, `release/android` and `release/harmonyos`, and
not one of them cached the result. Every run paid the same network cost for the
same bytes.

**`actions/setup-java@v4` announces its own deprecation on every dev/android
run**: `##[warning]setup-java v4 is deprecated and will no longer receive
updates. Please migrate to actions/setup-java@v5.` A permanent warning on a
green run is a warning nobody reads.

**The iOS step that runs the two m1 checkers could only report one of them.**
Both `node tools/e2e/check.mjs` invocations sat bare under `set -euo pipefail`
in the `spike-run` step, so a FAILING FIRST checker aborted the step and the
second scenario produced **no verdict and no JUnit XML at all** — the exact
shape of dishonesty this pipeline was recently cleaned of, where a red run
tells you less than it appears to. Reproduced in isolation on the committed
capture (first checker fails, second passes) against `main`'s file: exit 1,
`m1-spike/verdict.json` + `m1-spike/verdict.xml` present, `m1-carrier/verdict.*`
**missing**, and only one `e2e: FAIL` line in the log. The carrier scenario's
state was simply unknown, and the artifact upload could not carry it.

## Decision

**Cache the vendored closure on the pin scripts themselves.** Both files gain an
`actions/cache` step, placed immediately before the step that materializes the
closure, restoring `runtime/spike/vendor/quickjs-ng`, `runtime/spike/vendor/dsh`
and `runtime/spike/vendor/npm`, keyed
`vendor-closure-${{ runner.os }}-${{ hashFiles('runtime/spike/vendor/ensure.sh',
'runtime/spike/vendor/ensure-dsh.sh') }}`. The pin scripts **are** the tracked
provenance record — the commit sha, the package list and the per-tarball sha256
tables live in them and nowhere else — so any pin change changes the key, and a
key collision can only mean a pin collision. The key is written as a
single-line expression on purpose: a folded multi-line scalar can resolve to a
literal, giving a cache that never hits and quietly optimizes nothing.

Two properties of the scripts decide the rest of the design, and both were read
out of the scripts rather than assumed:

- **A missing package is fetched and verified; a present one is skipped without
  being re-hashed.** `ensure.sh`'s `have_all` and `ensure-dsh.sh`'s `have_pkg`
  test file presence only. So a partially restored tree self-heals, and the
  cache key — not a per-run hash — is the **integrity boundary**. There is
  therefore deliberately **no `restore-keys` prefix fallback**: a fallback would
  restore a tree fetched under a *different* pin set, and the scripts would then
  accept it as present, which is precisely the stale-pin failure the pins exist
  to prevent. A pin change is a cache miss, and the fetch+verify path runs.
- **The DSH half and the quickjs-ng half are materialized at different points
  in `dev/android`** — the former by the "Materialize the vendored official web
  app" step, the latter by the Gradle `ensureSpikeVendor` task inside the APK
  step (`hosts/android/app/build.gradle.kts`). The cache step has to sit before
  both.

**`actions/setup-java` moves to `v5`** in `dev/android`, with `distribution`,
`java-version` and `cache` left byte-identical: v5's `action.yml` declares the
same three inputs and the same accepted `cache` values (`maven`, `gradle`,
`sbt`), and v5's one breaking change is its own node runtime, which
`ubuntu-latest` satisfies.

**Both iOS checkers now always run, and both exit codes are accumulated.**
`rc=0` before the first invocation, `|| rc=1` on each, a non-zero exit for the
step when either failed, and an `::error::` line that says both checkers ran and
where to look. Nothing is absorbed — no `continue-on-error` anywhere — and the
step still gates. The observable effect, measured on the same failing pair:
exit 1, all four artifacts present (`m1-spike/verdict.json` FAIL,
`m1-carrier/verdict.json` PASS, both `verdict.xml`), both verdict lines in the
log. The green path was exercised too: with a log that satisfies both
manifests, the step exits 0 with both PASS verdicts.

## Alternatives considered

**`restore-keys` on a prefix, so a pin bump still restores most of the tree.**
Rejected, and this is the one decision a maintainer will want to re-open: it is
free speed on paper, and it is unsafe here because a present package is not
re-verified. Making a restored tree verifiable is not cheap either, and the
reason is in the scripts: each tarball is deleted after extraction
(`rm -f "$tmp"`), so the only artifact that ever carried a verified sha256 is
gone by the time a later run could check the tree against it — re-verifying
would mean re-downloading every tarball, i.e. the exact cost the cache exists to
remove. Hashing the extracted tree is not a substitute: it is 12.9 MB over 1115
files (measured locally: 0.26 s) and there is no post-extraction manifest to
compare the result to, so it would bind the cache to bytes nothing ever
validated. The key itself therefore carries the pin-binding, and a pin change
is a miss.

**Cache the whole `runtime/spike/vendor/` directory.** Rejected: the three
leaves are the ones both scripts write, and naming them keeps a future sibling
tree (a fourth vendor family) out of a cache that would then be saved under a
key that does not decide its bytes.

**Key on a hash of the extracted tree.** Rejected as circular: the tree is what
the cache is for, and hashing it requires having it.

**Rebuild the checker pair as `set +e` around both invocations, then `test`
on captured codes, or wrap them in a helper script.** Rejected — `set -e` is
load-bearing for the rest of that step (simctl ops, the readiness probe), and a
new script in `tools/e2e/` is a new surface to review for a two-line
accumulation. `|| rc=1` keeps the step's error semantics intact and is the
smallest change that makes both verdicts unconditionally produced.

**Add `continue-on-error: true` to the checkers step so both always run.**
Refused outright: that is absorption, and this pipeline had just reached zero
absorbed failures. The step must gate.

**Leave the checkers step alone** — `check.mjs` writes its `--out` and `--junit`
*before* exiting, so a failing first checker does produce its own artifacts.
Rejected: it produces exactly one scenario's artifacts, and the second
scenario's state — pass or fail — is unobservable from the run. "Half the
verdict" is the defect, not "no verdict".

**Migrate every `actions/*` pin at once (`checkout@v4`, `cache@v4`,
`setup-node@v4`, `upload-artifact@v4`).** Rejected as scope creep: the
deprecation warning was measured for `setup-java` only, and each bump is a
runner-runtime change that deserves its own verification rather than a sweep.

## Consequences

The first run after merge is a cache miss and re-fetches (it then populates the
cache); the saving is measurable from the second run onward. Neither the hit
rate nor the wall-clock delta is measured in CI yet — this note does not claim a
number it did not collect, and the `dev/ios` and `dev/android` step durations
from the Actions API after a few runs are the measurement that would settle it.
