#!/bin/sh
# Regenerate the iOS dsh app: embed the runtime/dsh JS bundle as C byte
# arrays, then regenerate DSHHost.xcodeproj from project.yml. Run
# external/ensure.sh first — xcodegen needs the quickjs sources
# on disk to reference them. CI runs this same script ahead of its build
# (dev-ios.yml): since the D9 flip the generated project is build output,
# not a committed file.
set -e
cd "$(dirname "$0")"
python3 Tools/gen_bundle_header.py
xcodegen generate
