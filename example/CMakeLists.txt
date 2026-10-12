# The desktop executables' mains, out of the dsh-core static spine (phase 2:
# moved verbatim from runtime/dsh/host — the hosts' own build systems never
# compiled these, they are the desktop proof faces).
#
# This CMakeLists doubles as a standalone entry (cmake -S example): run-ish-local
# configures it with -DISH_SMOKE=1 to pull the engine subproject in and build
# the smoke into the same build dir the gates always consumed.
cmake_minimum_required(VERSION 3.21)
project(dsh-example C)
add_executable(dsh-cli main_cli.c)
target_include_directories(dsh-cli PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/../src")
target_link_libraries(dsh-cli PRIVATE dsh-core)

# ish-smoke — transplanted from src/ish/CMakeLists.txt (phase 2; the source is
# ../src/ish_smoke.c now, the link face is unchanged: dsh_ish PUBLICs ishcore
# plus the zlib/resolv staging dependencies). Two faces:
#   standalone (cmake -S example): tools/e2e/run-ish-local.sh configures with
#     -DISH_SMOKE=1 (and ISH_VENDOR) and THIS file pulls the subproject in,
#     so the smoke keeps landing in the same build dir it always had;
#   root graph: src/CMakeLists.txt already added the subproject (TARGET
#     dsh_ish exists) when the vendored tree is present — build the smoke
#     from those targets, no second copy.
if(ISH_SMOKE AND NOT TARGET dsh_ish)
  add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../src/ish" "ish")
endif()
if(ISH_SMOKE OR TARGET dsh_ish)
  add_executable(ish-smoke ish_smoke.c)
  target_link_libraries(ish-smoke PRIVATE dsh_ish)
endif()
