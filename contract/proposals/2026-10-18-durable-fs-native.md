# Proposal: the durable-fs primitives — fsPublishAtomic + fsSync (v1.11.0 candidate)

> **Status: ADOPTED 2026-10-19 — frozen into [primitives.md](../primitives.md)
> v1.11.0 (§4, "the durable-fs primitives").** This file is the rationale
> record. The fold's two shape deltas over this draft: the `bytesB64`
> parameter froze as §3's `bytes: Uint8Array` (base64 is the bridge wire
> encoding, not the contract shape), and the result is `{ written }` mirroring
> `fsWrite` (the draft spelled it `{ bytes: n }`), with no empty `opts`.
> English | [简体中文](2026-10-18-durable-fs-native.zh.md)

## Motivation

Issue #571 established that the vendored jsonl session backend's durability
contract rides on a write path that fails silently once the volume is full —
the dsh-mobile fs shims' best-effort disk mirror swallows ENOSPC, and the
backend (both the pinned 0.1.6-alpha.2 and the newest 0.2.1-rc.2, dist-read)
propagates errors faithfully but never sees one. The real-fs fix needs two
POSIX-grade capabilities the frozen contract lacks: an atomic durable
publish and an explicit durability barrier.

The evidence leg landed as PR #587 (`src/dsh_fs_port.{h,c}` +
`example/fs_port_test.c`): a unified C surface with per-platform macro
dispatch, battery-verified on Darwin (8/8), the Android API-35 emulator
(8 pass + 1 live `PASS-POLICY_BLOCKED`), and OHOS cross-compile. Two facts
from that battery shape this proposal:

1. **Android SELinux policy denies `link(2)` for app domains on their own
   files** (Android M+, policy text: "Do not allow untrusted_app to hard
   link to any files"; measured: root links, shell and app domains do not).
   The jsonl backend's link-based publish dance is therefore dead on
   Android — publish must be RENAME-based.
2. `fsync(2)` on files AND directories works on every platform we can run
   on (Darwin measured; Android expected via public APIs; OHOS via the C
   spine). Directory fsync after rename is the crash-durability of the
   rename itself — the part every naive implementation forgets.

## The primitives (two, additive)

### 1. `fsPublishAtomic`

```
fsPublishAtomic(scope, path, bytesB64, opts?) → { bytes: n }
```

Writes `bytesB64` to `path` as ONE atomic durable publish: same-directory
temp file → write → fsync(file) → rename(temp, path) → fsync(directory).
On any failure the target is untouched and no temp residue remains. The
whole dance runs host-side as one step — the atomicity of the sequence is
the point, which is why it is NOT composed from smaller primitives.

Rejections follow §3: `invalid` (path escapes scope, malformed bytes),
`denied` (scope not granted), `io` (write/fsync/rename failure — the
reason string names the failing step). Audit per §6: primitive name,
verdict, byte count — never payload bytes.

### 2. `fsSync`

```
fsSync(scope, path, opts { kind: 'file' | 'dir' }) → {}
```

Explicit durability barrier for one file or one directory by path. The
directory open uses the platform's directory-capable API (see the mapping
below). Same rejection grammar.

## Implementation strategy: native platform APIs per host

Deliberately the established gateway pattern — each host speaks its native
idiom, the C spine stays the dispatch bridge (the CLI host keeps the
#587 C implementation as its native idiom):

| Face | iOS | Android | HarmonyOS | CLI |
|---|---|---|---|---|
| publish | POSIX from Swift (battery-verified) | temp + `FileChannel.force()` + `File.renameTo()` — **link never called** (policy evidence) | `fs.write` + `fs.fsync` + `fs.rename` (@ohos.file.fs) | `dsh_fs_publish_atomic` (#587) |
| sync file | `fsync(2)` | `FileChannel.force()` | `fs.fsync` | #587 |
| sync dir | `fsync(dirfd)` | `android.system.Os.open` + `Os.fsync` (API 21+, public API) | `fs.fsync` on a directory handle where the SDK allows; else the C spine's `fsync(dirfd)` (gateway_smoke.cpp already compiles there) | #587 |

The Android directory-sync cell uses `android.system.Os` — a public Android
API, not a reach-around: it is the platform's documented POSIX surface for
exactly this class of need.

## Non-goals

- **No `link` primitive.** Measured dead on Android for app domains; a
  contract primitive that cannot be served on a first-class host is a
  defect of the contract. RENAME-based publish is equivalent on every
  POSIX filesystem we target.
- **No raw `fsync`/`truncate`/`mkdtemp` syscall mirrors.** The contract
  exposes durable intents, not POSIX plumbing; the gap analysis (#571
  thread) showed intent-level primitives cover the backend's real needs.
- **No append-durable primitive yet.** The jsonl backend's append path can
  be served by publish (whole-artifact rewrite) at first; an
  `fsAppendDurable` is deferred until a consumer proves the need.
- **No change to the shim/VFS world.** The session-persistence real-fs
  mount (the consumer of these primitives) is a separate follow-up behind
  its own boot-row gate.

## Alternatives considered

- **One shared C implementation (the #587 layer) wired into every host**:
  rejected as the primitive's implementation — the deltas are policy-level
  (Android SELinux) and API-level (each platform's directory-fsync face),
  and each host already owns a GatewayCore dispatch + audit + scope-check
  layer that a native implementation inherits for free. The #587 C layer
  remains the CLI host's implementation and the cross-platform battery.
- **link-based publish everywhere** (the backend's own dance): dead on
  Android by policy — measured, not assumed (#587 battery).
- **Composing publish from existing `fsWrite` + `fsRename` from JS**: the
  atomicity of the temp+fsync+rename+dirfsync sequence cannot be
  guaranteed across two gateway round-trips; the dance must be one host
  step.

## Evidence

- fs-port battery: PR #587 (merged) — Darwin 8/8; Android 8 pass + 1 live
  policy-blocked row including `publish_despite_link_block` PASS; OHOS
  aarch64 musl cross-compile clean.
- Root-cause chain on the silent loss: #580 (sentinel), #584 (watermark
  guard), and the #571 comment thread (the fs-shim mirror swallows ENOSPC;
  the backend dist-read proves no swallowing of its own).
