# The desktop executables' mains, out of the dsh-core static spine (phase 2:
# moved verbatim from runtime/dsh/host — the hosts' own build systems never
# compiled these, they are the desktop proof faces).
#
# This CMakeLists doubles as a standalone entry (cmake -S example).
cmake_minimum_required(VERSION 3.21)
project(dsh-example C)
add_executable(dsh-cli main_cli.c)
target_include_directories(dsh-cli PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/../src")
target_link_libraries(dsh-cli PRIVATE dsh-core)
