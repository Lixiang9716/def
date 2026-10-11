# DECISION — dsh-shell-js routes (parser / applet bodies / glob / MVP list / staging)

- **Date**: 2026-10-11
- **Worktree**: `/Users/lixiang/workspace/dsh-mobile-shell-js`, branch `feat/dsh-shell-js` (verified clean
  before writing; `tmp/` is gitignored; nothing committed or pushed)
- **Inputs**: Spike A (`A-bash-parser.md`), Spike B (`B-shelljs.md`), Spike C (`C-minimatch.md`) in this
  directory, plus repo facts re-verified during this decision (§0). The same-day parser supersession
  (§8) adds the diligence survey (`D-parser-survey.md`).

**Decisions in one line each:**

1. **Parser**: vendor `bash-parser@0.5.0` (Spike A verdict *degrade* — accepted with the costs in §1).
   **SUPERSEDED same day, owner-directed (§8)**: the adoption is revoked; the parser is the hand-written
   bash-subset parser (`parser-syntax.js`).
2. **Applet bodies**: shelljs 0.10.0 as the source for the fs-family bodies — **vendored byte-pristine**, all
   adaptation in outboard module seams; re-filtered against the **gateway** fs face (narrower than the shim
   face Spike B analyzed — see §2.2, the load-bearing correction); plus four hand-written applets and two
   applets backed by repo modules.
3. **Glob**: vendor the minimatch **ISC chain** (`minimatch@10.0.3` + `@isaacs/brace-expansion@5.0.1` +
   `@isaacs/balanced-match@4.0.1`) as the matcher; hand-write the walker over gateway `fsList`; no fast-glob.
4. **MVP applets**: 22 names (§4.1); everything not honor-able is **refused by name** (§4.2) — the house rule.
5. **Staging**: plugin-local `vendor/` subdirectory with LICENSE + version-pin headers, explicitly transitional
   until the formal `add-package.sh` vendor round (§5).

---

## 0. Grounding facts (re-verified in this worktree, not inherited from the spikes)

- **Executor shape to clone**: `system-plugins/dsh-shell-wasm/index.js` — `resolve(request)` normalizes
  `{command, workdir, timeoutMs, stdoutMaxBytes}` (`index.js:174-182`), `run(request)` returns
  `{exitCode, stdout, stderr}` (+ `command`, `index.js:98-105`), `sandboxMode: undefined` because there is no
  process to confine — the gateway already scopes and audits every call (`index.js:188-191`). Its refusal
  pattern is the template for ours: unsupported constructs fail loud with exit 2 naming what is missing
  (`index.js:139-144`), unknown programs fail 127 **self-describing** — naming what does exist and where file
  work belongs (`index.js:156-164`).
- **The gateway fs face is SEVEN primitives** — `fsRead`, `fsWrite`, `fsStat`, `fsList`, `fsMkdir`, `fsRemove`,
  `fsRename` (`contract/primitives.md:126-147`). Semantics that matter here:
  - `fsRead(scope, path) → {bytes, mtime}` — whole file, **no streaming**, hosts reject oversized reads as
    `invalid` (`primitives.md:245-247`).
  - `fsWrite(scope, path, bytes, {append, create=true})` — `>` and `>>` both map natively (`primitives.md:248-249`).
  - `fsStat → {kind: "file"|"dir"|"other", size, mtime}` — **no mode, no uid/gid, no nlink, no symlink
    distinction** (`primitives.md:264-267`).
  - `fsList → {entries:[{name, kind}]}` — one level, **sorted byte order, deterministic across hosts**
    (`primitives.md:268-270`).
  - `fsMkdir` — recursive with `existing:"ok"` default = `mkdir -p` built in (`primitives.md:271-273`);
    `fsRemove` — `recursive` + `missing:"ok"` default = `rm -rf` built in (`primitives.md:274-275`);
    `fsRename` — POSIX replace-target semantics = `mv` built in (`primitives.md:276-278`).
  - **No chmod, no symlink/hardlink, no utimes, no fd/stream primitive exists in the frozen contract.**
