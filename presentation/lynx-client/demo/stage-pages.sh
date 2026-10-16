#!/bin/sh
# stage-pages.sh — assemble the GitHub Pages artifact for the landing page.
# The SAME script runs locally and in .github/workflows/pages.yml, so
# the layout verified locally is the layout deployed. Everything is relative:
# Pages serves project pages from a subpath (https://<owner>.github.io/<repo>/).
#
# The page is a PURE STATIC single page (owner decision 2026-10-16): the
# lynx-view client mount, the web-core scripts, and the staged
# main.web.bundle were removed from the landing, so this script stages
# only the page itself plus its self-hosted display face.
#
# Staged layout:
#   index.html                       the landing page (demo/index.html)
#   SchibstedGrotesk-latin.woff2     the display face (OFL; license beside it)
#   OFL.txt                          the font's license, shipped with the font
#
# Usage: sh presentation/lynx-client/demo/stage-pages.sh <repo-root> <out-dir>
set -eu

ROOT="${1:?usage: stage-pages.sh <repo-root> <out-dir>}"
OUT="${2:?usage: stage-pages.sh <repo-root> <out-dir>}"

DEMO="$ROOT/presentation/lynx-client/demo"

rm -rf "$OUT"
mkdir -p "$OUT"
cp "$DEMO/index.html" "$OUT/"
# The landing page's self-hosted display face (SIL OFL 1.1; the license
# ships beside the font, so the artifact carries it too).
cp "$DEMO/SchibstedGrotesk-latin.woff2" "$OUT/"
cp "$DEMO/OFL.txt" "$OUT/"

# Fail loud on the load-bearing files: the page is dead without the font
# carrying its voice, and mute without its face.
test -f "$OUT/index.html"
test -f "$OUT/SchibstedGrotesk-latin.woff2"
test -f "$OUT/OFL.txt"
echo "stage-pages: staged $(find "$OUT" -type f | wc -l | tr -d ' ') files into $OUT"
