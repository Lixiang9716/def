# The cross-platform fs portability layer + battery (#571 real-fs evidence leg)

Status: implemented
Related: D5 (pre-contract, deliberately), #571

## Problem

The #571 real-fs path needs POSIX capabilities the gateway contract lacks
(atomic durable publish, fsync barriers, truncate). Before proposing
contract primitives, the platforms' actual behavior had to be pinned with
live evidence — especially Android, where SELinux policy (measured on the
API-35 emulator: root links, shell and app domains do not) denies link(2)
for app domains on their own files since Android M.

## Decision

`src/dsh_fs_port.{h,c}` + `example/fs_port_test.c`:

- ONE stable C surface (`dsh_fs_publish_atomic`, `dsh_fs_fsync_file/dir`,
  `dsh_fs_truncate_file`, `dsh_fs_link`, `dsh_fs_mkdtemp`,
  `dsh_fs_realpath`), 0/-1 + named reason strings.
- Compile-time macro dispatch (`__OHOS__`/`__ANDROID__`/`__APPLE__`/
  `__linux__`) carrying the only true per-platform delta: the link(2)
  EXPECTATION fact (Android = policy-blocked) and the platform id row.
- publish_atomic is RENAME-BASED everywhere by design: same-dir mkstemp,
  write, fsync, rename, DIRECTORY fsync. Hardlink publishing is never the
  portable path — Android's policy wall made the design choice.
- The battery prints one structured verdict line per case; the link row is
  a live call on every platform (PASS where allowed, PASS-POLICY_BLOCKED
  where refused — never skipped); exit non-zero only on UNEXPECTED
  outcomes.

Verified: Darwin 8/8 PASS (link allowed, fsync(dir) works on APFS);
Android emulator 8 pass + 1 policy-blocked (live EPERM recorded) —
including `publish_despite_link_block` PASS, the headline: the rename
dance keeps working where link(2) is policy-refused. OHOS aarch64 musl
cross-compiles clean (compile-verified; runtime rides the next device leg).

NOT wired into the built hosts yet (D5): nothing links this file until
the fsPublishAtomic/fsSync contract proposal (v1.11.0) lands; the battery
compiles it standalone per platform. The CMake wiring rides the primitive
PR.

## Alternatives considered

- link-based publish everywhere (the backend's own dance): dead on
  Android by policy — measured, not assumed.
- Java/Kotlin + Swift + ArkTS per-host implementations: three writes for
  one capability; the shared C spine already compiles on all three, and
  POSIX deltas are one macro block.
- Wiring into src/CMakeLists.txt now: rejected — dead binary weight until
  the contract consumer exists; D5 keeps the seam proposal-first.

## Consequences

The v1.11.0 proposal now ships with measured platform facts: rename-based
publish is the portable design, link is a documented platform-truth row,
fsync(dir) is available on the two run-verified platforms.
