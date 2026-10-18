#!/bin/sh
# Build the M1 rt desktop CLI (macOS/Linux proof run for the core rt).
# Platforms do NOT use this script — they compile the same sources through
# their own build systems (Xcode / CMake-NDK / hvigor NAPI), each after
# running external/ensure.sh first.
#
# CWD CONTRACT (phase 2): the script is SELF-LOCATING — SCRIPT_DIR is src/,
# ROOT is the repository root — and every path below is anchored to one of
# the two, so `sh src/build.sh` behaves identically from any cwd.
#
# Three variants (two logging regimes + the sanitizer-proof flavor):
#   build.sh            → runtime/dsh/build/dsh-cli          (debug: full logging)
#   build.sh --release  → runtime/dsh/build/dsh-cli-release  (-DDSH_RELEASE: the
#                         shared host injects globalThis.__DSH_RELEASE__)
#   build.sh --sanitize → runtime/dsh/build/dsh-cli-sanitize (asan+ubsan, debug
#                         regime: the memory-safety proof flavor the c-core CI
#                         leg runs the ten test-core legs against)
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# Flags first — an unknown flag must be rejected BEFORE any work (materialize,
# compile) happens, not after.
RELEASE=0
SANITIZE=0
for arg in "$@"; do
    case "$arg" in
        --release) RELEASE=1 ;;
        --sanitize) SANITIZE=1 ;;
        *) echo "src/build.sh: unknown flag '$arg' (want [--release] [--sanitize])" >&2; exit 2 ;;
    esac
done
if [ "$RELEASE" -eq 1 ] && [ "$SANITIZE" -eq 1 ]; then
    echo "src/build.sh: --release and --sanitize are mutually exclusive (one flavor per build)" >&2
    exit 2
fi
"$ROOT/external/ensure.sh"
VENDOR="$ROOT/external/quickjs-ng/0.17.0"
# Vendored zstd ($ROOT/external/ensure-zstd.sh is the pin record): compiled straight
# into the shared host — SINGLE-THREADED (no ZSTD_MULTITHREAD: one serial
# runtime thread is the constitution, D2). The globs track the vendored
# subset exactly; zstd.h/zstd_errors.h sit at the pin root, the rest of the
# headers in common/ (hence the two -I flags, the same include set every
# platform build must pass when it compiles these same host sources).
ZSTD="$ROOT/external/zstd/1.5.7"
ZSTD_SRC="$ZSTD/common/*.c $ZSTD/compress/*.c $ZSTD/decompress/*.c"
# Vendored wasm3 ($ROOT/external/ensure-wasm3.sh is the pin record): the wasm seam's
# interpreter, the same 11 TUs the CMake dsh-core target and the iOS app
# compile (src/CMakeLists.txt). Compiled into the CLI so contract v1.2.0
# wasmRun is SERVED here (example/main_cli.c smoke_wasm_run) — the security.jail leg
# attacks the import surface on the cheapest host instead of declaring it
# untestable.
WASM3="$ROOT/external/wasm3/0.9.0/source"
WASM3_SRC="$WASM3/m3_bind.c $WASM3/m3_code.c $WASM3/m3_compile.c $WASM3/m3_core.c \
 $WASM3/m3_env.c $WASM3/m3_exec.c $WASM3/m3_function.c $WASM3/m3_info.c \
 $WASM3/m3_module.c $WASM3/m3_parse.c $WASM3/m3_validate.c"
