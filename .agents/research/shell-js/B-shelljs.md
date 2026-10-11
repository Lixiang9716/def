# Spike B — shelljs as the applet-body source for `dsh-shell-js`

**Verdict up front:** shelljs 0.10.0's command layer is a strong fit for the applet body.
23 of its 34 source files (the 甲 table below) use only fs methods our VFS shim already
exports, all synchronously. The fs debt beyond our surface is exactly five methods
(`linkSync`, `fchownSync`, `futimesSync`, `appendFileSync`, plus stat-classifier gaps) —
each a one-line-to-tens-of-lines adaptation. The two real costs are (1) shelljs is **not
MIT — it is BSD-3-Clause**, and (2) it is **no longer dependency-free**: `common.js`
requires a glob engine (`fast-glob`) at link time, so every command — even the in-surface
ones — needs a VFS-backed `glob.sync` provider (or `set('-f')` semantics) to load and run.
Only `exec`/`exec-child`/`cmd` are structurally unportable (subprocess). Note also:
**`wc`, `env`, `basename`, `dirname` do not exist in shelljs at all** — those applets must
come from another source.

All work for this spike happened inside the worktree `/Users/lixiang/workspace/dsh-mobile-shell-js`
(branch `feat/dsh-shell-js`, worktree clean at start and end; `tmp/` is gitignored,
`.gitignore:272`). Nothing was committed or pushed. No file outside this worktree was
read or written for the analysis (the injected AGENTS.md context excepted).

---

## 1. Scope and method

- Shim side: read `runtime/dsh/upstream/shims/fs.js` (424 lines) and
  `runtime/dsh/upstream/web-shims.js` (437 lines), plus the split siblings the fs
  surface actually lives in (`fs-stat.js`, `fs-writes.js`, `fs-readdir.js`, `fs-paths.js`,
  `fs-workspace.js`, `fs-workspace-rename.js`, `fs-promises.js`, `buffer.js`, `process.js`,
  `os.js`, `path.js`, `util.js`).
- shelljs side: `npm pack shelljs` → `tmp/shell-js-spikes/pkgs/shelljs-0.10.0.tgz`,
  extracted to `tmp/shell-js-spikes/pkgs/package/` (240 KB total, `src/` 184 KB,
  34 files in `src/`, 4206 lines across `src/` + top-level JS). Every one of the 34
  `src/*.js` files was read; `fast-glob@3.3.2` and `execa@5.1.1` were also packed to
  inspect their dependency trees.
- Behavior probe: `tmp/shell-js-spikes/scratch-B/` — a mock `fs` that mirrors the shim's
  export surface *and its semantics* (utf8-only reads, 3-method stat face, seconds-based
  `utimesSync`, no `appendFileSync`/`linkSync`/`fchownSync`/`futimesSync`, sorted
  `readdirSync`), a minimal `fast-glob` stand-in, and `probe.js` which patches
  `Module._load` so the **real `package/shell.js` entry** loads against them
  (`child_process`/`execa` become call-time-refusing stubs, exactly the no-subprocess
  rule). 34 probes ran, exit 0: `node probe.js > probe-out.json`.
- Commands run verbatim for this report:
  - `cd /Users/lixiang/workspace/dsh-mobile-shell-js/tmp/shell-js-spikes/pkgs && npm pack shelljs`
  - `cd /Users/lixiang/workspace/dsh-mobile-shell-js/tmp/shell-js-spikes/scratch-B && node probe.js > probe-out.json 2> probe-err.txt`
  - `grep -oh "fs\.[a-zA-Z]*(" src/*.js *.js | sort | uniq -c` (the full fs-call inventory in §4)

## 2. Premise corrections (factual, load-bearing)

1. **License is BSD-3-Clause, not MIT.** `package/LICENSE` begins "BSD 3-Clause License /
   Copyright (c) 2012, Artur Adib"; `package.json` has `"license": "BSD-3-Clause"`.
   (Two embedded functions in `src/cp.js:90-96` and `src/rm.js:12-19` carry their own
   MIT attribution from wrench-js — third-party code inside the BSD whole.) Both are
   permissive, OSI-approved, compatible with vendoring; the pin/license records just must
   say BSD-3-Clause.
