# Spike C — minimatch as the glob semantics source

**Verdict: pass** (with one license fact that needs an owner decision, below).

minimatch is a pure-JavaScript glob *matcher* with clean, engine-honest
semantics. It ran unmodified on this repository's pinned QuickJS engine
(quickjs-ng 0.17.0 fork) and produced byte-identical output to Node across
every probe. It is a matcher, not a globber: it decides *pattern ↔ path*,
while word expansion, filesystem walking, and the no-match literal-passthrough
rule stay in the shell layer — exactly the split a shell-js port wants.

All work for this spike lives under `tmp/shell-js-spikes/` (gitignored) in the
`feat/dsh-shell-js` worktree. Nothing was committed.

---

## 1. Package identity — the ISC premise needs one correction

The spike brief said "minimatch (ISC)". The **latest** minimatch is no longer
ISC-licensed. Measured with `npm view` (2026-10-11):

| version | license | published | runtime deps |
|---|---|---|---|
| minimatch@3.1.2 (legacy) | ISC | — | `brace-expansion ^1.1.7` |
| minimatch@9.0.5 | ISC | — | `brace-expansion ^2.0.1` |
| **minimatch@10.0.3** | **ISC** | 2025-06-12 | `@isaacs/brace-expansion ^5.0.0` |
| minimatch@10.1.0 … 10.2.6 | **BlueOak-1.0.0** | 2025-10-28 → 2026-07-27 | `brace-expansion ^5.0.8` |

- The license flips **at 10.1.0**: 10.0.3 is the last ISC release (`npm view
  minimatch@10.0.2/10.0.3 license` → ISC; `10.1.0` → BlueOak-1.0.0). The
  tarball's own `LICENSE` file confirms: 10.0.3 ships "The ISC License
  (Copyright (c) 2011-2023 Isaac Z. Schlueter…)"; 10.2.6 ships the Blue Oak
  Model License v1.0.0.
- Blue Oak 1.0.0 is a permissive license (author's stated intent: a modern
  replacement for MIT/ISC), but whether it is acceptable is a policy call this
  spike does not make. **If ISC is a hard requirement, the ceiling is
  10.0.3.**
- Dependency names differ between the two chains — and between what `npm view
  minimatch@10.0.3 dependencies` says and what the shipped code imports. The
  code is the truth; see §2.

## 2. Dependency tree, size, purity

True runtime chains, resolved by reading the shipped `require()` calls (not
just the registry metadata):

**ISC chain (evaluated as the candidate):**

| package | license | role | shippable JS |
|---|---|---|---|
| minimatch@10.0.3 | ISC | the matcher | 71,426 B (6 files, `dist/commonjs/*.js`) |
| @isaacs/brace-expansion@5.0.1 | MIT | `{a,b}` / `{1..3}` expansion | 6,850 B |
| @isaacs/balanced-match@4.0.1 | MIT | brace balance scanner | 1,779 B |
| **total** | ISC+MIT+MIT | **1 direct + 1 transitive dep** | **80,055 B raw / 19,680 B gzip -9** |

- `minimatch@10.0.3/dist/commonjs/index.js` imports
  `@isaacs/brace-expansion` (verified by grep of the unpacked tarball), which
  imports `@isaacs/balanced-match`. npm metadata agrees
  (`dependencies: {"@isaacs/brace-expansion": "^5.0.0"}`). The plain-named
  `brace-expansion`/`balanced-match` packages belong to the 10.2.6 (and ≤9)
  chains — `@isaacs/brace-expansion@5.0.1` and `brace-expansion@5.0.8` are
  *different code* (compared with `cmp`: they differ).
- npm's `dist.unpackedSize` for minimatch@10.0.3 is 438,647 B / 53 files, but
  that includes the ESM twin, `.d.ts`, and `.js.map` files — none of which an
  embedder ships. The commonjs `.js` above is the real payload.
- Latest chain for comparison: 84,668 + 10,037 + 1,779 = 96,484 B raw.

**Purity — pure JS, no native parts, no Node builtins:**

- `find … -name "*.node" -o -name "*.wasm" -o -name "*.gyp" -o -name
  "binding*" -o -name "*.c" -o -name "*.h"` across all six unpacked packages:
  **no matches**. No install script section in any of the three chain
  packages' `package.json`.
- The only Node-global touch in the shipped ISC-chain code is guarded
  (`minimatch-10.0.3/dist/commonjs/index.js:70`):
  `typeof process === 'object' && process ? … : 'posix'` — on a process-less
  engine the platform falls back to `'posix'` (probe-verified on QuickJS:
  `mm.sep === "/"`).