- **Repo modules that back two applets directly**: `runtime/dsh/sha256.js:43` exports `sha256Hex(bytes)`;
  `runtime/dsh/tar-mini.js:53,84` exports `tarWrite(members)` / `tarRead(bytes)` — uncompressed POSIX ustar,
  regular files only, deterministic fields, hostile-path guards (`tar-mini.js:44-49`), and deliberately no
  gzip because the frozen gateway has no inflate primitive (`tar-mini.js:4-9`).
- **Formal vendor machinery exists**: the `vendor-package` skill (`.agents/skills/vendor-package/SKILL.md`)
   — pin tables (`NPM_PACKAGES` → `vendor/npm/<name>@<ver>`), `runtime/spike/vendor/add-package.sh`
   (fetch / pin / mirror / regen / verify), per-host embed rows, and the two-commit ordering the `closures`
   gate demands. It explicitly warns: *never hand-place files into vendor trees — a tree without a pin+stamp
   is invisible to ensure and silently diverges*.

## 1. Parser route — vendor `bash-parser@0.5.0` (degrade accepted)

> **SUPERSEDED 2026-10-11, owner-directed — see §8.** bash-parser left the closure the same day;
> the text below is the record of the decision it replaced, kept so §8's "what it beat" is
> readable. The costs accepted here (weight, the process shim, message-text error
> classification, the node-type whitelist) are retired by §8.

