# Agent Note: the bash-parser adoption is revoked — the hand-written subset parser takes the seat

Status: implemented
Related: D6; supersedes, same day, the parser paragraphs of
`implemented/feature/2026-10-11-the-shell-all-three-hosts-can-actually-s.md`
and the accepted costs of the research record's §1
(`.agents/research/shell-js/DECISION.md` — the supersession is §8, the
diligence behind it is `D-parser-survey.md` in that directory)

## Problem

The shell seat's parser was vendored `bash-parser@0.5.0` (the feature
note's decision): a package unmaintained since 2017-06-22 (~9 years), whose
29-package / 1.6 MB production closure rides every host embed at ~0.7 MB —
babylon (292 KB, a full Babel 6 parser) ships unconditionally at module
load for the `$((…))` arm the executor REFUSES, magic-string (388 KB)
exists for string escaping, and two closure members (`curry@1.2.0`,
`filter-iterator@0.0.1`) carry no license field at all. Every bug in the
tokenizer is ours forever, error classification was message-text matching
against a dead upstream's wording, and the process shim
(`globalThis.process ??= {env:{}}`) existed only to feed that upstream's
per-parse `process.env.NODE_NEV` read. A diligence scan
(`.agents/research/shell-js/D-parser-survey.md`) measured every plausible
replacement — the 2024 fork (no substantive improvement: 24 packages /
1.6 MB, still babylon + magic-string), mvdan-sh (GopherJS output, no WASM
after all, but `require("util")` + `process.*` on an engine where the probe
measures `process=undefined`/`require=undefined`), web-tree-sitter (needs
the JS WebAssembly API the build product measurably lacks —
`typeof WebAssembly === 'undefined'`, and quickjs-ng upstream will not
embed WASM), and unbash@5.0.0 (the only vendorable candidate — young,
5 breaking majors in 7 months). The owner directed the hand-written route.

## Decision

The parser is `runtime/dsh/system-plugins/dsh-shell-js/parser-syntax.js`
(423 lines), a hand-written recursive-descent parser accepting exactly the
whitelist dialect — quotes/backslash/comments tokenizing, `$VAR`/`${VAR}`,
`|`, `&&`/`||`, `;`, `>` `>>` `2>` `2>>`, prefix assignments, glob
pass-through — and refusing everything outside it BY NAME at parse time
(command substitution, arithmetic, heredocs, process substitution, brace
groups, loops/conditionals/functions, parameter-expansion operators,
extglob/ANSI-C quoting — exit 2 naming the construct). Error
classification is self-defined: `syntax=true` only for unclosed quotes/`${`,
ending the bash-parser message-text contract. `parser.js` keeps the CJS
vendor seam for shelljs + minimatch (the process presence guard stays for
shelljs's link-time reads) and re-exports the parse faces, so `exec.js`'s
import is unchanged — the executor is untouched.

The executor-observable contract is preserved, not re-decided: the
supported-dialect AST is byte-identical to bash-parser's (74-case
differential at swap time), the fold table is bash-parser's exact one
(walking `exec.js`'s quote machine over both parsers' words), and where
bash-parser crashed or failed on valid bash, bash semantics win (a lone `$`
is literal; `{ }` are plain words outside command position). The 29-tree
bash-parser closure left `NPM_PACKAGES`, the three hosts' embed lists, and
both staged trees; the dsh-shell-js vendor block drops 33 rows → 4
(shelljs + minimatch + the two @isaacs packages), which closes the
vendor round's curry/filter-iterator UNKNOWN-license follow-up by
subtraction — its subject is gone from the tree. The panel suite
(`test/panel/shell-js.test.js`, 86 cases — the dialect contract) passed
unmodified; the e2e scenario logged 35/35 in order; the two-commit
`closures` order held (runtime closure + rows first, regenerated embeds
second).

## Alternatives considered

- **@ericcornelissen/bash-parser@0.5.3** (the "dependency maintenance"
  fork; verified real scoped package) — rejected: closure 24 packages /
  1.6 MB, still dragging babylon + magic-string; five fewer packages and
  no substantive maintenance improvement over a dead upstream.
- **mvdan-sh@0.10.1** — rejected: the premise that it needs WebAssembly
  was wrong (single 1.4 MB GopherJS `index.js`, zero wasm occurrences), but
  it `require("util")` and uses `process.stderr`/`process.exit` on an
  engine where both measure `undefined`, and a 1.4 MB single-file closure
  is its own disqualification.
- **web-tree-sitter@0.27.1** — rejected: needs the JS WebAssembly API the
  build product measurably lacks (dozens of `WebAssembly.*` references in
  the bundle plus a shipped 210 KB `.wasm`); quickjs-ng will not embed WASM
  (github.com/quickjs-ng/quickjs/issues/75). Structurally unavailable.
- **unbash@5.0.0** — the only technically feasible vendor candidate
  (0 deps, pure ESM, ISC, 57.6 KB tarball), rejected by owner direction:
  first publish 2026-02-25 with 21 releases and 5 breaking majors in 7
  months — a pin that the next major could obsolete within weeks; the
  dialect contract now lives in-repo, pinned by the 86-case panel suite,
  not by an upstream release train.
- **Keeping bash-parser and pruning babylon** — rejected (the vendor-round
  note): pruning means editing upstream bytes, D6-forbidden; and it would
  have left every other accepted cost (unmaintained tokenizer, message-
  text classification, the process shim) in place.

## Consequences

- **~0.7 MB per host embed leaves** with the 29 retired trees; the iOS
  TREES embedder, the harmony CLOSURE + Index.ets BUNDLE_FILES, the
  android stager lists and both staged trees drop them, while
  parser-syntax.js joins the harmony CLOSURE/BUNDLE_FILES and both staged
  plugin copies (the device loader imports it from `parser.js`'s
  re-export). Require graph re-verified at swap time: shelljs requires
  only its seven provider builtins, minimatch only the kept @isaacs/* pair.
- **The license gap is closed by subtraction**: curry@1.2.0 and
  filter-iterator@0.0.1 (UNKNOWN) exit with the closure; the "confirm
  intended licensing upstream" follow-up from the vendor-round note is
  moot — bash-parser is no longer in the tree to ask.
- **Refusal timing moved earlier**: out-of-dialect constructs now fail at
  parse time by name instead of parsing to AST nodes for the executor's
  node-type whitelist to refuse — DECISION §4.3's whitelist survives as the
  parser's accept set. The parser's own correctness is the new risk
  surface, carried by the 86-case panel dialect contract plus the 74-case
  differential against bash-parser at swap time.
- **The research record moved with the decision**: DECISION.md §1 carries a
  superseded banner, §8 records the supersession and the five-candidate
  diligence, and `D-parser-survey.md` holds the measurements so the
  numbers above stay reproducible from the repo, not from gitignored
  scratch.
