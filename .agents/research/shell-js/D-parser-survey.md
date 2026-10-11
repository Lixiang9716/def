# D — parser replacement survey (due diligence before the hand-written swap)

- **Date**: 2026-10-11
- **Question**: bash-parser@0.5.0 (DECISION §1) is unmaintained (~9 years) and its closure costs
  ~0.7 MB per host embed. Is there a vendorable replacement parser, or is the hand-written subset
  route the right exit?
- **Method**: candidate tarballs fetched and unpacked under `tmp/parser-survey/` (gitignored
  scratch; this file is the durable record, copied into the repo like spike reports A/B/C).
  Byte sizes, unpacked file counts, dependency counts, licenses, and `type` re-verified from the
  unpacked `package.json` files in this tree on 2026-10-11; closure weights measured with `du`
  over the production installs; the engine probe run against the built `dsh-cli` bundle.
  Registry/maintenance facts (publish dates, stars, push dates, fork flags) are from the
  diligence pass's registry queries on the same date.

## The engine facts everything is measured against

`probe.js` asks the built runtime for the four bindings vendor parsers reach for; run against the
build product `runtime/dsh/build/dsh-cli`, it printed one line and FAILED LOUD by design:

```
PROBE typeof_WebAssembly=undefined globalThis_WebAssembly=undefined process=undefined
globalThis_require=undefined
```

(`tmp/parser-survey/probe-output.txt` — the probe's `console`/`print` fallback is what makes the
line visible; the findings are: no WebAssembly, no `process`, no `require`.) quickjs-ng upstream
does not embed WASM and says so explicitly (github.com/quickjs-ng/quickjs/issues/75).

## The five candidates

### 1. bash-parser@0.5.0 — the incumbent (DECISION §1)

- 21 runtime dependencies; last publish 2017-06-22 (~9 years dead); MIT.
- Tarball 40.7 KB; unpacked 340 KB / 62 files.
- Production closure: **29 packages / 1.6 MB**, dominated by magic-string 388 KB and
  **babylon 292 KB — a full Babel 6 parser carried for string escaping alone**.

### 2. @ericcornelissen/bash-parser@0.5.3 — the fork

- Verified real scoped package; the unscoped name `ericcornelissen-bash-parser` measured npm 404.
- GitHub source is a fork of vorpaljs/bash-parser (`fork: true`; self-described "dependency
  maintenance"; 2 stars; pushed 2025-05-29). 17 runtime dependencies; last publish 2024-06-08
  (~2.4 years). MIT.
- Tarball 37.1 KB; unpacked 384 KB / 69 files.
- Production closure: **24 packages / 1.6 MB, still dragging babylon + magic-string** — five
  fewer packages than the original, no substantive closure-weight or maintenance improvement.

### 3. mvdan-sh@0.10.1 — excluded, but not for the reason first assumed

- 0 dependencies; last publish 2025-04-10; BSD-3-Clause.
- **The premise needed correcting: it does NOT need WebAssembly.** The package is a single
  1.4 MB `index.js` (1,505,122 B), README: "It is transpiled from Go to JS using
  gopherjs"; **zero `WebAssembly`/`instantiate` occurrences in the whole file** — the
  `$goVersion = "go1.17.9"` prefix and `$global`/`$module` are GopherJS flags, not wasm.
- Excluded anyway, on two measured grounds: it `require("util")` and uses
  `process.stderr`/`process.exit`, and the engine probe shows `process` and `require` are
  `undefined` on dsh-cli; and a 1.4 MB single-file closure is its own disqualification for a
  per-host embed.

### 4. web-tree-sitter@0.27.1 — excluded, premise confirmed

- 0 dependencies; last publish 2026-10-08; MIT.
- **Needs the JS WebAssembly API.** The production bundle (`web-tree-sitter.js`) carries 32
  `WebAssembly.*` references (7× Module, 5× Global, 3× Instance, 2× instantiate, plus
  instantiateStreaming/compileStreaming/Table/Memory/RuntimeError); the debug bundle carries the
  same API surface (34 occurrences). The package ships `web-tree-sitter.wasm` at 210 KB (the
  debug build's map alone is 663 KB).
- The engine probe shows `typeof WebAssembly === 'undefined'` on the build product, and
  quickjs-ng upstream will not embed WASM (issues/75) → excluded.

### 5. unbash@5.0.0 — the only technically feasible vendor candidate

- **0 dependencies; pure ESM** (`dist/parser.js` + `./printer`; no WebAssembly/`require`/
  `process` dependencies; `package.json` `type: module`). ISC.
- Tarball 57.6 KB; unpacked 384 KB / 29 files.
- Actively maintained: first publish 2026-02-25; 21 releases and **5 breaking majors**
  (1→2→3→4→5) in 7 months; repo pushed 2026-09-30; 130 stars; 3 open issues.
- The recorded risk is the only substantive one: **young package, fast API churn** — a vendor
  pin could be obsoleted by the next major within weeks.

## Verdict handed to the owner

The vendor route had exactly one technically feasible candidate (unbash@5.0.0), young and
churning; every bash-parser-shaped alternative (the fork) changes nothing that mattered; the
Go-transpiled and tree-sitter routes are structurally unavailable on this engine. The owner
directed the hand-written subset route (DECISION §8) — the dialect contract comes in-repo,
pinned by the panel suite (`test/panel/shell-js.test.js`, 86 cases) instead of by an upstream
release train.