Spike A's verdict is **degrade**: functionally 14/14 on the dialect checklist (identical under `{mode:'bash'}`),
syntax ≤ ES2020 across the whole 91-file closure (inside quickjs-ng's ES2023), no Buffer/timers/streams/events
anywhere — but with real costs. Per the decision rule given ("pass/degrade → vendored adoption, with the
degrade cost written out"), **we adopt it vendored**. The costs, accepted knowingly:

1. **Closure weight**: 30 packages / 91 files / ~388 KB actually loaded, of which `babylon` is 230.7 KB (60%)
   and serves **only** `$((…))` arithmetic — and it is required *unconditionally at module load*
   (`src/modes/posix/rules/arithmetic-expansion.js:5`), so even though our executor refuses arithmetic by name
   (§4.2), the bytes still ship. Cutting it would mean patching upstream, which D6 forbids. We pay it in v1;
   a future handwritten-parser swap is the only exit.
2. **Unmaintained**: last release 2017-06-22 (9+ years). Every bug is ours. Exact-pin 0.5.0 (mandatory under
   D6 anyway).
3. **`process.env.NODE_NEV` read on every parse** (`src/modes/posix/tokenizer/index.js:184`): QuickJS has no
   `process` binding, and Spike A verified empirically that without one, `parse('echo hi')` fails immediately.
   Mitigation is environmental, **not** a source patch: the plugin installs
   `globalThis.process ??= { env: {} }` (idempotent) at module init before the first parse. The `NODE_NEV`
   typo means even Node never takes the immutable branch — only presence matters, never the value.
4. **CommonJS graph**: 91 CJS files must go through the repo's closure-bundling path (`build/build.sh sync` +
   `closures` gate). This is documented machinery, but **Spike A did not exercise it** — the first
   `sync`/`closures` run against the vendored tree is an explicit integration checkpoint (risk R4).
5. **Error contract**: only unclosed quotes throw `SyntaxError`; grammar errors arrive as plain `Error`
   (`src/index.js:48-52`). The executor classifies parse failures by message text, and keeps "parsed but
   unimplemented node type" (§4.2 refusal table) strictly separate from "did not parse".
6. **Dialect coverage beyond the checklist is unaudited** (heredocs, subshells, loops, function defs — the
   grammar tables contain them but Spike A probed none). We neutralize this with a **node-type whitelist**:
   the executor implements exactly the node types in §4.3; any other node type in a parsed AST is refused by
   name, exit 2. Unaudited corners fail loud, never silently wrong — which is the house rule applied to the
   parser itself.

Parse options: `{mode: 'bash'}` (this is a bash-subset shell; Spike A found 14/14 identical to posix mode).

**Why not hand-written**: the alternative (a bash-subset grammar by hand) trades ~388 KB of pinned, probe-
verified bytes for unbounded correctness risk concentrated exactly where hand-rolled shells break — quoting,
escaping, and expansion interleaving. Spike A's probes show bash-parser already folds quote removal at parse
time and preserves expansions as `Word.expansion[]` with loc offsets (V3 suffix composition verified). The
refusal-table design means parser over-coverage costs nothing semantically. Weight is the price; correctness
is the purchase.

## 2. Applet body route — shelljs 0.10.0, pristine, behind outboard seams

### 2.1 The composition

| Source | Applets | Form |
| --- | --- | --- |
| shelljs 0.10.0 (Table 甲 of Spike B, gateway-filtered — §2.2) | cat, echo, pwd, cd, ls, grep, sed, head, tail, sort, uniq, mkdir, rm, mv | whole-file, byte-pristine |
| shelljs 0.10.0 (Table 乙, adapted at the seam) | cp (− `-p`), find | pristine files; flag refusals + glob seam in the wrapper |
| Hand-written (absent from shelljs — Spike B §2.3, §7.5) | wc, env, basename, dirname | new code in the plugin |
| Repo modules (§0) | sha256sum (`sha256Hex`), tar (`tarWrite`/`tarRead`) | new thin applets over `runtime/dsh/` |
| shelljs Table 丙 (exec / exec-child / cmd) | — | **dropped**; subprocess is structurally impossible (AGENTS non-negotiable #2). `child_process` + `execa` are stubbed at link time (the shelljs entry requires `exec-child` unconditionally — Spike B Table 丙 note); the stubs refuse at call time with the no-subprocess message. |

### 2.2 The load-bearing correction: the gateway face is narrower than the shim face

Spike B classified commands against the **runtime shim** surface (`runtime/dsh/upstream/shims/fs.js` — a rich
Node face with chmod/utimes/symlink/fd). The brief for this shell pins applets to the **gateway fs
primitives** (per-call audit) — and that face is the seven primitives of §0, with no permission, symlink,
timestamp, or fd/stream semantics. Consequences, command by command:

- **chmod** — Table 甲 under the shim face, **un-honor-able over the gateway**: `fsStat` carries no mode and no
  primitive changes one. A chmod that pretends success would silently change nothing — exactly what the house
  rule forbids. Refused by name in MVP. If permissions matter later, the D5 path is a contract proposal
  (`fsChmod`-class), not a reach-around.
- **ln** — same verdict: no link primitive of either kind behind the gateway. Refused by name.
- **touch** — its core meaning (timestamp update) has no primitive; `utimesSync` is un-mappable. Refused by
  name in MVP rather than shipped as create-only under the same name.
- **cp `-p`** — preserve needs owner/timestamps: no primitives. The flag is refused by name; plain `cp`, `-r`
  (fsRead+fsMkdir+fsWrite walk), and `-u` (fsStat `mtime` exists) are honor-able.
- **ls `-l`** — long format renders mode/owner/nlink that `fsStat` cannot see. Refused by name; plain `ls`,
  `-a`, `-R` are honor-able. (A degraded `-l` printing blanks would be a silent meaning change — refused
  instead.)
- **head/tail** — the shelljs bodies use the fd face (`openSync/readSync/closeSync`), which the gateway lacks
  (no streaming, `primitives.md:245-247`). The adapter provides an **in-memory fd emulation** over whole-file
  `fsRead`/`fsWrite` (§2.3) so the pristine bodies run unmodified; the whole-file bound and the host's
  max-read-size rejection are disclosed in the tool description, not hidden.
- **mkdir -p / rm -r -f / mv** — the contract was shaped for exactly these POSIX semantics (§0), native fit.

### 2.3 The seam architecture (no vendored file is ever edited)

All adaptation lives in the plugin, in five outboard pieces:

1. **`fs` adapter (node-face over gateway)** — the module shelljs bodies import as `fs`. Maps the calls the
   included bodies make onto the seven primitives: `existsSync`/`statSync`/`lstatSync` → `fsStat` (synthesized
   stat object: `kind` → `isFile/isDirectory`, `isSymbolicLink` always false — honestly, there is no symlink
   distinction; `size`, `mtime`); `readdirSync` → `fsList` (already byte-sorted); `readFileSync` → `fsRead`
   (utf8 decode or raw bytes); `writeFileSync` → `fsWrite`; `appendFileSync` → `fsWrite {append:true}`;
   `mkdirSync` → `fsMkdir`; `rmSync`/`rmdirSync`/`unlinkSync` → `fsRemove`; `renameSync` → `fsRename`; plus an
   in-memory fd emulation (`openSync`/`readSync`/`writeSync`/`closeSync` over whole-file read + buffered
   single `fsWrite` at close, the append arm mapping to `{append:true}`). Every call through this adapter is a
   gateway call — the per-call audit is the gateway's own, inherited for free. This is the same class of
   module as the existing `shims/` (Spike B §7.2's judgment), and it is where D5 lives: nothing here invents
   an eighth primitive.
2. **`fast-glob` provider** — shelljs's `common.js` requires a glob engine at link time (`common.js:9`) and
   calls `glob.sync` for glob-bearing arguments at runtime (`common.js:310`). We map the module id to a thin
   provider: `sync(pattern, opts) → sorted string[]`, implemented over the §3 walker (fsList recursion +
   minimatch). The real fast-glob tree is **not** vendored (7+ packages, `@nodelib` walkers designed for real
   disks — Spike B §7.2).
3. **Link-time stubs** — `child_process`, `execa`: loadable modules whose functions throw the by-name
   no-subprocess refusal.
4. **Applet wrapper** — the table `name → (argv, {stdin, cwd, vars}) → {exitCode, stdout, stderr}`. It
   translates argv to the shelljs call, captures the ShellString result (errors are return values, never
   exceptions unless `config.fatal` — Spike B §6), converts `code/stderr` to the executor shape, and owns the
   **by-name refusal table** (§4.2) and the stdin convention: an applet invoked with no file argument and a
   pipeline stdin reads the stdin text (POSIX); where a pristine shelljs body cannot take inline text, the
   wrapper stages it through a throwaway scoped file (`fsWrite` → pass path → `fsRemove`).
5. **Variable/cwd session** — the executor holds the cwd (mutated by `cd`, like upstream `ctx.shell`) and the
   shell variable table read by `$VAR` expansions and set by `FOO=bar` prefix assignments; `env` prints that
   table (disclosed as the *shell's* variables, not a host process environment — there is none).

Licensing (Spike B §2.1, §7.6): shelljs 0.10.0 is **BSD-3-Clause** — not MIT — with two embedded wrench-js
MIT passages inside `src/cp.js:90-96` and `src/rm.js:12-19` that must survive vendoring verbatim (they will:
the files are pristine). Pin records say BSD-3-Clause.

## 3. Glob route — vendored minimatch (ISC chain) as matcher, hand-written walker

Spike C's verdict is **pass**: the ISC chain ran unmodified and byte-identical to Node on this repo's pinned
engine (quickjs-ng 0.17.0 fork `63b33ea5`, the exact four TUs every platform build embeds), 45/45 probe rows,
pure JS, no native parts, no Node builtins — the only Node-global touch is a guarded platform fallback that
resolves `'posix'` on a process-less engine (probe-verified `mm.sep === "/"`).

- **Version: `minimatch@10.0.3` — the ISC ceiling.** 10.1.0+ relicensed to BlueOak-1.0.0 (Spike C §1);
  crossing that line is a license-policy decision this document does not make. **Owner affirmed staying
  at the ISC ceiling on 2026-10-11** (PR #457 thread): the pin does not follow 10.1.0+; a future bump
  requires an explicit BlueOak acceptance recorded here. Pin
  `minimatch@10.0.3` + `@isaacs/brace-expansion@5.0.1` + `@isaacs/balanced-match@4.0.1` (ISC + MIT + MIT,
  80,055 B raw / 19,680 B gzip — Spike C §2). Note the dependency names: the `@isaacs/`-scoped packages are
  *different code* from the plain-named `brace-expansion`/`balanced-match` (Spike C compared them with `cmp`).
- **Division of labor** (Spike C §3, the architectural fact): minimatch answers *pattern ↔ path* only. The
  shell layer owns directory walking, word construction, and the empty-result rule. We implement the **bash
  default: no match → the pattern passes through as a literal word** (verified against bash 3.2; Spike C also
  notes the pleasing self-consistency that the literal matches its own pattern). `nullglob`/`failglob` are
  not exposed in v1.
- **Defaults**: `{noext: true}` (extglob off — bash parity; minimatch ships it on by default, Spike C §3) and
  `dot: false` (dotfile hiding — bash parity). Case-sensitive.
- **Walker**: hand-written recursive descent over `fsList` (byte-sorted per contract — deterministic expansion
  order for free), one `minimatch` match per candidate path, composing into sorted words. `**` globstar
  semantics follow minimatch's (zero-or-more leading segments; `a/**` requires ≥1 segment — zsh-consistent,
  bash ≥4 unverified on this machine, Spike C §3/§5 — acceptable and disclosed).

## 4. MVP applet list

### 4.1 The 22 applets

| # | Applet | Source | Gateway composition / notes |
| --- | --- | --- | --- |
| 1 | `cat` | shelljs 甲 | fsRead ×N, `-n` numbering (GNU format) |
| 2 | `echo` | shelljs 甲 | no fs; `util.format` conventions (shelljs echo supports `-e` escapes) |
| 3 | `pwd` | shelljs 甲 | executor cwd |
| 4 | `cd` | shelljs 甲 | fsStat check + executor cwd mutation (session-persistent) |
| 5 | `ls` | shelljs 甲 | fsList + fsStat; `-a`, `-R`; `-l` **refused by name** (§2.2) |
| 6 | `grep` | shelljs 甲 | fsRead + filter; exit 0/1/2 convention preserved |
| 7 | `sed` | shelljs 甲 | `-i` via fsWrite; no-pattern-sep form and `-e` |
| 8 | `head` | shelljs 甲 | whole-file fsRead under the in-memory fd emulation; `-n`, `-c` |
| 9 | `tail` | shelljs 甲 | same; `-n` |
| 10 | `sort` | shelljs 甲 | fsRead + `localeCompare` (dialect disclosure, §6) |
| 11 | `uniq` | shelljs 甲 | fsRead + compare; `-c` etc. |
| 12 | `mkdir` | shelljs 甲 | fsMkdir (recursive + `existing:"ok"` are native) |
| 13 | `rm` | shelljs 甲 | fsRemove (`recursive`, `missing:"ok"` native = `-r`, `-f`) |
| 14 | `mv` | shelljs 甲 | fsRename (POSIX replace semantics native) |
| 15 | `cp` | shelljs 乙 | fsStat+fsRead+fsMkdir+fsWrite walk; `-u` via fsStat mtime; **`-p` refused by name** |
| 16 | `find` | shelljs 乙 | fsList recursion + minimatch `-name`; shelljs body rides the glob seam |
| 17 | `wc` | hand-written | lines/words/bytes over fsRead (utf8 world: bytes = byte length; `-l/-w/-c`) |
| 18 | `basename` | hand-written | pure path string op, no fs |
| 19 | `dirname` | hand-written | pure path string op, no fs |
| 20 | `env` | hand-written | prints the shell variable table; `VAR=x cmd` scoping via AssignmentWord |
| 21 | `sha256sum` | repo `sha256.js:43` | fsRead bytes → `sha256Hex`; `<hex>␣␣<path>` text-mode format |
| 22 | `tar` | repo `tar-mini.js:53,84` | `-c/-t/-x -f`, regular files only, uncompressed; **`-z` refused by name** (no inflate primitive — the same design note as `tar-mini.js:4-9`); directories-in-archive refused by name (ustar regular-file-only) |

Deferred (honor-able later, not MVP): `test`/`[` (fsStat covers `-e/-f/-d/-s`), `which`, `pushd`/`popd`/`dirs`,
`touch` behind a future utimes contract primitive, `chmod`/`ln` behind future contract proposals.

### 4.2 The refusal table (the house rule, made concrete)

Everything a parsed command line can ask for that we cannot honor fails **by name**, exit 2 (or 127 for
missing programs), never silently:

- **Constructs** (parsed, then refused): arithmetic `$((…))`, command substitution `$(…)`/backticks, heredocs,
  subshells `(…)`, `for`/`while`/`until`/`if`/`case`, function definitions, process substitution, background
  jobs, and **any AST node type not in the §4.3 whitelist** — the defensive catch-all that makes Spike A's
  unaudited dialect corners (§1.6) fail safe.
- **Flags** (applet known, flag not honor-able): `cp -p`, `ls -l`, `tar -z`, any flag not in an applet's
  implemented set.
- **Commands with no gateway backing**: `chmod`, `ln`, `touch`, `exec` — refused naming the missing
  capability and the D5 path ("needs a contract proposal"), echoing dsh-shell-wasm's self-describing refusals.
- **Unknown program** → 127 with the available-applet list, cloning `dsh-shell-wasm/index.js:156-164`.

### 4.3 What the executor *does* run (the implemented whitelist)

Pipelines (`a | b` — in-process data flow, stdout-to-stdin, pipeline status = last member), `&&`/`||`
short-circuit on exit codes, `;`/newline sequences, redirects `>` (fsWrite create), `>>` (fsWrite append),
`2>` (stderr capture → write), `FOO=bar cmd` prefix assignments, `$VAR`/`${VAR}` simple expansion against
the shell variable table (other parameter-expansion operators refused by name), comments, and §4.1 globs in
word position. `resolve`/`run` keep the dsh-shell-wasm shape; `timeoutMs`/`stdoutMaxBytes` are normalized
and carried, not enforced in v1 (same as the wasm sibling) — applets are bounded synchronous gateway calls
and the loop constructs that could hang are refused.

## 5. Third-party staging (before the formal vendor round)

Transitional home, until the `vendor-package` round runs:

```
system-plugins/dsh-shell-js/
  vendor/
    bash-parser@0.5.0/        # pristine unpacked tarball (62 files)
    shelljs@0.10.0/           # pristine unpacked tarball
    minimatch@10.0.3/         # pristine, commonjs payload
    isaacs-brace-expansion@5.0.1/
    isaacs-balanced-match@4.0.1/
  VENDOR.md                   # the transitional notice
```

Rules for this staging:

1. **Pristine bytes only** — unpacked registry tarballs, no edits, no pruning. Adaptation is module-seam work
   in the plugin (§2.3), never file edits (D6 discipline applied to third-party code as well; it is also what
   makes the later formal round a pure re-pin).
2. **LICENSE ships with every tree** (bash-parser MIT; shelljs BSD-3-Clause with its embedded wrench-js MIT
   passages; minimatch ISC; the two @isaacs packages MIT), plus a **version-pin header comment** in each
   tree's entry point (`// vendored transitional: <name>@<exact-version>, fetched <date>, sha256 <…> — to be
   replaced by the formal add-package.sh pin`).
3. **`VENDOR.md` states the transition explicitly**: these copies are invisible to `ensure`/`closures` (a
   tree without a pin+stamp silently diverges — vendor-package skill, trap list), serve development and
   Node-based tests only, and **must** be replaced by the formal round — `add-package.sh fetch/pin` into
   `NPM_PACKAGES` (`vendor/npm/<name>@<ver>`), per-host embed rows, regen, the two-commit `closures` order —
   before any device-facing closure is claimed. No `preset roster` row before the embed exists.
4. The plugin's module map resolves `bash-parser`, `shelljs`, `fast-glob` (→ our provider), `minimatch` and
   the two `@isaacs/*` names to these local trees during the transitional period, so the seams are exercised
   exactly as they will be after the formal round swaps the resolution roots.

## 6. Disclosed dialect deltas (loud, never silent)

The tool description (the `SHELL_DESCRIPTION` analogue) must state, in prose the model reads before its first
command: grep/sed patterns are **JavaScript RegExp, not POSIX BRE/ERE** (`\d`, `+`, lookahead work; `\(` does
not — Spike B §6 probes 15–17; sed string patterns carry no flags, so `s///g` needs a caller-supplied `/g`
regex); `sort`/`uniq` compare with `localeCompare`; output text is utf8 end-to-end with trailing-newline
conventions per shelljs; `ls` never shows `.`/`..` and marks nothing without `-l` (refused); whole-file reads
are bounded by the host's max read size (oversize → named `invalid` error); `env` shows the shell's variable
table, not a host environment. Each is a *disclosed* divergence — the house rule forbids silent ones, not
documented ones.

## 7. Risks (one line each)

1. bash-parser is unmaintained since 2017-06-22 — every bug is ours; exact-pin 0.5.0 forever.
2. The 230 KB babylon ships unconditionally even though `$((…))` is refused — pure weight until a
   handwritten-parser swap removes it.
3. The `process.env.NODE_NEV` per-parse read hard-fails without a `process` binding — the
   `globalThis.process ??= {env:{}}` guard must run before the first parse (Spike A verified the failure).
4. The 91-file CJS closure bundling was never exercised by the spike — first `build/build.sh sync` +
   `closures` run is the integration checkpoint.
5. bash-parser grammar errors are plain `Error`, not `SyntaxError` — error classification is message-text
   matching (fragile across a re-pin).
6. Dialect corners beyond the checklist are unaudited — mitigated by the node-type whitelist refusal, but
   the refusal inventory must be maintained as node types are added.
7. The gateway face kills chmod/ln/touch and `cp -p`/`ls -l` — the MVP is narrower than Spike B's shim-face
   tables; scope creep toward "just emulate it" is the failure mode to resist.
8. minimatch ≥10.1.0 is BlueOak-1.0.0 — any bump past 10.0.3 is a license-policy decision, not a routine
   re-pin.
9. shelljs is BSD-3-Clause (not MIT) with embedded MIT passages — pin/license records must say so exactly.
10. Transitional `vendor/` staging is outside the closures gate — divergence risk until the formal round
    lands; keep the window short.

## 8. Supersession (2026-10-11, owner-directed) — the bash-parser adoption is revoked; the hand-written subset parser takes the seat

Same day as §1, the owner directed the swap that retires it: **bash-parser@0.5.0 is out of the
closure**, and the parser is the hand-written recursive-descent bash-subset parser,
`runtime/dsh/system-plugins/dsh-shell-js/parser-syntax.js` (423 lines), re-exported through
`parser.js`'s vendor seam so `exec.js`'s import is unchanged. The directive's grounds are §1's
own accepted costs turned verdict: the dependency is unmaintained (~9 years) and its closure
costs ~0.7 MB per host embed — mostly bytes for constructs the executor refuses. The swap
preserved the executor-observable contract: the supported-dialect AST is byte-identical to
bash-parser's (74-case differential at swap time), the fold table is bash-parser's exact one,
`exec.js` is untouched, the panel suite — `test/panel/shell-js.test.js`, 86 cases, the dialect
contract — passed **unmodified**, and the e2e scenario logged 35/35 in order. Constructs outside
the whitelist now fail at PARSE time by name (exit 2 naming the construct — command
substitution, arithmetic, heredocs, process substitution, brace groups, loops/conditionals/
functions, parameter-expansion operators, extglob/ANSI-C quoting), ending §1.5's message-text
error classification.

### The diligence behind the directive

Five candidates measured before the hand-written route was chosen — the full record is
`D-parser-survey.md` in this directory (method, per-candidate measurements, the engine probe);
the decisive facts:

- **bash-parser@0.5.0** (incumbent): 21 runtime deps, last publish 2017-06-22; closure
  29 packages / 1.6 MB — magic-string 388 KB + babylon 292 KB (a full Babel 6 parser, carried
  for string escaping alone).
- **@ericcornelissen/bash-parser@0.5.3** (fork, verified real scoped package): 17 deps, last
  publish 2024-06-08, "dependency maintenance" fork (2 stars); closure 24 packages / 1.6 MB,
  **still dragging babylon + magic-string** — no substantive improvement.
- **mvdan-sh@0.10.1**: the premise needed correcting — it does NOT need WebAssembly (single
  1.4 MB GopherJS-transpiled `index.js`, zero wasm occurrences); excluded because it
  `require("util")` and uses `process.stderr`/`process.exit` while the dsh-cli engine measures
  `process=undefined`/`require=undefined`, plus the 1.4 MB single-file closure.
- **web-tree-sitter@0.27.1**: premise confirmed — needs the JS WebAssembly API (dozens of
  `WebAssembly.*` references in the bundle; ships a 210 KB `web-tree-sitter.wasm`), and the
  engine probe shows `typeof WebAssembly === 'undefined'` with quickjs-ng upstream refusing to
  embed WASM (github.com/quickjs-ng/quickjs/issues/75) → structurally unavailable.
- **unbash@5.0.0**: the only technically feasible vendor candidate (0 deps, pure ESM, ISC,
  57.6 KB tarball) — but young and churning (first publish 2026-02-25; 21 releases, 5 breaking
  majors in 7 months). The owner directed the hand-written route anyway: the dialect contract
  comes in-repo, pinned by the 86-case panel suite, not by an upstream release train.

### What the swap settles

- **The license gap closed by subtraction**: `curry@1.2.0` and `filter-iterator@0.0.1` (no
  license field; recorded UNKNOWN, never assumed MIT) leave WITH the bash-parser closure — the
  vendor-round follow-up "confirm intended licensing upstream with bash-parser" is moot; its
  subject is gone from the tree. The dsh-shell-js vendor block drops **33 rows → 4** (shelljs +
  minimatch + the two @isaacs packages; `ensure-dsh.sh` comment block updated at swap time).
- **§7 risks retired**: 1 (unmaintained pin), 2 (babylon weight), 3 (the `NODE_NEV` process
  shim), 5 (message-text error classification), and 6 in its bash-parser form (unaudited
  grammar tables behind a node-type whitelist — the parser now refuses out-of-dialect
  constructs by name at parse time). Risks 4 and 10 were already settled by the formal vendor
  round (T-0211). The swap's own new risk — the hand-written parser's correctness — is carried
  by the 86-case panel dialect contract plus the 74-case differential against bash-parser at
  swap time.
- **What stands**: §2 (shelljs applet bodies), §3 (minimatch glob), §4 (applet list and
  refusals), §5→ the formal vendor round, §6 (dialect disclosures) are untouched by the swap;
  risks 7–9 remain live.