2. **shelljs 0.10.0 has two runtime dependencies** (`package.json`):
   `execa ^5.1.1` (used only by `src/cmd.js:1,110`) and `fast-glob ^3.3.2`
   (used by `src/common.js:9,310` and `src/ls.js:3,109`). fast-glob's own tree adds
   `@nodelib/fs.stat`, `@nodelib/fs.walk`, `glob-parent@5`, `merge2`, `micromatch@4`
   (→ `braces`, `picomatch`); execa@5 adds 9 packages (`cross-spawn`, `get-stream`,
   `human-signals`, `is-stream`, `merge-stream`, `npm-run-path`, `onetime`,
   `signal-exit`, `strip-final-newline`) — all irrelevant if `cmd` is dropped.
   For contrast, shelljs 0.8.5 is *not* dependency-free either (`glob ^7` + `interpret`
   + `rechoir`; its `common.js:7` also requires a glob at link time), so "older = no
   glob dep" is not an escape hatch.
3. **`wc`, `env`, `basename`, `dirname` are not implemented by shelljs.** The full command
   set (from `package/shell.js`'s require block and `src/`) is: cat, cd, chmod, cmd, cp,
   dirs, echo, exec, find, grep, head, ln, ls, mkdir, mv, popd, pushd, pwd, rm, sed,
   set, sort, tail, tempdir, test, to, toEnd, touch, uniq, which (+ plugin helpers).
   `basename`/`dirname` are one-liners over the `path` shim; `wc`/`env` would be small
   hand-written applets.

## 3. The VFS shim's fs API surface (what applets may call)

`web-shims.js` installs **no fs methods at all** — it provides the Web/global seams
(`structuredClone`, `AbortController/Signal`, `console` → `__DSH_LOG_SINK__`,
`Buffer` (global), `URL`, `TextEncoder/Decoder`, `window.__ModuleLoader__`, `WebSocket`
constructor-that-refuses, `queueMicrotask`, fetch value-objects, web storage)
(`runtime/dsh/upstream/web-shims.js:58-436`). The fs surface is `shims/fs.js` and its
siblings. Everything is **synchronous or callback-shaped; the runtime has no blocking
disk** — the world is one writable in-memory workspace root plus read-only seeded views
(`shims/fs.js:28-51`).

The sync face exported by `shims/fs.js:196-203` (all REAL operations over the
workspace/seeded views, none are silent no-ops):

| Class | Methods (all real unless noted) |
| --- | --- |
| Read | `existsSync` (false outside views, `shims/fs-stat.js:241-276`), `readFileSync` (**utf8/utf-8/buffer only**, `shims/fs.js:263-268`), `statSync`, `lstatSync`, `readdirSync` (sorted names; `{withFileTypes:true}` Dirents with `isDirectory/isFile/isSymbolicLink`), `realpathSync` (+`.native`), `accessSync` (mode-checked, `shims/fs-stat.js:165-198`) |
| Write | `writeFileSync` (string\|Uint8Array), `mkdirSync` (recursive ok), `rmSync`, `rmdirSync`, `unlinkSync` (EPERM on dirs), `renameSync`, `copyFileSync`, `cpSync` (recursive), `chmodSync`, `utimesSync` (**seconds**, see below), `symlinkSync`, `readlinkSync`, `mkdtempSync` (6-char base-36 suffix) |
| fd face | `openSync` (r/r+/w/wx/a/ax), `readSync`, `writeSync`, `closeSync` (`shims/fs-writes.js:129-194`) |
| Streams/watch | `createReadStream`, `createWriteStream` (`shims/fs-write-stream.js`), `watchFile`/`unwatchFile` (real poll/registry face since P3), `realpath` (callback form + `.native`) |
| Misc | `constants` (F_OK/R_OK/W_OK/X_OK, COPYFILE_*, O_*, S_IFDIR/S_IFREG), `nextTick` |

Semantics that differ from node and matter to shelljs:

- **Stat face has exactly three classifiers** — `isFile/isDirectory/isSymbolicLink`
  (`shims/fs-workspace.js:243-248`) and data fields `size/dev/ino/mode/uid/gid/mtimeMs/
  ctimeMs` (`:253-295`). **No `atime`, no `mtime` (Date), no `nlink`, no `isFIFO`,
  `isBlockDevice`, `isCharacterDevice`, `isSocket`.**
- `utimesSync(path, atime, mtime)` reads `Number(mtime)` **as seconds**
  (`shims/fs-workspace-rename.js:194-211`) — a `Date` passed verbatim lands as
  ms-epoch-as-seconds (×1000 wrong).
- **Not exported at all:** `appendFileSync`, `linkSync`, `fchownSync`, `futimesSync`,
  `truncateSync`, `fstatSync`, `opendirSync` (`shims/fs.js:196-203` has none of them;
  the promise face has async `appendFile`/`link` at `shims/fs-promises.js:354,215`).
- `readdirSync` returns **sorted** names (`shims/fs-readdir.js:35`); node makes no
  such promise.
- Non-fs Node faces shelljs needs and the shims provide: `path.*` full set
  (`shims/path.js:90-293`, incl. `sep='/'`, `delimiter=':'`), `os.homedir/tmpdir`
  (`shims/os.js:23,37`), `process.cwd/chdir` (chdir repins the profile cwd;
  `shims/process.js:86-115`), `process.env` Proxy, `process.platform` (`'mobile'` —
  so all `win32` branches stay dead), `process.versions.node` (`'20.0.0'`,
  `shims/process.js:152`), `process.stdout.write` (no-op sink returning `true`,
  `shims/process.js:250-251`), `Buffer.alloc/from/toString(enc,start,end)`
  (`shims/buffer.js:109,63,230-243`), `util.format` subset (`shims/util.js:30`).

## 4. Per-command fs dependency census (shelljs 0.10.0 `src/`)

Full fs-call inventory (grep across `src/*.js` + top-level, counts are call sites):
`existsSync` 33, `readFileSync` 12, `readdirSync` 5, `openSync` 5, `closeSync` 5,
`writeFileSync` 4, `symlinkSync` 4, `chmodSync` 4, `unlinkSync` 3, `readlinkSync` 3,
`mkdirSync` 3, `utimesSync` 2, `realpathSync` 2, `readSync` 2, `writeSync` 1,
`statSync` 1 (plus every `common.statFollowLinks/statNoFollowLinks` call = stat/lstat),
`rmdirSync` 1, `renameSync` 1, `accessSync` 1 — **all inside our surface**.
Outside it: `linkSync` 1, `fchownSync` 1, `futimesSync` 1, `appendFileSync` 1,
`createWriteStream` 2 (exec-child only; that one *is* in our surface).

| Command | node:fs methods used | Sync? | Non-fs Node deps | In our surface? |
| --- | --- | --- | --- | --- |
| cat | existsSync, statSync, readFileSync('utf8') (`cat.js:38-44`) | yes | — | ✅ |
| ls | statSync, lstatSync, readdirSync (`ls.js:86,125,130`) + **fast-glob** for `-R` (`ls.js:109`) | yes | path, process.platform, fast-glob | ✅ except glob seam |
| grep | existsSync, readFileSync (`grep.js:96,101`) | yes | — | ✅ |
| sed | existsSync, readFileSync, writeFileSync(-i) (`sed.js:71,76,85`) | yes | — | ✅ |
| head | existsSync, statSync, openSync/readSync/closeSync, readFileSync (`head.js:18-29,72,87`) | yes | Buffer.alloc + buf.toString('utf8',0,n) | ✅ |
| tail | existsSync, statSync, readFileSync (`tail.js:59-70`) | yes | — | ✅ |
| sort | existsSync, statSync, readFileSync (`sort.js:74-85`) | yes | `localeCompare` | ✅ |
| uniq | existsSync, statSync, readFileSync (`uniq.js:48-58`) | yes | `localeCompare`, `to()` for output | ✅ |
| mkdir | existsSync, lstatSync, mkdirSync (`mkdir.js:23,29,63,85`) | yes | path.dirname/resolve | ✅ |
| rm | readdirSync, lstatSync, statSync, rmdirSync, unlinkSync, openSync('a')/closeSync (`rm.js:23,60,88`) | yes | `Date.now` retry (win-only) | ✅ |
| mv | existsSync, statSync, renameSync (`mv.js:55-104`) + cp/rm on EXDEV | yes | path.resolve/dirname/basename | ✅ |
| cp | existsSync, statSync, lstatSync, readlinkSync, symlinkSync, openSync/readSync/writeSync/closeSync, mkdirSync, readdirSync, utimesSync, chmodSync, realpathSync, unlinkSync (`cp.js` throughout) | yes | path, **fchownSync+futimesSync under `-p`** (`cp.js:78,81`) | ⚠️ `-p`/`-u` exceed |
| touch | statSync, openSync('a')/closeSync, utimesSync (`touch.js:74,106`) | yes | Date objects → utimes | ⚠️ Date≠seconds |
| ln | existsSync, unlinkSync, symlinkSync; **linkSync** for hard links (`ln.js:45,59,68`) | yes | path, process.cwd | ⚠️ linkSync missing |
| chmod | statSync, lstatSync, readdirSync, chmodSync, existsSync (`chmod.js:94-121,200,217`) | yes | path.resolve, console.log(-v/-c) | ✅ |
| find | statSync + delegates to ls(-R) → fast-glob (`find.js:50,58`) | yes | path, glob transitively | ⚠️ via ls |
| test | existsSync, statSync, lstatSync (`test.js:57,63,67`) | yes | needs isBlockDevice/isCharacterDevice/isFIFO/isSocket for -b/-c/-p/-S (`test.js:69-81`) | ⚠️ classifiers |
| echo | — (no fs) | yes | util.format, process.stdout.write (`echo.js:50,57`) | ✅ (stdout is a no-op sink) |
| to | existsSync, writeFileSync (`to.js:26,31`) | yes | path.dirname | ✅ |
| toEnd | existsSync, **appendFileSync** (`toEnd.js:30`) | yes | path.dirname | ⚠️ appendFileSync missing |
| pwd | — | yes | path.resolve, process.cwd (`pwd.js:13`) | ✅ |
| cd / pushd / popd / dirs | statSync (cd error path) | yes | os.homedir, process.chdir/env.OLDPWD, process.cwd (`cd.js:13-26`) | ✅ (shim has real chdir) |
| which | existsSync, statSync, accessSync (`which.js:33,41`) | yes | process.env.PATH, path.delimiter/resolve | ✅ (vacuous: no binaries in VFS) |
| tempdir | existsSync, statSync, writeFileSync, unlinkSync (`tempdir.js:12-24`) | yes | os.tmpdir, process.env.TMPDIR… | ✅ |
| set / error / errorCode | — | yes | — | ✅ (pure state) |
| exec | writeFileSync/readFileSync/unlinkSync + **child_process.execFileSync/exec** (`exec.js:3,100,147`) | sync/async | child_process, process.execPath, streams | ❌ subprocess |
| exec-child | readFileSync, createWriteStream + **child_process.spawn** (`exec-child.js:2,33-34`) | child | child_process, process.exitCode | ❌ subprocess |
| cmd | **execa.sync** (`cmd.js:1,110`) | yes | execa tree | ❌ subprocess |
| common.js (core) | unlinkSync, chmodSync, statSync, lstatSync (`common.js:342-368`) | yes | os.homedir (`:440`), **fast-glob.sync** (`:310`), process.versions.electron/execPath/env.OLDPWD, Buffer.alloc, console.error, Math.random | ⚠️ glob at link+runtime |

Every command is synchronous (the only async is `exec`'s callback mode). No command uses
fs Promises, `node:path/posix` win32 split, workers, or timers.

## 5. Classification

### Table 甲 (A) — fs deps fully inside the shim surface; usable as-is

Whole-file reuse, no source edits required (probe-confirmed where marked ✅P):

cat ✅P, grep ✅P, sed ✅P, tail ✅P, head ✅P, sort, uniq, mkdir ✅P, rm ✅P, mv ✅P,
chmod, to ✅P, echo, pwd, cd, pushd, popd, dirs, which ✅P, tempdir, set, error,
errorCode.

(File census: 21 substantive files + `popd.js`/`pushd.js`, which are two-line
"// see dirs.js" pointers — 23 of 34. The other 11 files: 8 in Table 乙, 3 in Table 丙.)

Caveat that applies to the whole table: `common.js` (the shared wrapper every command
registers through) requires `fast-glob` at **link time** and calls `glob.sync` for any
glob-bearing argument at **runtime** (`common.js:9,310`, default `allowGlobbing: true`).
So "as-is" means: the applet host must provide a `fast-glob`-shaped module backed by the
VFS (a `sync(pattern, opts) → string[]`), or run with `set('-f')`/`config.noglob` and
accept literal-argument semantics. Probe evidence: with a VFS-backed `sync` implemented,
`cat('/w/?a.txt')` expanded and concatenated correctly (`"A\nZ\n"`).

### Table 乙 (B) — logic extractable; fs deps exceed the surface by a small, named delta

| Command | Exceeds where | Smallest adaptation |
| --- | --- | --- |
| cp | `fchownSync`/`futimesSync` under `-p` (`cp.js:78,81`); `.mtime` Date compare under `-u` (`cp.js:31`) | drop/guard `-p` (single-user VFS: chown is a no-op anyway) and read `mtimeMs/1000`; or add the two fd-utimes faces over the same store |
| touch | passes `Date` to `utimesSync` (seconds contract) and reads `stat.atime/mtime` which the face lacks (`touch.js:91-106`) | convert Date→seconds at the applet boundary, add `atime`/`mtime` getters to statFace or default them |
| toEnd | `appendFileSync` (`toEnd.js:30`) — absent from the shim | one shim export (`openSync('a')`+`writeSync`+`closeSync` or `wsWriteFile` merge), or rewrite toEnd's 3 lines |
| ln | `linkSync` (`ln.js:68`) for hard links (symlink path is in-surface) | add `linkSync` over `wsLink` (the workspace store already has it, `shims/fs.js:378`) or restrict the applet to `ln -s` |
| test | `isBlockDevice/isCharacterDevice/isFIFO/isSocket` (`test.js:69-81`) not on statFace | four one-line methods returning `false` on statFace (the VFS has no such nodes — honest answer) |
| ls | `-R` calls fast-glob directly (`ls.js:109`); `-l` renders `nlink`/`mtime` (undefined in our face) | VFS glob provider (shared with 甲 caveat); accept degraded `-l` rendering or add the two fields |
| find | delegates to `ls('-R')` (`find.js:58`) | same glob provider; then find is in-surface |
| common.js | fast-glob link+runtime seam | the shared enabler for everything: one VFS-backed `glob.sync` |

### Table 丙 (C) — subprocess-dependent; not portable to the no-subprocess runtime

| Command | Hard dep | Notes |
| --- | --- | --- |
| exec | `child_process.execFileSync`/`exec` (`exec.js:3,100,147`), spawns `config.execPath` running `exec-child.js` via the system shell | structurally unportable (AGENTS.md non-negotiable #2). The probe shows the graceful degradation: with the module stubbed, `exec('echo hi')` returns a `ShellString` with `code:1`, no crash. |
| exec-child.js | `child_process.spawn` + `fs.createWriteStream` (`exec-child.js:2,33-34`) | the spawned half of exec; still **linked** by `shell.js`'s entry (bundler-hint require), so the applet bundle must stub `child_process` at link time even when exec is never called |
| cmd | `execa.sync` (`cmd.js:1,110`) + execa's 9-package tree | same boundary; drop the applet, keep the stub |

## 6. Behavior probe — shelljs semantics vs POSIX (mock fs = shim contract)

Run: `node probe.js` in `tmp/shell-js-spikes/scratch-B/` (34 probes, exit 0; raw JSON in
`probe-out.json`). Required probes (cat/ls/grep/sed) plus the predicted failure modes.
Full POSIX-delta table:

| # | Probe (result) | POSIX behavior | Delta |
| --- | --- | --- | --- |
| 1 | `cat('/w/hello.txt')` → `"alpha\nbeta\ngamma\n"`, code 0 ✅ | same | none |
| 2 | `cat(f1, f2)` where f2 lacks trailing newline → `"…gamma\nhello world"` | cat(1) concatenates raw bytes | **shelljs docs claim "a new line character is introduced between each file" (`cat.js:27-29`) — the code adds none** (`cat.js:44`); POSIX-faithful, doc-wrong |
| 3 | `cat('-n', f)` → `"     1\talpha\n…"` | `cat -n` numbers similarly | matches GNU format (6-wide + tab) |
| 4 | missing file → `stdout:""`, `stderr:"cat: no such file or directory…"`, **code 1, no throw** | exit 1, stderr | errors are **return values** (ShellString), never exceptions unless `config.fatal`; messages go through `common.log` → `console.error` |
| 5 | `cat(dir)` → code 1 "Is a directory" | same | none |
| 6 | `cat(symlink)` → target bytes | same | shim's one-hop resolution behaves like node |
| 7 | `ls(dir)` → array `["a.md","b.md","sub"]` + `.stdout` joined | ls(1) prints one-per-line | **returns a JS array (ShellString hybrid)**, sorted (shim readdir sorts); no `/` suffix on dirs (POSIX needs `-F`), no `.`/`..` ever (like `-A`) |
| 8 | `ls('-R', dir)` → `["a.md","b.md","sub","sub/c.md"]` | `ls -R` prints `dir:` headers + blank lines | **flat list, no headers**, relative subpaths, dir itself excluded |
| 9 | `ls('-l', f)` → element `{size,dev,ino,mode:420,uid,gid,mtimeMs,ctimeMs,name}`; `.toString()` = `"420  0 0 17  /w/hello.txt"` | `-rw-r--r-- 1 uid gid … date name` | **mode rendered as decimal 420 (0o644), `nlink`/`mtime` blank** (undefined on our stat face) — degraded but not broken |
| 10 | `ls(missing)` → `[]`, code **2**, continues | exit 2 | shelljs keeps going; error only in `state.error` |
| 11 | `grep('foo', f)` → `"foo bar\nqux foo\n"` | same matches | always appends final `\n` even if the matched line had none; returns matched lines, not the regex captures |
| 12 | `grep('-i', …)` → all three lines | same | `-i` rebuilds the RegExp with only `'i'` (`grep.js:93`) — **drops other flags a RegExp arg carried** |
| 13 | `grep` no match → `""`, `stderr:"grep: "`, **code 1** | exit 1, silent | close, but stderr carries the odd `"grep: "` prefix (empty message) |
| 14 | `grep('-l', …)` → `"/w/notes.md\n"` | same | none |
| 15 | `grep('f.o', …)` works | `.` matches any char in both | **regex dialect is JavaScript RegExp, not POSIX BRE/ERE** (`?`, `+`, `\d`, lookahead work; `\(` does not) |
| 16 | `sed('foo','X',f)` → replaces **first** occurrence per line | `s/foo/X/` same | string patterns get NO flags (`RegExp(regex)`, `sed.js:56`) → **no `s///g` equivalent** unless the caller passes a `/g` RegExp; replacement is JS `$1/$&` syntax |
| 17 | `sed(/(foo) (bar)/,'$2 $1',f)` → `"bar foo…"` | backrefs `\2 \1` | `$n` not `\n` |
| 18 | `sed('-i',…)` → file rewritten (`"version new\nstay\n"`), returns `""` code 0 | same | write goes through `writeFileSync` (in-surface) ✅ |
| 19 | `rm(f)` → code 0, file gone | same | source-reading predicted a crash on `lstats.isFIFO()` (`rm.js:195`) — **refuted by probe**: the branch is unreachable because every shim stat classifies as file/dir/symlink; rm needs nothing |
| 20 | `touch('-m', f)` → no crash, but `mtimeMs` became `1791683278616000` (≈ year 56,000 CE) | sets current time | **Date flows into the seconds-contract `utimesSync` → ×1000 mis-scale** (`touch.js:106` → `fs-workspace-rename.js:205`); `-a`/`-m`/`-r` also read `stat.atime/mtime` = `undefined` (silently ignored) |
| 21 | `cat(f).toEnd(g)` → **fails**: `"toEnd: could not append to file (code undefined)"`, g unchanged | appends | `appendFileSync` absent from the shim ✅ prediction confirmed; caught cleanly by toEnd's try/catch |
| 22 | `cat(f).to(g)` → g overwritten, returns the ShellString ✅ | `>` redirect | none |
| 23 | `cp('-p', …)` → **throws** `ShellJSInternalError: fs.fchownSync is not a function` ✅ | preserves owner/times | exactly the `-p`-only gap |
| 24 | plain `cp` → code 0 ✅ (fd read/write loop through the descriptor face) | same | none |
| 25 | `head({'-n':2}, f)` → `"alpha\nbeta\n"` ✅ | same | buffered read through openSync/readSync/closeSync — all in-surface |
| 26 | `tail({'-n':1}, f)` → `"gamma\n"` ✅ | same | none |
| 27 | `mkdir('-p', '/w/made/deep/dir')` → all levels created ✅ | same | none |
| 28 | `mv(src,dst)` → moved ✅ | same | EXDEV fallback path would call cp+rm (in-surface) |
| 29 | `which('ls')` → `null` ✅ | not found | semantically correct for a VFS with no PATH binaries |
| 30 | `exec('echo hi',{silent:true})` against the refusing stub → ShellString `code:1`, no crash | runs the command | the boundary is survivable: a refused spawn degrades to exit 1 |
| 31 | `cat('/w/?a.txt')` → `"A\nZ\n"` via the glob seam ✅ | shell expands globs sorted | expansion happens in **every** command via `common.wrap` unless `noglob`; unmatched patterns fall back to **literal** strings (`common.js:311-316`) — bash would error "no such file" |
| 32–34 | cat/ls/grep/sed missing-file & dir cases above | — | exit codes 1 (cat/grep) vs **2** (ls/sed) match coreutils conventions surprisingly well |

Cross-cutting conventions an applet layer must adopt (all observed in the probe):
- **Return values, not exceptions**: every failure lands in `ShellString.stdout/stderr/code`
  plus module state (`shell.error()`, `error.code`); only `config.fatal` (`set('-e')`)
  converts errors to throws.
- Output strings (cat/grep/sed/head/tail) always end with `\n`; array commands (ls/find)
  expose `.stdout` joined with `\n`.
- All text faces are **utf8-only** end to end — the shim's encoding gate plus shelljs's
  `readFileSync(…, 'utf8')` calls align exactly; binary applets would need the `buffer`
  encoding arm.
- Errors print to stderr via `console.error` (`common.js:65-70`) — in the dsh runtime
  that routes through `web-shims`' console → `__DSH_LOG_SINK__` under the release policy,
  so it already obeys the unified-logger rule at the sink level (the applet wrapper should
  still route through `createLogger` per repo rule 5).

## 7. Recommendation

Adopt shelljs 0.10.0 as the applet-body source for the fs-family commands, with this
shape:

1. **Take Table 甲 whole-file** (cat, grep, sed, tail, head, sort, uniq, mkdir, rm, mv,
   chmod, to, echo, pwd, cd, pushd, popd, dirs, which, tempdir, set/error/errorCode) —
   zero source edits; they are pure sync VFS operations.
2. **Provide one VFS-backed `glob.sync` module** mapped as `fast-glob` — it unblocks the
   甲 table's link+runtime seam, plus `ls -R` and `find`. This is the same class of work
   as the existing `shims/` modules (a `sync(pattern, opts) → sorted string[]` over
   `readdirSync`/`lstatSync`); do **not** vendor the real fast-glob tree
   (7+ packages, `@nodelib` walkers designed for real disks) into the mobile closure.
3. **Port Table 乙 with the named micro-adaptations** (cp without `-p`-fd-utimes,
   touch date conversion, toEnd append, ln -s only or add `linkSync`, test's four
   always-false classifiers). Each is a handful of lines; the probe already demonstrates
   the failure shape of each.
4. **Drop Table 丙** (exec/exec-child/cmd) and stub `child_process` + `execa` at link
   time so the rest of `shell.js`'s entry still loads (the entry requires exec-child
   unconditionally as a bundler hint). Pipelines remain possible through ShellString
   chaining (`.cat().grep()`), which is pure data flow.
5. **Write `wc`, `env`, `basename`, `dirname` by hand** (they don't exist in shelljs);
   basename/dirname are `path` one-liners.
6. Record the license as **BSD-3-Clause** in the pin tables, with the wrench-js MIT
   notice preserved inside the vendored `cp.js`/`rm.js` headers.

Licensing is permissive-compatible; sizes are right for a mobile closure (184 KB src,
~4.2k LOC, of which the 甲 subset is the bulk); and the probe demonstrates the command
layer running unmodified against a faithful mock of our shim contract.

## Appendix — artifacts

- `tmp/shell-js-spikes/pkgs/shelljs-0.10.0.tgz` (+ extracted `package/`), `shelljs-0.8.5.tgz`,
  `fast-glob-3.3.2.tgz`, `execa-5.1.1.tgz` (dep-tree inspection only).
- `tmp/shell-js-spikes/scratch-B/mock-vfs.js` — shim-contract mock fs (surface+semantics cited inline).
- `tmp/shell-js-spikes/scratch-B/mock-glob.js` — minimal `glob.sync` over the mock tree
  (`*`, `?`, `**`; no brace/extglob — the probe's `[a-z]` attempt honestly fell back to
  literal, which is itself shelljs's documented fallback behavior).
- `tmp/shell-js-spikes/scratch-B/probe.js`, `probe-out.json`, `probe-err.txt` — 34 probes, exit 0.