mkdir -p "$ROOT/runtime/dsh/build"
# -DZSTD_DISABLE_ASM: the vendored subset carries no huf_decompress_amd64.S,
# and on an x86_64 build (Intel Mac / x86_64 Linux) the asm dispatch would
# reference undefined HUF_*_fast_asm_loop symbols at link time — the same
# define every platform build passes.
if [ "$SANITIZE" -eq 1 ]; then
    # The sanitizer flavor: asan+ubsan over the SAME source and include set as
    # the debug build below, debug logging regime INTACT (the legs assert on
    # structured logs — -DDSH_RELEASE would strip the evidence out from under
    # them). -g -fno-omit-frame-pointer so every sanitizer report symbolizes
    # with stacks; -fno-sanitize-recover=all so a UBSan finding aborts (exit
    # nonzero) instead of warning — the CI leg is red on ANY sanitizer report.
    # Leak detection is deliberately NOT a compile flag: it is a runtime
    # option (the Linux CI leg sets ASAN_OPTIONS=detect_leaks=1; macOS ASan
    # rejects the flag — LSan is unsupported there), so the flavor itself runs
    # on both hosts. The output lands BESIDE the default binary, never over
    # it: a no-flag build keeps producing the byte-identical dsh-cli.
    # shellcheck disable=SC2086 # intentional word split (see the release leg below)
    cc -std=c11 -O1 -g -D_GNU_SOURCE -DZSTD_DISABLE_ASM=1 -DDSH_WITH_SQLITE=1 \
       -fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer \
       -I"$SCRIPT_DIR" -I"$VENDOR" -I"$ZSTD" -I"$ZSTD/common" -I"$WASM3" \
       -o "$ROOT/runtime/dsh/build/dsh-cli-sanitize" \
       "$SCRIPT_DIR/dsh_runtime_host.c" "$ROOT/example/main_cli.c" "$SCRIPT_DIR/dsh_socket.c" "$SCRIPT_DIR/dsh_wasm.c" "$SCRIPT_DIR/dsh_fs_port.c" \
       $WASM3_SRC \
       "$VENDOR/dtoa.c" "$VENDOR/libregexp.c" "$VENDOR/libunicode.c" "$VENDOR/quickjs.c" \
       $ZSTD_SRC \
       -lsqlite3 -lm
    echo "built $ROOT/runtime/dsh/build/dsh-cli-sanitize (-fsanitize=address,undefined)"
elif [ "$RELEASE" -eq 1 ]; then
    # ZSTD_SRC is a path list — word splitting is how each entry becomes its
    # own argv element for the compiler.
    # shellcheck disable=SC2086 # intentional word split
    cc -std=c11 -O1 -D_GNU_SOURCE -DDSH_RELEASE=1 -DZSTD_DISABLE_ASM=1 -DDSH_WITH_SQLITE=1 \
       -I"$SCRIPT_DIR" -I"$VENDOR" -I"$ZSTD" -I"$ZSTD/common" -I"$WASM3" \
       -o "$ROOT/runtime/dsh/build/dsh-cli-release" \
       "$SCRIPT_DIR/dsh_runtime_host.c" "$ROOT/example/main_cli.c" "$SCRIPT_DIR/dsh_socket.c" "$SCRIPT_DIR/dsh_wasm.c" "$SCRIPT_DIR/dsh_fs_port.c" \
       $WASM3_SRC \
       "$VENDOR/dtoa.c" "$VENDOR/libregexp.c" "$VENDOR/libunicode.c" "$VENDOR/quickjs.c" \
       $ZSTD_SRC \
       -lsqlite3 -lm
    echo "built $ROOT/runtime/dsh/build/dsh-cli-release (-DDSH_RELEASE)"
else
    # shellcheck disable=SC2086 # intentional word split (see the release leg above)
    cc -std=c11 -O1 -D_GNU_SOURCE -DZSTD_DISABLE_ASM=1 -DDSH_WITH_SQLITE=1 \
       -I"$SCRIPT_DIR" -I"$VENDOR" -I"$ZSTD" -I"$ZSTD/common" -I"$WASM3" \
       -o "$ROOT/runtime/dsh/build/dsh-cli" \
       "$SCRIPT_DIR/dsh_runtime_host.c" "$ROOT/example/main_cli.c" "$SCRIPT_DIR/dsh_socket.c" "$SCRIPT_DIR/dsh_wasm.c" "$SCRIPT_DIR/dsh_fs_port.c" \
       $WASM3_SRC \
       "$VENDOR/dtoa.c" "$VENDOR/libregexp.c" "$VENDOR/libunicode.c" "$VENDOR/quickjs.c" \
       $ZSTD_SRC \
       -lsqlite3 -lm
    echo "built $ROOT/runtime/dsh/build/dsh-cli"
fi
