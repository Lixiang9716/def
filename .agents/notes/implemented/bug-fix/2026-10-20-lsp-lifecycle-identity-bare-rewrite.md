# Agent Note: the lsp lifecycle spec spies the vendored class — module-identity rewrites for inlined src limbs (issue #610)

Status: implemented
Related: #610, #259 (the lsp-stdio seat whose fs-face fixes left these two residuals), the W5-S web-fetch-http identity row this mechanism contrasts with

## Problem

`lsp__lsp-stdio__tests__lifecycle` held at 29/2 on the quickjs leg after the
#259 fs-face fixes: both residuals were the didClose-failure mock cases,
where a query that must reject resolves instead. The spec binds
`LspConnection` from a RELATIVE import (`'../src/connection.ts'`), which
esbuild inlines as a fresh TS copy (`var LspConnection = class …` at
artifact line 97) — while the mounted provider is the vendored npm tarball
whose single-file `lib/index.js` BAKES its own class into the bundle
(`external/npm/@deepseek-ai/dsh-lsp-stdio@0.1.6-alpha.2/lib/index.js:241`).
Two distinct class objects: `vi.spyOn(LspConnection.prototype, 'notify')`
installs the mock on the inlined copy the provider never instantiates, so
the didClose rejection path can never fire. Upstream's monorepo vitest
resolves the spec's copy and the lib's internals to ONE source module —
a property a file-split transpile cannot reproduce by graph shape.

## Decision

The transpiler now reproduces the IDENTITY instead of the graph:
`rewriteIdentityImports` (transpile-rewrites.mjs, wired into
`transpileOne`'s source chain before the exclusion scan) rewrites the exact
relative specifier `'../src/connection.ts'` to the vendored lib's BARE
specifier `'@deepseek-ai/dsh-lsp-stdio'`, whose export list re-exports
`LspConnection` verbatim (lib/index.js line 1190). Both legs serve a bare
specifier from one cached module record (the C host's bare map / Node's
`runtime/dsh/node_modules` probe), so the spec's binding IS the class the
mounted provider news up and the prototype spies land. Rows live in
`IDENTITY_BARE_REWRITES`; the corpus carries exactly one importer
(lifecycle.spec.ts). The upstream tests tree and the vendored tarball stay
byte-untouched (D6) — the rewrite is an in-memory source transform, like
the existing hoist/manifest/seed families. Verified on the quickjs leg:
lifecycle 29/2 → 31/0; the other five lsp-stdio specs hold their issue-baseline
counts (connection 21/0, framing 12/0, host 21/0, provider 15/0; instance
22/1 is a pre-existing backpressure-timing failure, reproduced identically
with the change reverted).

## Alternatives considered

- **Inline-to-collapse (the W5-S web-fetch-http row)**: point the import at
  a source file so esbuild dedupes by resolved path and spec + package share
  one module. Rejected here: the tarball face is a single-file bundle — the
  class bytes live inside lib/index.js and no inline target exists to dedupe
  against; only the bare face is shared with the provider.
- **Rewrite the spy target through the module graph** (bind
  `LspLocal.LspConnection` at the spy sites): edits upstream's spec semantics
  in a vendored-verbatim corpus (D6) and scatters the fix across test logic
  instead of one transpile rule.
- **vi.mock-style loader interception** for the module: already a named
  exclusion class (no loader-level interception on either leg) — the whole
  reason the mock had to be a prototype spy in the first place.
- **Leave the two cases red with a named exclusion**: rejected — the cases
  are real behavior (teardown-failure propagation) upstream proves, and the
  identity rewrite is one table row plus a four-line function.

## Consequences

A future spec importing a package src module by relative path to spy its
class gets the same fix by adding one `IDENTITY_BARE_REWRITES` row — legal
only where the vendored lib re-exports the bound symbols, which a stray row
proves at link time (missing named export fails loud, never silently).
