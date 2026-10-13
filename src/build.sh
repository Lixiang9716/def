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
# Two variants, one per logging regime (the same split the platform Release
# configurations produce, so this CLI is how the strip is verified on the
# cheapest host):
#   build.sh            → runtime/dsh/build/dsh-cli          (debug: full logging)
#   build.sh --release  → runtime/dsh/build/dsh-cli-release  (-DDSH_RELEASE: the
#                         shared host injects globalThis.__DSH_RELEASE__)
# One escape hatch:
#   build.sh --no-ish   → same binaries without the iSH engine: skips
#                         ensure-ish.sh + the ish cmake sub-build and links the
#                         CLI without -ldsh_ish -lishcore (ishRun then answers
#                         the gateway's honest `unavailable` — main_cli.c's
#                         DSH_CLI_WITH_ISH face). For Linux CI: the iSH guest
#                         asm is Apple-syntax and GNU as refuses it, so no
#                         Linux runner can build the engine (c-core.yml); the
#                         ish line is awaiting removal, so the CI face has no
#                         ish at all.
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# Flags first — an unknown flag must be rejected BEFORE any work (materialize,
# compile) happens, not after.
RELEASE=0
NO_ISH=0
for arg in "$@"; do
    case "$arg" in
        --release) RELEASE=1 ;;
        --no-ish)  NO_ISH=1 ;;
        *) echo "src/build.sh: unknown flag '$arg' (want [--release] [--no-ish])" >&2; exit 2 ;;
    esac
done
"$ROOT/external/ensure.sh"
# The iSH sub-build below configures ish/ against the vendored engine and
# fails loud at cmake when the (untracked, pinned) tree is absent. This build
# embeds the engine, and ensure-ish.sh's own header says to run it before any
# build that does — a clean tree died right there (T-0218 item 2). Idempotent;
# network only on first fetch.
if [ "$NO_ISH" -eq 0 ]; then
    "$ROOT/external/ensure-ish.sh"
    # The in-process Linux userland (contract v1.3.0 `ishRun`) is the one part of
    # this build with its own build system on purpose: 400k lines of vendored C with
    # hand-written aarch64 assembly, built for macOS and for both iOS SDKs from one
    # CMake project (src/ish/CMakeLists.txt). The CLI links that output the same way
    # the app does, which is why the local E2E exercises the engine the app ships.
    ISH_BUILD="$ROOT/runtime/dsh/build/ish"
    if [ ! -f "$ISH_BUILD/libishcore.a" ] || [ ! -f "$ISH_BUILD/libdsh_ish.a" ]; then
        cmake -S "$SCRIPT_DIR/ish" -B "$ISH_BUILD" -DISH_VENDOR="$ROOT/external" >/dev/null
        cmake --build "$ISH_BUILD" --target ishcore dsh_ish -j"$(sysctl -n hw.ncpu 2>/dev/null || echo 4)" >/dev/null
    fi
    # -lz is the seam's own dependency: dsh_ish_stage() inflates the pinned guest
    # userland tarball with zlib (iOS ships libz, macOS has it in the SDK). It is
    # not part of the engine's link interface, so it has to be named here.
    ISH_LIBS="-L$ISH_BUILD -ldsh_ish -lishcore -lsqlite3 -lz -lresolv"
    # The with-ish marker main_cli.c's opt-in face compiles against (the
    # DSH_WITH_SQLITE shape: defined exactly when the host links the seam).
    ISH_DEFS="-DDSH_CLI_WITH_ISH=1"
else
    # --no-ish: the engine leaves the link with its own libs (-ldsh_ish
    # -lishcore) and its own deps (-lz -lresolv — dsh_ish_stage's zlib and
    # the guest resolver, used by nothing else in the link). -lsqlite3 STAYS:
    # the node:sqlite seam (dsh_runtime_host.c's DSH_WITH_SQLITE face) links
    # it directly; ish merely happens to ride the same line today.
    ISH_LIBS="-lsqlite3"
    ISH_DEFS=""
fi
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
if [ "$RELEASE" -eq 1 ]; then
    # ZSTD_SRC / ISH_LIBS are path/flag lists and ISH_DEFS a flag list — word
    # splitting is how each entry becomes its own argv element for the
    # compiler (ISH_DEFS empty under --no-ish expands to zero fields).
    # shellcheck disable=SC2086 # intentional word split
    cc -std=c11 -O1 -D_GNU_SOURCE -DDSH_RELEASE=1 -DZSTD_DISABLE_ASM=1 -DDSH_WITH_SQLITE=1 $ISH_DEFS \
       -I"$SCRIPT_DIR" -I"$VENDOR" -I"$ZSTD" -I"$ZSTD/common" -I"$WASM3" \
       -o "$ROOT/runtime/dsh/build/dsh-cli-release" \
       "$SCRIPT_DIR/dsh_runtime_host.c" "$ROOT/example/main_cli.c" "$SCRIPT_DIR/dsh_socket.c" "$SCRIPT_DIR/dsh_wasm.c" \
       $WASM3_SRC \
       "$VENDOR/dtoa.c" "$VENDOR/libregexp.c" "$VENDOR/libunicode.c" "$VENDOR/quickjs.c" \
       $ZSTD_SRC \
       $ISH_LIBS -lm
    echo "built $ROOT/runtime/dsh/build/dsh-cli-release (-DDSH_RELEASE)"
else
    # shellcheck disable=SC2086 # intentional word split (see the release leg above)
    cc -std=c11 -O1 -D_GNU_SOURCE -DZSTD_DISABLE_ASM=1 -DDSH_WITH_SQLITE=1 $ISH_DEFS \
       -I"$SCRIPT_DIR" -I"$VENDOR" -I"$ZSTD" -I"$ZSTD/common" -I"$WASM3" \
       -o "$ROOT/runtime/dsh/build/dsh-cli" \
       "$SCRIPT_DIR/dsh_runtime_host.c" "$ROOT/example/main_cli.c" "$SCRIPT_DIR/dsh_socket.c" "$SCRIPT_DIR/dsh_wasm.c" \
       $WASM3_SRC \
       "$VENDOR/dtoa.c" "$VENDOR/libregexp.c" "$VENDOR/libunicode.c" "$VENDOR/quickjs.c" \
       $ZSTD_SRC \
       $ISH_LIBS -lm
    echo "built $ROOT/runtime/dsh/build/dsh-cli"
fi
