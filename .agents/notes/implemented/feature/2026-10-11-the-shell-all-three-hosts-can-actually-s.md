# Agent Note: the shell all three hosts can actually share — dsh-shell-js lands the seat, the vendor round, and the e2e leg

Status: implemented
Related: D6, D5, T-0211/T-0212/T-0213, the three same-day leg notes (the
parser-closure vendor round and the seat switch under `implemented/architecture/`,
the CLI e2e under `implemented/testing/`), and the research record this note
indexes: `.agents/research/shell-js/` (DECISION.md + spike reports A/B/C,
copied verbatim out of the gitignored `tmp/shell-js-spikes/` scratch so the
links below hold)

## Problem

The 2026-09-22 decision ("the shell an iOS host can actually have —
WebAssembly, interpreted in-process") held the seat, and its own consequence
list was the case against leaving it there: every shipped module was
hand-assembled with `wat2wasm`, the starter set was one program (`echo`, no
`ls`/`cat`), and a real command set waited on a wasm32 toolchain (Rust,
TinyGo, or LLVM — measured absent on this machine) that is a toolchain
install, not a code change. Worse for a three-host product: only iOS ever
had a `wasmRun` implementation, so Android and HarmonyOS shell runs answered
`unavailable` — the asymmetry the 09-22 note itself had rejected
`ios_system` for, reproduced one layer down. The other mounted executor,
dsh-shell-ish (contract v1.3.0), bought a REAL busybox `/bin/sh` — an
aarch64 Alpine rootfs emulated in-process by the vendored iSH engine
(`runtime/dsh/system-plugins/dsh-shell-ish/index.js:1-13`) — at the price of
a per-host engine embed, and the one host with no local shell ecosystem to
borrow from (HarmonyOS; see Alternatives) had nothing of the kind to embed.
Meanwhile a third executor had been decided in scratch — DECISION.md plus
spike reports A/B/C under the gitignored `tmp/shell-js-spikes/` — but
dsh-shell-js was mounted nowhere, and with three shell plugins in the tree
the seat answer depended on mount order (the seat-switch note's Problem).

What moved was the premise, not a new affection for JS: the requirement
changed from "one host's seam" (09-22's question) to ONE shell implementation
serving all three hosts, and the gateway's fs face — seven primitives,
per-call audit — makes a JS executor's every file effect a real, audited
contract call rather than the pretend-program the 09-22 note rejected. The
route was settled in the scratch decision record; three legs landed it the
same day, each with its own note. This note records the decision itself, the
costs accepted with it, and the supersede of the 09-22 verdict on the JS
route.

## Decision

One JS executor holds the shell seat on all three hosts.
`runtime/dsh/system-plugins/dsh-shell-js/` (eleven files) is the one `shell`
tool: boot.js carries one static import, one mount, one inventory row, and
every host staging list swapped to its files the same day while
dsh-shell-wasm and dsh-shell-ish left them (their source trees stay — the
local engine gates and workspace installs still read them; the seat-switch
note). The executor clones the shell-wasm shape the upstream tool layer
consumes: `resolve` normalizes `{command, workdir, timeoutMs, stdoutMaxBytes}`,
`run` returns `{exitCode, stdout, stderr}` (`index.js:50-67`), with
`timeoutMs`/`stdoutMaxBytes` normalized and carried but not enforced in v1 —
the same disclosure as the wasm sibling (`index.js:52`, `:116`); the loop
constructs that could hang are refused, so the exposure is bounded applets.
Everything not honorable fails loud: exit 2 naming the missing construct or
primitive plus the D5 contract-proposal path, 127 self-describing with the
applet list (`exec.js:38`, the SHELL_DESCRIPTION inventory `index.js:96-117`).

The parser is `bash-parser@0.5.0`, vendored, with Spike A's **degrade**
verdict accepted and the costs written out (DECISION §1): the ~388 KB /
91-file closure carries `babylon` (230 KB, 60%) unconditionally for the
REFUSED `$((…))` arm (`arithmetic-expansion.js:5` requires it at module
load — pruning means editing upstream bytes, D6-forbidden); the package is
unmaintained since 2017-06-22, so the pin is exact forever; it reads
`process.env.NODE_NEV` on every parse, so the plugin fills `globalThis.process`
at the vendor chokepoint (a guard whose placement the seat switch itself
corrected once — the seat-switch note); grammar errors arrive as plain
`Error`, so parse-failure classification is message-text matching; and the
dialect corners the spike never probed are neutralized structurally — a
node-type whitelist, with any other AST node type refused by name, exit 2
(DECISION §4.3), so unaudited corners fail safe rather than silently wrong.

Applet bodies come from shelljs 0.10.0 vendored **byte-pristine**, with all
adaptation in five outboard seams (DECISION §2.3): an `fs` adapter mapping
the calls the included bodies make onto the seven gateway fs primitives
(`manifest.json`'s required list is exactly those seven — including an
in-memory fd emulation so head/tail's pristine `openSync`/`readSync` bodies
run unmodified over whole-file reads), a thin glob provider standing in for
fast-glob, link-time `child_process`/`execa` stubs that refuse at call time
(subprocess is structurally impossible — AGENTS non-negotiable #2), the
applet wrapper owning the by-name refusal table, and the cwd/variable
session. The 22 MVP applets (DECISION §4.1): 14 from shelljs Table 甲
whole-file, `cp`/`find` from Table 乙 adapted at the wrapper, 4 hand-written
(`wc`, `env`, `basename`, `dirname` — absent from shelljs), and 2 thin ones
over repo modules — `sha256sum` over `sha256Hex` (`runtime/dsh/sha256.js:43`)
and `tar` over `tarWrite`/`tarRead` (`runtime/dsh/tar-mini.js:53,84`),
uncompressed because the frozen gateway has no inflate primitive
(`tar-mini.js:4-9`).

Glob is `minimatch@10.0.3` — the ISC ceiling (10.1.0+ relicenses to
BlueOak-1.0.0; crossing that line is a license-policy decision, not a re-pin)
— plus `@isaacs/brace-expansion@5.0.1` and `@isaacs/balanced-match@4.0.1`.
Spike C's verdict was pass: 45/45 probes byte-identical to Node on the
pinned engine, pure JS, no Node builtins. minimatch answers pattern ↔ path
only; the walking is a hand-written descent over `fsList` (byte-sorted per
contract, so expansion order is deterministic for free), with the bash
default — no match passes through as a literal word — and `{noext: true,
dot: false}` for bash parity (DECISION §3).

The three legs, one sentence each: the vendor round replaced the
transitional in-plugin staging with the formal machinery — 33 packages
mirrored as tarballs, pinned by sha256 in `NPM_PACKAGES`
(`runtime/dsh/vendor/ensure-dsh.sh`), embedded on all three hosts in the
two-commit `closures` order (the vendor-round note); the seat switch put
dsh-shell-js into boot.js and took wasm/ish out of every staging list (the
seat-switch note); and the e2e leg proves the seat by log — nine command
lines through the real ToolRuntime on a booted mobile profile, each emitting
one `shell/call` → one `shell/stdout`/`shell/refused` → one `shell/exit`,
35 records matched one-to-one by scenario `dsh-shell-js`, wired into
`build/build.sh` test core (the testing note).

## Alternatives considered

- **The 09-22 note's rejection of the JS dispatcher — superseded.** That
  note considered "keep the shell logic in the plugin (JS) and let WASM
  provide utilities" and rejected it: "That is not a shell; it is a command
  dispatcher with a WASM library behind it, and the model's `cat file` would
  be JS pretending to be a program"
  (`.agents/notes/implemented/feature/2026-09-22-the-shell-an-ios-host-can-have-wasm-in-proces.md`,
  Alternatives, fourth bullet). The rejection was correct for its question —
  that note was choosing a program SEAM for one host, where a JS layer under
  the wasm PATH would indeed have simulated program-ness. Today two premises
  are different, and both are load-bearing. First, unification: the target is
  one shell on three hosts, and every per-host engine answer (ios_system, the
  iSH engine, a wasm interpreter) reproduces the asymmetry where at least one
  host answers `unavailable` — while a pure-JS closure runs on the quickjs-ng
  every host already embeds. Second, the gateway's per-call audit: the fs
  adapter maps every file touch onto the seven audited fs primitives, so
  `cat file` is not JS pretending to be a program — it is a tool whose every
  effect is a contract primitive call in the gateway's audit record, and the
  tool description says so in prose the model reads before its first command
  (DECISION §6). Where the 09-22 design would have hidden the seam behind a
  program metaphor, this one retracts the metaphor: unsupported constructs
  fail loud by name. The 09-22 note's own decision (the `wasmRun` seam) is
  NOT superseded — the capability stays granted and the engine stays; this
  note retires only its verdict on the JS route as the shell-seat answer.
- **The per-platform shell ecosystems: UTM / iSH / Termux.** Each relevant
  platform has a real local-shell answer as a user application: UTM (a full
  virtual machine on iOS), iSH (x86 Linux emulation in-process on iOS — the
  very engine dsh-shell-ish vendored), Termux (Android's terminal and pkg
  userland). None of them is an embeddable cross-host seam: each is a
  per-platform application whose engine would have to be lifted and embedded
  per host — the exact asymmetry the 09-22 note rejected `ios_system` for —
  and HarmonyOS has no local shell ecosystem at all, so there is nothing to
  lift for the third host. "Bring the platform's own shell" cannot unify
  three hosts; a shell the repo owns in JS can.
- **A hand-written bash-subset parser** — rejected (DECISION §1, "why not
  hand-written"): it would trade ~388 KB of pinned, probe-verified bytes for
  unbounded correctness risk concentrated exactly where hand-rolled shells
  break (quoting, escaping, expansion interleaving); parser over-coverage
  costs nothing semantically because the refusal table refuses unimplemented
  node types by name.
- **Vendoring fast-glob** — rejected (DECISION §2.3, Spike B §7.2): seven or
  more packages whose @nodelib walkers are designed for real disks; the
  shell needs only minimatch's pattern ↔ path answer plus its own `fsList`
  walker.
- **minimatch ≥ 10.1.0** — not a routine re-pin: the BlueOak-1.0.0
  relicensing makes any bump a license-policy decision; 10.0.3 is the ISC
  ceiling (DECISION §3).
- **Keeping the transitional in-plugin `vendor/` staging** — rejected (the
  vendor-round note): a tree without a pin+stamp is invisible to
  `ensure`/`closures` and can never reach a device embed list; the window
  DECISION §5 opened is now closed.

## Consequences

- **The vendor staging window is closed.** The transitional state DECISION
  §5 planned (in-plugin `vendor/` trees + VENDOR.md, invisible to the gates,
  device builds with no path to the bytes) existed only between the decision
  and the formal round; both the trees and VENDOR.md are deleted, the
  closure is pinned by sha256 and embedded on all three hosts, and the
  pin-record duty moved into the `ensure-dsh.sh` comment block (the
  vendor-round note).
- **The narrow gateway face is a rejection list, by name.** `chmod`, `ln`,
  `touch` (no permission, link, or timestamp primitive exists — each refusal
  names the missing capability and the D5 contract-proposal path;
  `applets.js:128` REFUSED_COMMANDS), `cp -p` (no owner/timestamp to
  preserve), `ls -l` (no mode/owner exists to render — a degraded `-l`
  printing blanks would be the silent meaning change the house rule
  forbids), `tar -z` (no inflate), long options wholesale, and any flag
  outside an applet's implemented set (`applets-support.js:219-221`). Scope
  creep toward "just emulate it" is the named failure mode to resist
  (DECISION §7, risk 7).
- **Low items, kept loud.** `head -c` is refused today: the wrapper wires
  only `-n` (`applets-shelljs-cmds.js:168-176`) although DECISION §4.1's
  table planned both — honoring it later is a byte window over the
  whole-file read, deferred. babylon's 230 KB rides every embed (~0.7 MB per
  host) for the refused `$((…))` arm until a handwritten-parser swap.
  bash-parser is unmaintained, so grammar-error classification by message
  text is re-pin-fragile (DECISION §7, risk 5). curry@1.2.0 and
  filter-iterator@0.0.1 ship no license field and are recorded UNKNOWN, not
  assumed MIT; confirming bash-parser's intended licensing upstream is open
  follow-up (the vendor-round note). The dialect deltas (grep/sed patterns
  are JavaScript RegExp, not POSIX BRE/ERE; `localeCompare` compares;
  whole-file utf8 I/O bounded by the host max read; `env` prints the SHELL
  variable table; `tar` is uncompressed; `ls` never shows `.`/`..`) are
  disclosed in the tool description, never silent (DECISION §6).
- **The decision record itself moved into the repo.** DECISION.md and the
  three spike reports now live at `.agents/research/shell-js/` (copied
  byte-identical from the gitignored scratch, original filenames kept so the
  documents' internal cross-references stay valid), and this note is their
  index into the notes plane.
