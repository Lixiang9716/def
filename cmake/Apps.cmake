# cmake/Apps.cmake — the platform-shell wrapper targets.
#
# The three app shells stay owned by their platform toolchains (xcodebuild /
# Gradle / hvigor); CMake is the unified ENTRY, not their compiler. Every
# target below is a thin delegation to build/build.sh — the shell script
# stays the single source of what sync/compile/test mean (BUILD.md); nothing
# here re-implements build.sh's steps.
#
# The sync steps are FIRST-CLASS custom commands with real dependency edges:
# each dsh-sync-<platform> is a stamped custom command whose DEPENDS are the
# stage's actual inputs — the manifest store (tools/generated/staging/**, the
# spliced rosters the stagers consume), the pin tables (external/ensure*.sh
# and test/e2e/ensure*.sh, whose bytes define the vendored closure), the
# canonical source tree (runtime/dsh/**, through the script's own copies),
# the stager scripts, and the webclient product trees the mirrors copy. An
# input change makes `cmake --build --target dsh-sync-<platform>` (or the
# dsh-<platform> shell build that depends on it) re-stage; an unchanged tree
# skips via the stamp. The globs are CONFIGURE_DEPENDS: adding a file
# re-globs at build time instead of demanding a re-configure. runtime/dsh's
# vendor/ entry is a SYMLINK to external/ and is deliberately not followed
# (the pins' bytes are the ensure scripts' output, not inputs).
#
# The `test`/`check` verbs are deliberately NOT wrapped here: the gates ride
# CTest through Gates.cmake (dsh-gate-*, dsh-test-core) — a build.sh
# test/check wrapper would duplicate `gov run`'s DAG under a second driver.
#
# Preset/target cheat-sheet:
#   cmake --preset macos-dev
#   cmake --build --preset macos-dev --target dsh-android
#   cmake --build --preset macos-dev --target dsh-sync-harmony
#   ctest --preset macos-dev
#
# WORKING_DIRECTORY is pinned to the repo root because the COMMAND names
# build/build.sh relative to it; Apps.cmake is include()d from the root
# CMakeLists.txt, and include() runs in the caller's scope, so
# CMAKE_CURRENT_SOURCE_DIR there IS the repo root. USES_TERMINAL routes the
# commands through ninja's console pool so build.sh's streaming output stays
# interactive. Each dsh-<platform> target depends on its dsh-sync-<platform>
# so the DAG orders the closure re-stage before the shell build; build.sh's
# `build` verb re-runs the sync internally anyway (stage_sync precedes
# stage_compile), so the doubled sync is idempotent restaging.

set(DSH_APP_PLATFORMS ios android harmony)

# The shared input closure of every stage: the manifest store (the generated
# rosters the stagers splice/copy from), the pin tables, and the canonical
# runtime closure. The vendor/ symlink is skipped by GLOB_RECURSE's default
# (no FOLLOW_SYMLINKS) on purpose.
file(GLOB_RECURSE DSH_STAGE_STORE CONFIGURE_DEPENDS
     "${CMAKE_CURRENT_SOURCE_DIR}/tools/generated/staging/*")
file(GLOB DSH_STAGE_ENSURE CONFIGURE_DEPENDS
     "${CMAKE_CURRENT_SOURCE_DIR}/external/ensure*.sh"
     "${CMAKE_CURRENT_SOURCE_DIR}/test/e2e/ensure*.sh")
file(GLOB_RECURSE DSH_STAGE_RUNTIME CONFIGURE_DEPENDS
     "${CMAKE_CURRENT_SOURCE_DIR}/runtime/dsh/*")
# Build outputs and test node_modules are not stage inputs — and the iSH
# guest root's applet names (`[`, `[[`) break ninja's depfile parsing.
list(FILTER DSH_STAGE_RUNTIME EXCLUDE REGEX
     "/runtime/dsh/(artifacts|build|node_modules|coverage)/")
file(GLOB_RECURSE DSH_STAGE_WEBCLIENT CONFIGURE_DEPENDS
     "${CMAKE_CURRENT_SOURCE_DIR}/presentation/web-client/*"
     "${CMAKE_CURRENT_SOURCE_DIR}/presentation/web-client-*/*")

foreach(_p IN LISTS DSH_APP_PLATFORMS)
  set(_extra "")
  set(_stager "")
  if(_p STREQUAL "android")
    list(APPEND _extra ${DSH_STAGE_WEBCLIENT})
    set(_stager hosts/android/ci/stage-spine-closure.sh)
  elseif(_p STREQUAL "harmony")
    list(APPEND _extra ${DSH_STAGE_WEBCLIENT}
      "${CMAKE_CURRENT_SOURCE_DIR}/hosts/harmony/entry/src/main/ets/pages/Index.ets")
    set(_stager hosts/harmony/ci/vendor-official.sh)
  else()
    set(_stager hosts/ios/gen.sh)
    list(APPEND _extra
      "${CMAKE_CURRENT_SOURCE_DIR}/hosts/ios/Tools/gen_bundle_header.py"
      "${CMAKE_CURRENT_SOURCE_DIR}/hosts/ios/Tools/gen_bundle_resources.py"
      "${CMAKE_CURRENT_SOURCE_DIR}/hosts/ios/Tools/gen_bundle_trees.py")
  endif()
  set(_stamp "${CMAKE_CURRENT_BINARY_DIR}/dsh-sync-${_p}.stamp")
  add_custom_command(
    OUTPUT "${_stamp}"
    COMMAND sh build/build.sh sync ${_p}
    COMMAND "${CMAKE_COMMAND}" -E touch "${_stamp}"
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
    DEPENDS ${DSH_STAGE_STORE} ${DSH_STAGE_ENSURE} ${DSH_STAGE_RUNTIME}
            ${_extra} "${CMAKE_CURRENT_SOURCE_DIR}/${_stager}"
    COMMENT "sync ${_p}: build/build.sh sync ${_p} (re-runs when a stage input changes)")

  add_custom_target(dsh-sync-${_p}
    DEPENDS "${_stamp}"
    SOURCES "${CMAKE_CURRENT_SOURCE_DIR}/${_stager}")

  add_custom_target(dsh-${_p}
    COMMAND sh build/build.sh build ${_p}
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
    VERBATIM
    USES_TERMINAL
    COMMENT "build ${_p}: build/build.sh build ${_p} (sync + compile + test)")

  add_dependencies(dsh-${_p} dsh-sync-${_p})
endforeach()

unset(_p)
unset(_extra)
unset(_stager)
unset(_stamp)

# The core has no app shell: the dsh-core static lib is defined by
# src (see root CMakeLists.txt), so only its pin verification
# is a wrapper here.
set(_stamp "${CMAKE_CURRENT_BINARY_DIR}/dsh-sync-core.stamp")
add_custom_command(
  OUTPUT "${_stamp}"
  COMMAND sh build/build.sh sync core
  COMMAND "${CMAKE_COMMAND}" -E touch "${_stamp}"
  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
  DEPENDS ${DSH_STAGE_ENSURE}
  COMMENT "sync core: build/build.sh sync core")
add_custom_target(dsh-sync-core DEPENDS "${_stamp}")
unset(_stamp)
