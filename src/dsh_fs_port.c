/* dsh_fs_port.c — per-platform dispatch for the durable-fs portability
 * layer. The interface contract lives in dsh_fs_port.h; the deltas between
 * platforms are small enough to live in one compile-time block each:
 *
 *   __OHOS__/DSH_PLATFORM_OHOS : HarmonyOS native (musl, Linux kernel).
 *   __ANDROID__                : Bionic. link(2) is REFUSED by SELinux
 *                                policy for app domains on their own files
 *                                (Android M+, policy text: "Do not allow
 *                                untrusted_app to hard link to any files").
 *                                Publishing is rename-based here as
 *                                everywhere — the macro sets the EXPECTED
 *                                link fact row, it never skips the live
 *                                call.
 *   __APPLE__                  : Darwin — iOS app + the macOS CLI host
 *                                share this branch (same POSIX surface;
 *                                measured on APFS: link/fsync-dir/rename
 *                                all work inside the app container).
 *   __linux__                  : any other Linux (CI legs).
 *
 * Everything here is single-threaded by the host's serial rule (D2); no
 * locks, no fork, no signals. errno is captured immediately after each
 * failing call so the reason string names the live fact.
 */
#include "dsh_fs_port.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/types.h>

/* --- platform identification + per-platform fact constants ---------------- */
#if defined(__OHOS__) || defined(DSH_PLATFORM_OHOS)
#define DSH_FS_PORT_NAME "ohos"
#define DSH_FS_PORT_LINK_EXPECT_BLOCKED 0
#elif defined(__ANDROID__)
#define DSH_FS_PORT_NAME "android"
#define DSH_FS_PORT_LINK_EXPECT_BLOCKED 1
#elif defined(__APPLE__)
#define DSH_FS_PORT_NAME "darwin"
#define DSH_FS_PORT_LINK_EXPECT_BLOCKED 0
#elif defined(__linux__)
#define DSH_FS_PORT_NAME "linux"
#define DSH_FS_PORT_LINK_EXPECT_BLOCKED 0
#else
#error "dsh_fs_port: unsupported platform (need __OHOS__/__ANDROID__/__APPLE__/__linux__)"
#endif

#ifndef DSH_FS_PORT_LINK_EXPECT_BLOCKED
#define DSH_FS_PORT_LINK_EXPECT_BLOCKED 0
#endif

/* Directory opens: O_DIRECTORY exists on Linux/Bionic/musl and on Darwin
 * (since macOS 10.10 / iOS 8 family); guard anyway so odd toolchains
 * degrade to a plain O_RDONLY dir open, which every POSIX target accepts. */
#ifdef O_DIRECTORY
#define DSH_FS_DIR_FLAGS (O_RDONLY | O_DIRECTORY)
#else
#define DSH_FS_DIR_FLAGS O_RDONLY
#endif

const char *dsh_fs_port_platform(void) { return DSH_FS_PORT_NAME; }

int dsh_fs_port_link_expected_blocked(void) {
    return DSH_FS_PORT_LINK_EXPECT_BLOCKED;
}

/* --- shared helpers -------------------------------------------------------- */

static void dsh_set_err(char *err, size_t errcap, const char *what,
                        const char *path, int the_errno) {
    if (!err || errcap == 0) return;
    if (the_errno) {
        snprintf(err, errcap, "%s(%s): %s", what, path, strerror(the_errno));
    } else {
        snprintf(err, errcap, "%s(%s)", what, path);
    }
}

static int dsh_write_all(int fd, const void *bytes, size_t len) {
    const char *at = (const char *)bytes;
    while (len > 0) {
        ssize_t wrote = write(fd, at, len);
        if (wrote < 0) {
            if (errno == EINTR) continue;
            return -1;
        }
        at += wrote;
        len -= (size_t)wrote;
    }
    return 0;
}

/* "<dir>/.dshpub.XXXXXX" — the temp MUST share the target's directory so
 * rename(2) stays a same-filesystem atomic replace. */
static int dsh_temp_for(const char *path, char *out, size_t outcap) {
    const char *slash = strrchr(path, '/');
    size_t dirlen = slash ? (size_t)(slash - path) : 0;
    if (dirlen == 0 || dirlen + sizeof("/.dshpub.XXXXXX") > outcap) return -1;
    memcpy(out, path, dirlen);
    snprintf(out + dirlen, outcap - dirlen, "/.dshpub.XXXXXX");
    return 0;
}

