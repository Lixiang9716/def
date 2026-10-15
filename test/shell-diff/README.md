# shell-diff — the bash differential harness for dsh-shell-js

Test-hardening row 6 (`doc/test-coverage.md`). The dsh-shell-js executor
claims a bash-subset dialect; this harness holds it to that claim by
feeding the SAME script to two seats and comparing the normalized results:

- **dsh seat** — the dsh-shell-js executor, driven through the REAL
  ToolRuntime `shell` dispatch on the desktop CLI (`driver.mjs`, booted
  exactly like the e2e scenarios);
- **bash seat** — real `bash`, `LC_ALL=C`, in a scratch tree that mirrors
  the dsh workspace layout (`run-bash.mjs`).

A difference between the seats is only ever a finding after normalization
(scratch roots scrubbed to workspace-relative spellings, CRLF folded,
plus any per-case rule the CASE DATA declares — `normalizeStdout:
"trim-leading-spaces"` on `pipe-grep-wc` scopes out the reference wc's
BSD-vs-GNU padding so both platforms assert the product exactly; declared
per case, never applied silently) and after classification against the
dialect contract (below). Unexpected differences are bugs: they fail the
leg, and the generated `divergences.md` lists them with both sides'
evidence.

## Layout (data and assertions are separate)

| file | role |
|---|---|
| `cases.json` | THE case matrix — scripts, fixtures, and per-case expectations. Data only; the same object is the `--bus-inject` payload the dsh side consumes. |
| `driver.mjs` | the dsh-side runner (in-runtime scenario → `dsh-results.jsonl`) |
| `run-bash.mjs` | the bash-side runner (node spawns `bash` → `bash-results.jsonl`) |
| `compare.mjs` | normalization + assertions + `report.json` + `divergences.md` |
| `run.sh` | the one-command orchestrator (materialize → build → dsh side → bash side → compare) |

Artifacts land in `runtime/dsh/artifacts/shell-diff/` (`report.json`,
`divergences.md`, both raw JSONL files, `receipt.json`); scratch lives
under gitignored `tmp/shell-diff/`.

## Running

```sh
sh test/shell-diff/run.sh
```

Exit 0 = every case matches its expectation (including pinned, known
divergences). Exit 1 = a case found a difference the matrix did not pin —
triage it against the contract, then either fix the executor, or (only if
the difference is real, undisclosed, and here to stay) pin it in
`cases.json` with an honest `note`.

## Case expectations (`kind` in cases.json)

- `match` — exit + stdout + stderr identical after normalization.
  `stderrFree: true` relaxes ONLY the error text: exit + stdout must agree
  AND stderr must be silent on both sides or loud on both sides. The
  dialect contract promises GNU exit codes and stdout, not GNU error
  wording.
- `refusal` — the dsh side must refuse with the documented shape (exit
  code, empty stdout, stderr naming every needle). The bash side's result
  is recorded as differential context, never equated — the whole point of
  these cases is that bash RUNS what dsh refuses by name.
- `divergence` — a KNOWN, pinned difference. Passes only while the dsh
  side still matches `expectDsh` AND the seats still differ. A silent fix
  or a behavior drift trips the case and forces re-triage (promote to
  `match`, or re-pin with a fresh honest note). An `expectDsh.exitCode` of
  `-1` pins a dispatch the tool layer killed at its 120s budget — the
  pipeline-refusal deadlock's signature.

## Seat capability note (read before extending the matrix)

The desktop CLI dev backend serves `fsRead`/`fsWrite`/`fsScope`/`fsStat`
only; `fsList`/`fsMkdir`/`fsRename` answer the honest `unavailable`
refusal. Word-position globs therefore cannot DIFFERENTIALLY run on this
seat — the glob family pins the observed refusal (itself finding-shaped:
the gap surfaces as exit 1 instead of the documented exit-2
primitive-naming refusal), with bash's real expansion recorded as context.
If the seat ever serves `fsList`, those cases TRIP and must be promoted to
real match differentials — the tripwire is the point.

## What the classification round found

The pinned divergences in `divergences.md` are the deliverable's second
half. Headlines (all pinned, none fixed here — the executor's files are
outside this harness's file scope):

- **Deadlock**: a word-expansion refusal in a pipeline's FIRST member
  parks the line forever — the pipe writer is never closed, the tool
  layer kills the dispatch at 120s.
- **Quoted words glob**: bash never glob-expands a quoted word; dsh checks
  the expanded text for glob magic regardless of quoting.
- **Assignment values don't expand** (`B=${A}bar` stores the literal).
- **No IFS word splitting** on unquoted expansion.
- **wc's missing-file failure is a construct refusal** (exit 2, stops the
  `;`-line, bypasses `2>`) where bash fails the command (exit 1, line
  continues) — while cat's missing-file failure behaves bash-like. The two
  applets disagree with each other.
- **Prefix assignments leak into the command's own expansion**
  (`A=1 echo $A` prints `1`; bash prints an empty line).
- **Pipeline status**: `no-such-applet | cat` answers 1 where bash takes
  the last member's 0.
- Redirect targets skip glob expansion; the CLI backend's fsWrite
  materializes missing parents (bash's fopen does not).

Platform note on the reference seat: `wc` pads counts BSD-wise on macOS
and prints them bare on GNU — CI's Linux (GNU) reference already agrees
with dsh byte-for-byte (`pipe-grep-wc` is a `match` there); the case's
declared normalization keeps a macOS-local run green too.

## The dialect contract this matrix holds dsh-shell-js to

The honored subset (parser-syntax.js / exec.js / the tool description in
the plugin's index.js): pipelines `a | b` (status = last member), `&&` /
`||`, `;` and newline sequences, redirects `>` `>>` `2>` `2>>`, `FOO=bar`
assignments, `$VAR` / `${VAR}` expansion, globs `* ? […]` in word position
(no match → the literal word, expansion byte-sorted), single/double
quotes, backslash escapes, `#` comments.

Everything else is refused BY NAME (exit 2; unknown programs 127): heredocs
`<<`, here-strings `<<<`, input redirects, `&>`/`>&`/`>|`/`<>`,
subshells, groups, if/while/for/case, functions, `$((…))`, `$(…)`,
backticks, parameter operators, special parameters, background jobs,
`chmod`/`ln`/`touch`.

Disclosed dialect notes (SHELL_DESCRIPTION): grep/sed patterns are
JavaScript RegExp, not POSIX BRE/ERE; sed takes the no-separator form;
sort/uniq compare with localeCompare; all I/O is whole-file utf8; env
prints the shell's variable table, not a process environment.

The matrix stays INSIDE the contract: families pipes, redirects,
variables, globs, quotes, heredoc (simple form → the documented refusal),
plus `;`/`&&`/`||` sequencing and the exit-status rules. Cases are
ASCII-lowercase so localeCompare and C-collation orders coincide; glob
fixtures are created in non-sorted order so an unsorted expansion could
not hide.

## CI

The c-core workflow runs this harness as a Linux leg (ubuntu runners have
real bash), after the core build and test legs; the report + divergence
list ride the workflow's artifact upload even on red.
