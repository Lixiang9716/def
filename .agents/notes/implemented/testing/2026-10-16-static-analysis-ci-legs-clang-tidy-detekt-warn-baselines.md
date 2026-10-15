# Agent Note: static-analysis CI legs — clang-tidy over src/, detekt over the Android Kotlin (warn-level baselines)

Status: implemented
Related: D6 (upstream discipline, for the vendored-tree exclusion)

## Problem

The two native surfaces shipped compiled but never statically inspected:
the C spine (`src/dsh_runtime_host.c`, `dsh_socket.c`, `dsh_wasm.c` + their
headers) is built by three platform toolchains, and the Android host Kotlin
(53 files under `hosts/android/app/src`) is built by Gradle — but no CI leg
looks for the defect classes the compilers stay quiet about (uninitialized
reads, dead stores, tainted bounds, swallowed exceptions, thrown-from-finally,
...). The test-hardening program named this gap as row 9 (doc/test-coverage.md:
"Static analysis: clang-tidy (src), detekt (Kotlin) — planned, CI legs").
Compiling clean is not evidence of analyzing clean, and a check that only a
local ritual runs is prose, not a gate.

## Decision

`.github/workflows/static-analysis.yml` — three jobs, warn-level baseline
discipline ("existing debt recorded, new violations zero-tolerance"):

- **clang-tidy** — `tools/static-analysis/clang-tidy.sh` scans exactly the
  three spine TUs with the defect-class check set in `.clang-tidy`
  (`clang-diagnostic-*`, `clang-analyzer-*`, `bugprone-*`, `performance-*`,
  `portability-*`; minus `bugprone-easily-swappable-parameters`; no
  readability/modernize style classes). Compile commands come from a
  configure-only `cmake -B build-tidy -DCMAKE_EXPORT_COMPILE_COMMANDS=ON`
  (cmake/Vendor.cmake materializes the engine pins at configure time; no
  build needed). The analysis version is pinned to the distro's
  `clang-tidy-18` (ubuntu-24.04 default apt set).
- **detekt** — `tools/static-analysis/detekt.sh` scans
  `hosts/android/app/src` with detekt-cli **1.23.8, sha256-pinned and
  verified on every run** (the gov.yml actionlint/shellcheck install
  pattern), style-class rulesets off (config:
  `tools/static-analysis/detekt-config.yml` — potential-bugs / exceptions /
  performance / coroutines keep detekt defaults).
- **Baselines** — `baselines/clang-tidy.txt` (normalized `file:line
  [check-id]`, LC_ALL=C sorted) and `baselines/detekt.xml` (detekt-native
  signatures). `check` mode fails ONLY on findings absent from the baseline;
  stale entries are informational; `gen` mode regenerates. Both are generated
  by this workflow in the same pinned toolchain that gates them — never by
  hand — so a toolchain bump is a deliberate pin change, not drift between
  the version that produced the baseline and the one that enforces it.
- **Bootstrap** — a baseline-less tree fails loud (red legs, exit 2), but the
  `bootstrap-baselines` job detects the absence, generates both baselines as
  artifacts in the pinned toolchain, and the baseline lands as a commit.
  Dispatch-driven regen (`update_baselines`) becomes the path after merge
  (workflow_dispatch only addresses default-branch workflows, so the very
  first run always arrives as a pull_request).

Both legs already proved their rejection case locally (rule 6): an injected
`ThrowingExceptionFromFinally` Kotlin probe and an injected unused-variable
C probe each flipped the respective leg red with the finding named, and both
went green again on revert.

## Alternatives considered

- **Gradle detekt plugin** (detekt wired into hosts/android/app/build.gradle.kts):
  rejected — it mutates a shared build file outside this item's file face
  while nine hardening legs land in parallel, and the standalone pinned jar
  gives the same findings with the supply-chain pin in our own script.
- **Line-free baseline matching** (file+check counts, or file+check pairs):
  rejected — counts miss a same-class remove+add in one file, and pairs miss
  any added occurrence of an already-present class; line-exact diffs keep the
  red ⇔ strictly-new-violation contract. The cost (a line shift above a
  finding reds the leg until a regen) is bounded: the spine is three stable
  files, and the remedy is one command plus a commit.
- **Missing baseline = advisory green**: rejected outright — that is the
  vacuous-gate trap (delete the baseline, get green forever); absence fails
  loud and the bootstrap job exists to make that state self-healing.
- **llvm@18 via Homebrew for the local baseline**: rejected — findings also
  depend on the analyzed libc headers (glibc vs macOS SDK), so only the CI
  environment (ubuntu-24.04 + clang-tidy-18 + glibc) is authoritative for
  what CI will flag.

## Consequences

src/ and the Android Kotlin now have a defect-class net that never trusted
a self-report: new violations red the PR, existing debt is a visible,
diffable baseline. The committed baselines are the first-run inventory of
the pinned toolchain itself (see baselines/clang-tidy.txt and
baselines/detekt.xml; the local mechanics probe with a newer clang surfaced
57 spine findings including `clang-analyzer-security.ArrayBound` and
`clang-analyzer-optin.taint.GenericTaint` — the CI-pinned clang-tidy-18
inventory is what landed). The baselines will need a regen whenever
src/Kotlin lines move; `gh workflow run static-analysis.yml -f
update_baselines=true` + commit the artifacts is the whole ritual.
