/* dsh_fs_port.h — the cross-platform durable-filesystem portability layer.
 *
 * The STABLE upper surface the #571 real-fs work builds on: one set of
 * POSIX-backed capabilities with per-platform dispatch in dsh_fs_port.c
 * (compile-time macros — see the platform block there). Every function is
 * 0 on success, -1 on failure with a human-readable reason in `err`.
 *
 * The atomicity model is RENAME-BASED on every platform by design:
 * dsh_fs_publish_atomic() writes a same-directory temp, fsyncs it, rename(2)s
 * it over the target, then fsyncs the DIRECTORY so the rename itself is
 * crash-durable. Hardlink publishing (the jsonl backend's link+rm dance) is
 * deliberately NOT the portable path: Android SELinux policy denies link(2)
 * for app domains on their own files since M (measured live on the API-35
 * emulator, 2026-10-18: root links, shell and untrusted_app do not), while
 * rename(2) is allowed everywhere. dsh_fs_link() still exists — it reports
 * the platform truth live so the battery records the fact row.
 *
 * NOT a gateway primitive yet (D5): nothing in the built hosts links this
 * file until the contract proposal (fsPublishAtomic / fsSync, v1.11.0)
 * lands; the battery in example/fs_port_test.c compiles it standalone for
 * macOS/Darwin (cc), Android (NDK clang), and HarmonyOS (OHOS native
 * clang), which is why it stays out of src/CMakeLists.txt for now.
 *
 * Usage rules (match the C host's serial discipline):
 *  - all paths must be absolute; the caller owns path validity
 *  - one thread: no locking inside, by design (D2)
 *  - err buffers are written only on failure; NULL err is allowed
 */
#ifndef DSH_FS_PORT_H
#define DSH_FS_PORT_H

#include <stddef.h>

/* Which platform this build compiled for (a fact row, not a branch):
 * "darwin" (iOS + the macOS CLI share the Darwin POSIX surface),
 * "android" (Bionic; link(2) is policy-blocked for app domains),
 * "ohos" (HarmonyOS native: Linux-kernel POSIX via musl),
 * "linux" (any other glibc/musl Linux). */
const char *dsh_fs_port_platform(void);

/* What this platform is EXPECTED to answer for link(2) on app-owned files:
 * 0 = works, 1 = policy-blocked (the battery treats both as truth rows,
 * never silently skipping the live call). */
int dsh_fs_port_link_expected_blocked(void);

/* The durability dance: temp in the target's directory -> write -> fsync ->
 * close -> rename(temp, path) -> fsync(dir). No temp residue on any exit
 * path. `path` must be absolute; its parent directory must exist. */
int dsh_fs_publish_atomic(const char *path, const void *bytes, size_t len,
                         char *err, size_t errcap);

/* Explicit barriers: fsync one file by path / one directory by path (the
 * directory open uses O_DIRECTORY where the platform defines it). */
int dsh_fs_fsync_file(const char *path, char *err, size_t errcap);
int dsh_fs_fsync_dir(const char *path, char *err, size_t errcap);

/* Truncate a file to `len` bytes (ftruncate on an opened handle). */
int dsh_fs_truncate_file(const char *path, long long len,
                         char *err, size_t errcap);

/* Hardlink two paths. Live call on every platform INCLUDING ones that
 * policy-refuse it: the failure reason names the errno, so the caller (the
 * battery, later the gateway) records the platform fact. Non-portable for
 * publishing — see the header top. */
int dsh_fs_link(const char *oldpath, const char *newpath,
                char *err, size_t errcap);

/* mkdtemp(3) with a plain-errno reason on failure. `tmpl` must end in
 * XXXXXX and is rewritten in place on success, POSIX style. */
int dsh_fs_mkdtemp(char *tmpl, char *err, size_t errcap);

/* realpath(3) into `out`. */
int dsh_fs_realpath(const char *path, char *out, size_t outcap,
                    char *err, size_t errcap);

#endif /* DSH_FS_PORT_H */
