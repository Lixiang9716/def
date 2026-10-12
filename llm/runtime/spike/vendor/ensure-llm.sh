#!/bin/sh
# Materialize the vendored @deepseek-ai LLM packages (M2 real LLM client) and
# the bundle-root module aliases the quickjs-ng loader needs for their bare
# imports. Idempotent: exits 0 when everything is already present and
# byte-verified. Committed to git (like vendor/dsh/util-crypto@0.1.6-alpha.1):
# this script is the reproducibility record, the tree is the artifact.
#
# Two kinds of trees land under vendor/dsh/:
#   - upstream DSH packages, fetched verbatim from the dsh-desktop vendor
#     snapshot (pinned tgz + sha256, PROVENANCE.md per package);
#   - npm packages from the closure (@deepseek-ai scope), pinned the same way.
#
# The spike's ESM loader (host/dsh_spike_host.c) resolves bare specifiers as
# bundle-root-relative paths, so each package's runtime entry ALSO lands as a
# byte-identical copy at bundle root under its bare specifier
# (`@deepseek-ai/<name>`, plus the `node:module` seam) — byte-verified against
# the vendored lib entry below. Vendored code is never modified; the seams the
# packages need (node:module, the cordis context, structuredClone) live in
# runtime/spike/llm-transport.js and the scenario instead.
set -e
cd "$(dirname "$0")"

UPSTREAM=https://raw.githubusercontent.com/anywhere-labs/dsh-desktop/master/vendor/dsh-runtime/0.1.6-alpha.2
REGISTRY=https://registry.npmjs.org

# dir|url|sha256|entry-in-package
PKGS='
llm@0.1.6-alpha.2|$UPSTREAM/deepseek-ai-dsh-llm-0.1.6-alpha.2.tgz|2220720d9ed9ec912f94b6e10588a1e7d891436b83c1ec192cc00ee61a132d84|lib/index.js
llm-mock-server@0.1.6-alpha.2|$UPSTREAM/deepseek-ai-dsh-llm-mock-server-0.1.6-alpha.2.tgz|9b1f40a8711955c804afa3136460b33abea98898a7b73989a0b234deb38c75e1|lib/index.js
typert-protocol@0.1.6-alpha.2|$UPSTREAM/deepseek-ai-dsh-typert-protocol-0.1.6-alpha.2.tgz|de7447ec069d8f00ca1bfaddd2487adf93446ec75f7852dffc82ff9eca8286e8|lib/index.js
util-values@0.1.6-alpha.2|$UPSTREAM/deepseek-ai-dsh-util-values-0.1.6-alpha.2.tgz|17cb0a738bd28ce8206c1583277b04b244622ec4c201530f88003a4954af86de|lib/index.js
util-crypto@0.1.6-alpha.2|$UPSTREAM/deepseek-ai-dsh-util-crypto-0.1.6-alpha.2.tgz|71ef6845f82a76ec058d405ca1c15c0f410e609216eb01dd9cc4873255af4d91|lib/index.js
brand@0.1.6-alpha.2|$UPSTREAM/deepseek-ai-dsh-brand-0.1.6-alpha.2.tgz|47e97c6e19c562c2581b6e1ee0e30a5b38babec662142cbd28d3d1786c991b95|lib/index.js
timeout@0.1.6-alpha.2|$UPSTREAM/deepseek-ai-dsh-timeout-0.1.6-alpha.2.tgz|1321ef1e4fb31818ae30743173251f03b07edc9976d9769a9102db9a8e850503|lib/index.js
schemastery@3.18.2|$REGISTRY/@deepseek-ai/schemastery/-/schemastery-3.18.2.tgz|a0fe700b9c055f04dfec87cb46ae4a1106c6fac6c271f8a1df00e10038f0aac1|lib/index.mjs
cordis@4.0.2|$REGISTRY/@deepseek-ai/cordis/-/cordis-4.0.2.tgz|686ca44fc6e8d217804de9062b716b7c72755dde09c2a433dd07045eea3c6a97|lib/index.js
cosmokit@1.8.3|$REGISTRY/@deepseek-ai/cosmokit/-/cosmokit-1.8.3.tgz|552f10313ddfdc2b92cce1867b9bf30b2a4c9de55543ad222fe67c22015e4400|lib/index.js
'

# Bare-specifier alias each vendored entry loads under (empty = no alias:
# the package is imported by bundle-root path only, or runs node-side).
ALIAS='
llm@0.1.6-alpha.2|
llm-mock-server@0.1.6-alpha.2|
typert-protocol@0.1.6-alpha.2|@deepseek-ai/dsh-typert-protocol
util-values@0.1.6-alpha.2|@deepseek-ai/dsh-util-values
util-crypto@0.1.6-alpha.2|@deepseek-ai/dsh-util-crypto
brand@0.1.6-alpha.2|@deepseek-ai/dsh-brand
timeout@0.1.6-alpha.2|@deepseek-ai/dsh-timeout
schemastery@3.18.2|@deepseek-ai/schemastery
cordis@4.0.2|@deepseek-ai/cordis
cosmokit@1.8.3|@deepseek-ai/cosmokit
'

have_pkg() {
    dir="dsh/$1"
    entry="$2"
    [ -f "$dir/package.json" ] && [ -f "$dir/$entry" ] && [ -f "$dir/LICENSE" ]
}

fetch_one() {
    dir="dsh/$1"; url="$2"; want="$3"; entry="$4"
    if have_pkg "$1" "$entry"; then
        echo "vendor: dsh/$1 present"
    else
        echo "vendor: fetching $1"
        mkdir -p "$dir"
        TMP=$(mktemp /tmp/dsh-llm-pkg.XXXXXX)
        expanded=$(eval "echo \"$url\"")
        curl -fsSL "$expanded" -o "$TMP"
        echo "$want  $TMP" | shasum -a 256 -c - >/dev/null
        tar xzf "$TMP" -C "$dir" --strip-components=1 \
            package/package.json package/LICENSE "package/$entry"
        rm -f "$TMP"
    fi
    # Bundle-root alias: byte-identical copy of the vendored runtime entry.
    alias_name=$(printf '\n%s\n' "$ALIAS" | grep "^$1|" | cut -d'|' -f2)
    if [ -n "$alias_name" ]; then
        mkdir -p "$(dirname "$alias_name")"
        cp "$dir/$entry" "$alias_name"
        cmp "$dir/$entry" "$alias_name" \
            || { echo "vendor: alias drift for $alias_name" >&2; exit 1; }
    fi
}

printf '%s\n' "$PKGS" | while IFS='|' read -r dir url sha entry; do
    [ -n "$dir" ] || continue
    fetch_one "$dir" "$url" "$sha" "$entry"
done

echo "vendor: @deepseek-ai LLM closure verified"