## 3. Behavior probes

Method: one bundle (`scratch/make_bundle.mjs`) wraps each shipped commonjs
file in a registry and appends `scratch/probe_core.js`; the **same file** runs
under Node (semantics oracle) and under the pinned quickjs-ng engine
(`scratch/qjs_spike_main.c` + the four engine TUs, §5). 45 rows, byte-identical
between the two engines; the ISC chain (10.0.3) and latest chain (10.2.6) were
also identical to each other on every row. Full output:
`scratch/out-qjs.txt` / `out-node.txt` / `out-qjs-latest.txt`.

### 'a/*.c' — segment-local star

| path | default | note |
|---|---|---|
| `a/x.c` | ✓ | |
| `a/y.h` | ✗ | extension literal |
| `b/x.c` | ✗ | prefix literal |
| `a/d/x.c` | ✗ | `*` never crosses `/` — bash parity |
| `a/.c` | ✗ / ✓ with `{dot:true}` | dotfiles hidden by default — bash parity |

### '?.txt' — single char

| path | default | `{dot:true}` |
|---|---|---|
| `a.txt` | ✓ | ✓ |
| `ab.txt` | ✗ | ✗ |
| `.a.txt` | ✗ | ✗ (leading dot is not matched by `?`, even in dot mode) |
| `/.txt` | ✗ | — (`?` is `[^/]`) |

The dot rule was cross-checked against real shells, not assumed: bash 3.2
with `shopt -s dotglob` and zsh with `setopt globdots` both expand `?.txt` to
`a.txt` only — `?` still refuses the leading dot. minimatch agrees.

### '**/x' — globstar

| path | result |
|---|---|
| `x` | ✓ (`**` covers zero leading segments) |
| `a/x`, `a/b/x` | ✓ |
| `a/x/y` | ✗ (must end at `x`) |
| `a/b/c/x` vs `a/**/x` | ✓ |
| `a` vs `a/**` | ✗ — minimatch requires ≥1 segment; zsh agrees (`a/**` → `a/real.c` only). Bash ≥4 globstar is documented to include `a` itself — **not verified here** (this machine has only bash 3.2). |
| `a/b/x` vs `a**/x` | ✗ — `**` is globstar only as a whole segment; inside a segment it behaves like `*` |
| `a/b/c` vs `**` | ✓ |
| `a/.h` vs `**/*` | ✗ (dot rule composes with globstar) |

### '[abc]' — character classes

| pattern/path | result |
|---|---|
| `[abc]` vs `a` / `d` | ✓ / ✗ |
| `[!abc]` vs `d` / `/` | ✓ / ✗ (negated class still excludes `/`) |
| `[^abc]` vs `d` | ✓ — regex-style `^` negation is also accepted |
| `[a-c]` vs `b` / `B` | ✓ / ✗ (case-sensitive by default) |
| `[[:alpha:]]` vs `a` | ✓ — POSIX classes supported |
| `[[:digit:]]` vs `a` | ✗ |

### Brace expansion (shell-relevant, via @isaacs/brace-expansion)

- `braceExpand('{a,b}')` → `["a","b"]`; `braceExpand('{1..3}')` →
  `["1","2","3"]` (sequences — bash parity); `minimatch('abd','a{b,c}d')` → ✓.

### The no-match rule — where the division of labor sits

This is the important architectural fact for a shell-js port:
**minimatch has no literal-passthrough concept, by design.** Its contract is
boolean/filter only:

- `mm.match(['a/x.c','a/y.h','b/x.c'], 'a/*.c')` → `["a/x.c"]`
- `mm.match([], 'a/*.c')` → `[]`
- No option in the API surface returns the pattern on no match (the option
  keys are `AST, GLOBSTAR, Minimatch, braceExpand, defaults, escape, filter,
  makeRe, match, sep, unescape`).

The bash behavior the shell must reproduce itself, all three modes run live on
bash 3.2 in a scratch dir with `a/real.c` as the only file:

| bash mode | `for f in a/*.h` yields |
|---|---|
| default | `ARG[a/*.h]` — the **unexpanded pattern, passed through literally** |
| `shopt -s nullglob` | nothing (zero words) |
| `shopt -s failglob` | `bash: no match: a/*.h`, exit 1 |

So the port's split is: **minimatch answers "does this pattern match this
path / which of these paths match"; the shell word-expansion layer owns
directory walking, word construction, and the nullglob/failglob/passthrough
decision on empty results.** One curiosity that makes passthrough
self-consistent: the literal string `a/*.c` itself matches the pattern
`a/*.c` (`minimatch('a/*.c','a/*.c')` → true), so a passthrough word is
indistinguishable from a real file named that — exactly as in bash.

