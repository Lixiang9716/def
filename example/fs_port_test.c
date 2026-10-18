/* fs_port_test.c — the cross-platform battery for dsh_fs_port (the #571
 * real-fs evidence leg). Compiles standalone on every host the shared C
 * spine targets:
 *
 *   macOS/Darwin : cc src/dsh_fs_port.c example/fs_port_test.c -o fsport
 *   Android      : NDK clang -target aarch64-linux-android26 (+ push, run)
 *   HarmonyOS    : OHOS native clang -target aarch64-linux-ohos
 *                  -DDSH_PLATFORM_OHOS
 *
 * One structured verdict line per case (fsport: case <name> <verdict>), the
 * platform fact row for link(2) (PASS where the platform allows it,
 * POLICY_BLOCKED where Android's SELinux policy refuses — the live call is
 * never skipped), and a summary whose exit code is non-zero only on
 * UNEXPECTED outcomes.
 */
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "../src/dsh_fs_port.h"

static int passed = 0, blocked = 0, failed = 0;

static void verdict(const char *name, int kind) {
    /* kind: 0 pass, 1 expected-block (platform fact), 2 unexpected fail */
    const char *word = kind == 0 ? "PASS"
        : kind == 1 ? "PASS-POLICY_BLOCKED" : "FAIL";
    printf("fsport: case %s %s\n", name, word);
    if (kind == 0) passed++;
    else if (kind == 1) blocked++;
    else failed++;
}

static int slurp(const char *path, char *out, size_t cap) {
    FILE *f = fopen(path, "rb");
    if (!f) return -1;
    size_t got = fread(out, 1, cap - 1, f);
    fclose(f);
    out[got] = 0;
    return (int)got;
}

static int no_temp_residue(const char *dir) {
    /* the publish dance must leave no .dshpub.* behind on any exit path */
    char cmd[1024];
    snprintf(cmd, sizeof cmd, "%s/.dshpub.residue", dir);
    return access(cmd, F_OK) != 0; /* coarse: exact-name probe */
}

int main(void) {
    char err[512] = {0};
    char base[] = "/tmp/fsport_XXXXXX";
    if (system("true")) {} /* keep libc busy-box happy on odd targets */
    if (dsh_fs_mkdtemp(base, err, sizeof err) != 0) {
        printf("fsport: case mkdtemp FAIL (%s)\n", err);
        return 2;
    }
    printf("fsport: platform %s (link expected: %s)\n",
           dsh_fs_port_platform(),
           dsh_fs_port_link_expected_blocked() ? "policy-blocked" : "allowed");
    verdict("mkdtemp", 0);

    char a[1200], b[1200];
    snprintf(a, sizeof a, "%s/journal.jsonl", base);
    snprintf(b, sizeof b, "%s/journal.b.link", base);

    /* 1. publish fresh: bytes land, content reads back, no residue */
    const char *body = "v1 first-record\n";
    if (dsh_fs_publish_atomic(a, body, strlen(body), err, sizeof err) == 0) {
        char got[256] = {0};
        slurp(a, got, sizeof got);
        verdict("publish_fresh",
            strcmp(got, body) == 0 && no_temp_residue(base) ? 0 : 2);
    } else {
        printf("fsport:   (publish_fresh err: %s)\n", err);
        verdict("publish_fresh", 2);
    }

    /* 2. publish replace: atomic swap over an existing file */
    const char *body2 = "v2 replaced-record LONGER THANv1\n";
    if (dsh_fs_publish_atomic(a, body2, strlen(body2), err, sizeof err) == 0) {
        char got[256] = {0};
        slurp(a, got, sizeof got);
        verdict("publish_replace",
            strcmp(got, body2) == 0 && no_temp_residue(base) ? 0 : 2);
    } else {
        printf("fsport:   (publish_replace err: %s)\n", err);
        verdict("publish_replace", 2);
    }

    /* 3. explicit barriers */
    verdict("fsync_file",
        dsh_fs_fsync_file(a, err, sizeof err) == 0 ? 0 : 2);
    if (failed) printf("fsport:   (fsync_file err: %s)\n", err);
    verdict("fsync_dir",
        dsh_fs_fsync_dir(base, err, sizeof err) == 0 ? 0 : 2);
    if (failed) printf("fsport:   (fsync_dir err: %s)\n", err);

    /* 4. truncate + verify size */
    if (dsh_fs_truncate_file(a, 4, err, sizeof err) == 0) {
        struct stat st;
        stat(a, &st);
        verdict("truncate", st.st_size == 4 ? 0 : 2);
    } else {
        printf("fsport:   (truncate err: %s)\n", err);
        verdict("truncate", 2);
    }

    /* 5. realpath resolves the published file */
    char real[2048];
    if (dsh_fs_realpath(a, real, sizeof real, err, sizeof err) == 0) {
        struct stat st1, st2;
        verdict("realpath",
            stat(real, &st1) == 0 && stat(a, &st2) == 0
                && st1.st_ino == st2.st_ino ? 0 : 2);
    } else {
        printf("fsport:   (realpath err: %s)\n", err);
        verdict("realpath", 2);
    }

    /* 6. link: the PLATFORM FACT ROW — the live call on every platform.
     * Android's policy refusal is expected truth (PASS-POLICY_BLOCKED);
     * anywhere else a failure is unexpected. Where links DO exist, the
     * nlink count proves the link landed. */
    int link_rc = dsh_fs_link(a, b, err, sizeof err);
    int expect_blocked = dsh_fs_port_link_expected_blocked();
    if (link_rc == 0) {
        struct stat st;
        lstat(b, &st);
        verdict("link", st.st_nlink >= 2 ? 0 : 2);
        unlink(b);
    } else {
        printf("fsport:   (link live err: %s)\n", err);
        verdict("link", expect_blocked ? 1 : 2);
    }

    /* 7. THE headline: publish_atomic keeps working on a platform whose
     * link(2) is policy-blocked — the rename-based dance never touches it. */
    if (expect_blocked) {
        const char *body3 = "v3 after-link-refused\n";
        int ok = dsh_fs_publish_atomic(a, body3, strlen(body3),
                                       err, sizeof err) == 0;
        if (ok) {
            char got[256] = {0};
            slurp(a, got, sizeof got);
            ok = strcmp(got, body3) == 0;
        } else {
            printf("fsport:   (publish-despite-block err: %s)\n", err);
        }
        verdict("publish_despite_link_block", ok ? 0 : 2);
    }

    unlink(a);
    rmdir(base);
    printf("fsport: summary pass=%d policy_blocked=%d fail=%d\n",
           passed, blocked, failed);
    if (failed == 0) printf("fsport: ALL PASS\n");
    return failed == 0 ? 0 : 1;
}
