# Agent Note: issue 501: four refusal wordings made truthful — sed's s/// shape, the bare join newline, the unavailable class's exit code, cd's missing path

Status: implemented
Related: D6 (outboard adaptation discipline); T-0231 (the closing card); #501
(the filed leftovers). Extends the 2026-10-13 first-catch note — the four
observations it explicitly left un-nailed after the T-0217 loop closed.

## Problem

The T-0217 standing loop's round 2 verified zero wild-refusal regressions
but left four non-wild wording/口径 nits, each most likely to trip a real
agent:

- `sed 's/beta/BETA/' notes.txt` answered exit 2 with "no files given
  (no pipeline stdin either)" — the file WAS given. The seat's sed dialect
  is the no-separator form `sed <regex> <replacement> <file...>`; without
  a shape probe the s/// string silently ate the file as the replacement
  and the by-name refusal told a falsehood about reality.
- `grep`/`sort` on a missing file emitted a bare leading newline on stdout
  (the pristine bodies' `join('\n') + '\n'` over the zero lines their
  guards leave), where the rest of the refusal family — cat/head/tail/wc
  and every throwing body — reports empty stdout.
- `mkdir` (including -p) and `find` on a host whose backend supplies
  fewer than the seven fs primitives (main_cli.c's smoke backend:
  fsRead/fsWrite/fsStat/fsRemove only) answered the contract's honest
  `unavailable` but fell off the executor as the generic exit-1
  "pipeline member failed" — where the refusal family's convention is
  exit 2 with stderr naming what is missing, the same convention ls/mv
  ride through the same mapping.
- `cd <missing>` answered "not a directory" — the contract's stat replies
  `kind:"other"` for a missing path, and the kind check read every
  non-dir as the wrong kind instead of distinguishing the miss.

## Decision

- `appletSed` probes the first argument for the s/// SCRIPT SHAPE
  (s, delimiter, content, the same delimiter, content, delimiter again,
  optional letter flags) and refuses by name: "looks like an s/// script —
  this seat's sed takes <regex> <replacement> <file...>". The probe is
  WORDING ONLY — the s/// form stays unsupported on purpose (T-0217's
  design declaration: the refusal boundary is the contract).
- `shellStringOutcome` carries one family-wide normalization: a refused
  body (code !== 0) never carries a bare `"\n"` stdout. Real partial
  output with a non-zero code (one existing file matched, another missing)
  is not a bare newline and passes through untouched.
- The executor maps a `GatewayError` answering `unavailable` at the
  member boundary onto the refusal family — `unavailableRefusal` in
  applets-support (the vocabulary's home), thrown as a ShellRefusal(2)
  whose stderr names the missing primitive and the host's own message.
  io errors stay exit 1 (bash-like); only the capability gap moves to 2.
- `appletCd` distinguishes the contract's `kind:"other"` miss from a real
  file: a missing path reads "no such file or directory" (the read face's
  wording), only an actual FILE reads "not a directory".
- Four pins joined `test/panel/shell-js-applets.test.js` (the s/// shape
  refusal with the dialect still working, sort's empty-stdout refusal,
  the unavailable class through a denied-primitive fault table on the
  panel gateway shim, cd's missing-vs-file wording split) and the grep
  convention pin grew the empty-stdout assertion. Panel 470/470.

## Alternatives considered

- **Implementing the s/// form** — rejected outright: T-0217's standing
  declaration is that the refusal boundary IS the contract; teaching sed
  a second dialect to spare one error message inverts that.
- **Stripping the artifact newline inside the vendored grep/sort
  bodies** — rejected: the bodies are byte-pristine vendored shelljs
  (D6); ALL adaptation lives in the wrappers. The normalization sits in
  the wrapper's outcome mapping, one home, family-wide.
- **Mapping `unavailable` to exit 127 or 1** — rejected: 127 is the
  unknown-PROGRAM code and this is a known program hitting a missing
  capability; exit 1 is the io/crash code and a capability gap is not an
  error to retry (contract/primitives.md §4). The refusal family's 2 is
  the convention the support table already declares.
- **Teaching cd to stat twice or pre-probe with existsSync** — rejected:
  the contract already answers the miss (`kind:"other"`); one honest
  branch on the reply it gives beats a second round trip.
- **Extending main_cli.c with fsList/fsMkdir instead** — still deferred
  exactly as the first-catch note left it: widening the smoke backend is
  a capability change with its own receipt; the `unavailable` answer
  itself is contract-honest and now worded honestly too.