### Parity knobs worth wiring explicitly in a shell port

- **extglob**: minimatch has it **on by default**
  (`minimatch('a','@(a|b)')` → true; off with `{noext:true}`). Bash has it
  **off by default** — verified at parse level: plain `bash -c 'for f in
  @(a|b).txt …'` is a *syntax error*; `bash -O extglob -c` matches
  `a.txt b.txt`. A bash-faithful port should default to `{noext:true}` and
  flip it only in extglob mode.
- **dot**: `{dot:false}` default matches bash's default dotfile hiding;
  `{dot:true}` ≈ dotglob/globdots.
- **case**: case-sensitive by default — matches bash-on-Linux; macOS
  case-insensitivity is filesystem behavior, not glob behavior.
- `escape()` / `unescape()` ship with the package (round-trip verified) —
  usable for quoting paths that contain glob metacharacters.
- `makeRe()` returns a plain `RegExp` — the generated sources for the probes
  are modest, e.g. `a/*.c` → `^a\/(?!\.)[^/]*?\.c$`, `**/x` →
  `^(?:\/|(?:(?!(?:\/|^)\.).)*?\/)?x$` — lookaheads, lazy quantifiers,
  non-capturing groups, no exotic flags.

## 4. QuickJS compatibility — one-line conclusion

**Runs unmodified and byte-identical to Node on this repository's pinned
engine** — minimatch@10.0.3 (and 10.2.6) execute all 45 probe rows on
quickjs-ng 0.17.0 (dsh fork `63b33ea5`) with output identical to Node's.

Evidence, not inference:

- Engine: `runtime/dsh/vendor/ensure.sh` materialized the pinned fork
  (`PIN=0.17.0+fork-tostring+async-context+tc39+promise-mark`, commit
  `63b33ea5…`, tarball sha256-verified by the script itself).
- Build: `scratch/run_spike.sh` compiled `dtoa.c libregexp.c libunicode.c
  quickjs.c` + a ~90-line embedding main with the exact flags
  `runtime/dsh/host/build.sh:71` uses (`cc -std=c11 -O1 -D_GNU_SOURCE … -lm`)
  — the same four TUs every platform build embeds.
- Run: `qjs-spike bundle.js` → 45/45 rows, `diff out-qjs.txt out-node.txt` →
  IDENTICAL; same for the 10.2.6 bundle (`out-qjs-latest.txt` vs
  `out-node-latest.txt` → IDENTICAL).
- The shipped code uses modern syntax (class private fields `#root`,
  private methods, `static`, getters, `?.`, `??` — grep of the dist), and the
  engine digested it; the generated RegExp load (above) is well within
  quickjs libregexp's support (no `v`/`d` flags, no lookbehind in the
  probed paths; POSIX-class patterns like `[[:alpha:]]` also passed).

Caveat: 45 probe rows cover the surfaces this spike was asked about, not
minimatch's full upstream test suite.

## 5. Artifacts and reproduction

Everything is under `tmp/shell-js-spikes/`:

- `pkgs/` — the six tarballs + unpacked trees (`minimatch-10.0.3`,
  `minimatch-10.2.6`, `isaacs-brace-expansion-5.0.1`,
  `isaacs-balanced-match-4.0.1`, `brace-expansion-{2.0.2,5.0.8}`,
  `balanced-match-{1.0.2,4.0.2}`, plus `minimatch-view.json`). The sibling
  spikes' tarballs (`bash-parser`, `shelljs`) were left untouched.
- `scratch/qjs_spike_main.c` — minimal quickjs-ng embedding (provides only
  `print`).
- `scratch/make_bundle.mjs` — CommonJS bundler (`isc` | `latest` chain arg).
- `scratch/probe_core.js` — the 45-row probe harness (engine-neutral).
- `scratch/run_spike.sh` — compile engine, build bundle, run both engines,
  diff. Reproduce with: `sh tmp/shell-js-spikes/scratch/run_spike.sh`.
- Outputs: `scratch/out-{qjs,node}.txt`, `out-{qjs,node}-latest.txt`.

Not verified (stated, not filled in): bash ≥4 globstar semantics (`a/**`
including `a` itself) — no bash 4+ exists on this machine (checked
`/opt/homebrew/bin/bash`: absent); the BlueOak-1.0.0 license's acceptability
for this repository — a policy decision, and the reason the ISC ceiling
(10.0.3) is the version this spike actually evaluates.