/* --- the durability dance -------------------------------------------------- */

int dsh_fs_publish_atomic(const char *path, const void *bytes, size_t len,
                          char *err, size_t errcap) {
    char temp[1024];
    int saved = 0;
    if (dsh_temp_for(path, temp, sizeof(temp)) != 0) {
        dsh_set_err(err, errcap, "temp-path", path, 0);
        return -1;
    }
    int fd = mkstemp(temp);
    if (fd < 0) {
        dsh_set_err(err, errcap, "mkstemp", temp, errno);
        return -1;
    }
    if (dsh_write_all(fd, bytes, len) != 0 || fsync(fd) != 0
        || close(fd) != 0) {
        saved = errno ? errno : EIO;
        dsh_set_err(err, errcap, "write+fsync", temp, saved);
        unlink(temp);
        return -1;
    }
    if (rename(temp, path) != 0) {
        saved = errno;
        dsh_set_err(err, errcap, "rename", path, saved);
        unlink(temp);
        return -1;
    }
    char dir[1024];
    dsh_temp_for(path, dir, sizeof(dir)); /* yields "<dir>/.dshpub.XXXXXX" */
    char *last = strrchr(dir, '/');
    if (last) *last = 0; /* "<dir>" */
    char sub[256];
    if (dsh_fs_fsync_dir(dir, sub, sizeof(sub)) != 0) {
        dsh_set_err(err, errcap, "fsync-dir-after-rename", dir, 0);
        if (sub[0]) snprintf(err + strlen(err), errcap - strlen(err),
                             ": %s", sub);
        return -1;
    }
    return 0;
}

int dsh_fs_fsync_file(const char *path, char *err, size_t errcap) {
    int fd = open(path, O_RDONLY);
    if (fd < 0) {
        dsh_set_err(err, errcap, "open", path, errno);
        return -1;
    }
    if (fsync(fd) != 0) {
        dsh_set_err(err, errcap, "fsync", path, errno);
        close(fd);
        return -1;
    }
    close(fd);
    return 0;
}

int dsh_fs_fsync_dir(const char *path, char *err, size_t errcap) {
    int fd = open(path, DSH_FS_DIR_FLAGS);
    if (fd < 0) {
        dsh_set_err(err, errcap, "open-dir", path, errno);
        return -1;
    }
    if (fsync(fd) != 0) {
        dsh_set_err(err, errcap, "fsync-dir", path, errno);
        close(fd);
        return -1;
    }
    close(fd);
    return 0;
}

int dsh_fs_truncate_file(const char *path, long long len,
                         char *err, size_t errcap) {
    int fd = open(path, O_WRONLY);
    if (fd < 0) {
        dsh_set_err(err, errcap, "open", path, errno);
        return -1;
    }
    if (ftruncate(fd, (off_t)len) != 0) {
        dsh_set_err(err, errcap, "ftruncate", path, errno);
        close(fd);
        return -1;
    }
    if (fsync(fd) != 0) {
        dsh_set_err(err, errcap, "fsync", path, errno);
        close(fd);
        return -1;
    }
    close(fd);
    return 0;
}

int dsh_fs_link(const char *oldpath, const char *newpath,
                char *err, size_t errcap) {
    if (link(oldpath, newpath) != 0) {
        dsh_set_err(err, errcap, "link", newpath, errno);
        return -1;
    }
    return 0;
}

int dsh_fs_mkdtemp(char *tmpl, char *err, size_t errcap) {
    if (mkdtemp(tmpl) == NULL) {
        dsh_set_err(err, errcap, "mkdtemp", tmpl, errno);
        return -1;
    }
    return 0;
}

int dsh_fs_realpath(const char *path, char *out, size_t outcap,
                    char *err, size_t errcap) {
    char resolved[2048];
    if (realpath(path, resolved) == NULL) {
        dsh_set_err(err, errcap, "realpath", path, errno);
        return -1;
    }
    if (strlen(resolved) >= outcap) {
        dsh_set_err(err, errcap, "realpath-too-long", path, 0);
        return -1;
    }
    snprintf(out, outcap, "%s", resolved);
    return 0;
}
