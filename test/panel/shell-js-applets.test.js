import { describe, it, expect, beforeEach } from 'vitest';
import { PIPE_WINDOW_BYTES } from '../../runtime/dsh/system-plugins/dsh-shell-js/stream.js';
// The in-repo libraries the repo-backed applets ride — the alias map sends
// these to runtime/dsh/ exactly the way the plugin's own imports go there.
import { sha256Hex } from 'sha256.js';
import { tarWrite, tarRead } from 'tar-mini.js';
import { workspace, __denyPrimitives } from './gateway-shim.js';
import { P } from '../../runtime/dsh/system-plugins/dsh-shell-js/applets-support.js';
import {
  encoder, putFile, putDir, putBytes, dumpFile, exists, run, resetShell,
} from './shell-js-helpers.js';

beforeEach(resetShell);

// ---------------------------------------------------------------------------
// The 22 MVP applets — at least one behavioral assertion each, semantics
// per the spike tables (DECISION §4.1); shelljs-dialect output shapes are
// asserted as the pristine bodies emit them. (Split into per-group
// describes to stay inside the code-size function budget; the assertions
// are unchanged.)
// ---------------------------------------------------------------------------
describe('shell-js: applets — the navigation face', () => {
  it('pwd prints the executor cwd (workspace root as /)', async () => {
    expect((await run('pwd')).stdout).toBe('/\n');
  });

  it('cd mutates the session, supports cd - and refuses a missing dir', async () => {
    putDir('sub');
    expect((await run('cd sub')).exitCode).toBe(0);
    expect((await run('pwd')).stdout).toBe('/sub\n');
    expect((await run('cd -')).exitCode).toBe(0);
    expect((await run('pwd')).stdout).toBe('/\n');
    const missing = await run('cd nosuch');
    expect(missing.exitCode).not.toBe(0);
    expect(missing.stderr).toContain('nosuch');
  });

  it('cd is session-persistent across runs of the same shell', async () => {
    putDir('stay');
    await run('cd stay');
    expect((await run('pwd')).stdout).toBe('/stay\n'); // no workdir default reset
  });

  it('cd to a missing path reports no-such-file; only a real file is not-a-directory', async () => {
    // The contract's stat answers kind "other" for a missing path — that
    // miss used to read as "not a directory" (issue #501); the honest
    // wording is the read face's no-such-file, by-name held.
    const missing = await run('cd nosuch');
    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).toContain('no such file or directory: nosuch');
    putFile('reg.txt', 'x');
    const onFile = await run('cd reg.txt');
    expect(onFile.exitCode).toBe(2);
    expect(onFile.stderr).toContain('not a directory: reg.txt');
  });
});

describe('shell-js: applets — cat/echo/ls', () => {
  it('cat concatenates files and -n numbers GNU-style', async () => {
    putFile('a.txt', 'one\n');
    putFile('b.txt', 'two\n');
    expect((await run('cat a.txt b.txt')).stdout).toBe('one\ntwo\n');
    putFile('n.txt', 'x\ny\n');
    expect((await run('cat -n n.txt')).stdout).toBe('     1\tx\n     2\ty\n');
  });

  it('echo formats its words; -n drops the trailing newline', async () => {
    expect((await run('echo a b')).stdout).toBe('a b\n');
    expect((await run('echo -n no-newline')).stdout).toBe('no-newline');
  });

  it('ls lists sorted, hides dotfiles without -a, never shows . or ..', async () => {
    putDir('dir');
    putFile('dir/b.txt', 'x');
    putFile('dir/a.txt', 'x');
    putFile('dir/.hidden', 'x');
    expect((await run('ls dir')).stdout).toBe('a.txt\nb.txt\n');
    expect((await run('ls -a dir')).stdout).toBe('.hidden\na.txt\nb.txt\n');
  });
});

describe('shell-js: applets — grep/sed', () => {
  it('grep keeps the 0/1/2 exit convention', async () => {
    putFile('log.txt', 'err one\nok two\nerr three\n');
    const hit = await run('grep err log.txt');
    expect(hit.exitCode).toBe(0);
    expect(hit.stdout).toBe('err one\nerr three\n');
    const miss = await run('grep zzz log.txt');
    expect(miss.exitCode).toBe(1);
    expect(miss.stdout).toBe('');
    const badFile = await run('grep zzz missing.txt');
    expect(badFile.exitCode).toBe(2);
    expect(badFile.stdout).toBe(''); // the refusal family's stdout is empty (#501)
    expect(badFile.stderr).toContain('missing.txt');
  });

  it('sed takes the no-separator form and -i writes back', async () => {
    putFile('code.js', 'const a = 1;\n');
    const seen = await run('sed "a" "b" code.js');
    expect(seen.stdout).toBe('const b = 1;\n');
    expect(dumpFile('code.js')).toBe('const a = 1;\n'); // untouched without -i
    expect((await run('sed -i "a" "b" code.js')).exitCode).toBe(0);
    expect(dumpFile('code.js')).toBe('const b = 1;\n');
  });

  it("an s///-shaped first argument is refused by naming the seat's dialect", async () => {
    // `sed 's/beta/BETA/' notes.txt` (issue #501): without the shape probe
    // the s/// string silently ate the file as the replacement and the
    // "no files given" refusal contradicted reality — the file WAS given.
    // The refusal boundary is the contract (T-0217): the wording names the
    // dialect, the s/// form stays unsupported.
    putFile('notes.txt', 'beta\n');
    const refused = await run("sed 's/beta/BETA/' notes.txt");
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain('s/// script');
    expect(refused.stderr).toContain('<regex> <replacement> <file...>');
    expect(dumpFile('notes.txt')).toBe('beta\n'); // never touched
    const dialect = await run('sed beta BETA notes.txt'); // the seat's spelling works
    expect(dialect.exitCode).toBe(0);
    expect(dialect.stdout).toBe('BETA\n');
  });

});

describe('shell-js: applets — the fd and order faces', () => {
  it('head and tail cut lines through the in-memory fd emulation', async () => {
    putFile('lines.txt', '1\n2\n3\n4\n5\n');
    expect((await run('head -n 2 lines.txt')).stdout).toBe('1\n2\n');
    expect((await run('tail -n 1 lines.txt')).stdout).toBe('5\n');
  });

  it('sort orders and -r reverses', async () => {
    putFile('s.txt', 'b\na\nc\n');
    expect((await run('sort s.txt')).stdout).toBe('a\nb\nc\n');
    expect((await run('sort -r s.txt')).stdout).toBe('c\nb\na\n');
  });

  it('sort on a missing file refuses with empty stdout (no bare join newline)', async () => {
    // The pristine body's `join('\n') + '\n'` over the zero lines the
    // missing-file guard leaves used to surface a bare newline on stdout,
    // where cat/head/tail/wc report empty (issue #501) — the artifact
    // newline is formatting, not output.
    const result = await run('sort missing.txt');
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('missing.txt');
  });

  it('uniq collapses runs; -c uses the shelljs count format', async () => {
    putFile('u.txt', 'a\na\nb\n');
    expect((await run('uniq u.txt')).stdout).toBe('a\nb\n');
    // The pristine body pads counts to width 7 — the disclosed shelljs
    // dialect (spike B's table), asserted as emitted.
    expect((await run('uniq -c u.txt')).stdout).toBe('      2 a\n      1 b\n');
  });
});

describe('shell-js: applets — the tree face', () => {
  it('mkdir -p is idempotent; without -p an existing dir fails', async () => {
    expect((await run('mkdir -p x/y')).exitCode).toBe(0);
    expect((await run('mkdir -p x/y')).exitCode).toBe(0); // existing: "ok" is native
    const repeat = await run('mkdir x');
    expect(repeat.exitCode).not.toBe(0);
    expect(repeat.stderr).toContain('exists');
  });

  it('an unavailable primitive refuses by name with the family exit code 2', async () => {
    // main_cli.c's smoke backend supplies fsRead/fsWrite/fsStat/fsRemove
    // only; a mkdir/find there used to fall off the executor as the
    // generic exit-1 "pipeline member failed" (issue #501). A capability
    // gap is a refusal like every other: exit 2, stderr naming the missing
    // primitive — the whole unavailable class's convention (ls/mv ride it
    // through the same mapping).
    __denyPrimitives('fsMkdir', 'fsList');
    const made = await run('mkdir -p x/y');
    expect(made.exitCode).toBe(2);
    expect(made.stderr).toContain('fsMkdir');
    expect(made.stderr).toContain('not available');
    const found = await run('find .');
    expect(found.exitCode).toBe(2);
    expect(found.stderr).toContain('fsList');
    expect(found.stderr).toContain('not available');
  });

  it('rm -r removes a tree; -f tolerates a missing path', async () => {
    putDir('tree');
    putFile('tree/f.txt', 'x');
    putDir('tree/deep');
    putFile('tree/deep/g.txt', 'x');
    expect((await run('rm -r tree')).exitCode).toBe(0);
    expect(exists('tree/f.txt')).toBe(false);
    expect(exists('tree/deep/g.txt')).toBe(false);
    expect((await run('rm nofile')).exitCode).not.toBe(0);
    expect((await run('rm -f nofile')).exitCode).toBe(0);
  });

});

describe('shell-js: applets — the copy face', () => {
  it('mv renames and replaces an existing target (POSIX rename)', async () => {
    putFile('a.txt', 'new\n');
    putFile('b.txt', 'old\n');
    expect((await run('mv a.txt b.txt')).exitCode).toBe(0);
    expect(dumpFile('b.txt')).toBe('new\n');
    expect(exists('a.txt')).toBe(false);
  });

  it('cp copies a file and -r walks the tree with contents', async () => {
    putFile('f.txt', 'data\n');
    expect((await run('cp f.txt g.txt')).exitCode).toBe(0);
    expect(dumpFile('g.txt')).toBe('data\n');
    putDir('src');
    putFile('src/one.txt', 'one\n');
    putDir('src/sub');
    putFile('src/sub/two.txt', 'two\n');
    expect((await run('cp -r src dst')).exitCode).toBe(0);
    expect(dumpFile('dst/one.txt')).toBe('one\n');
    expect(dumpFile('dst/sub/two.txt')).toBe('two\n');
  });

  it('find lists a tree recursively including the base, -name filters', async () => {
    putDir('tree');
    putFile('tree/a.c', 'int');
    putFile('tree/b.js', 'x');
    expect((await run('find tree')).stdout).toBe('tree\ntree/a.c\ntree/b.js\n');
    // Quoted: an unquoted *.c would expand in word position before find
    // sees it (bash order — the executor owns globbing).
    expect((await run("find tree -name '*.c'")).stdout).toBe('tree/a.c\n');
  });
});

describe('shell-js: applets — the hand-written face', () => {
  it('wc counts lines/words/bytes, per-flag and from the pipe', async () => {
    putFile('w.txt', 'one two\nthree\n');
    expect((await run('wc w.txt')).stdout).toBe('2 3 14 w.txt\n');
    expect((await run('wc -l w.txt')).stdout).toBe('2 w.txt\n');
    expect((await run('echo hello | wc')).stdout).toBe('1 1 6\n');
  });

  it('basename strips the directory and an optional suffix', async () => {
    expect((await run('basename a/b/c.txt')).stdout).toBe('c.txt\n');
    expect((await run('basename a/b/c.txt .txt')).stdout).toBe('c\n');
  });

  // Edge pins from the Stryker triage (2026-10-16): the no-slash and
  // suffix-guard branches of the path face had no test reaching them.
  it('basename edge branches: bare name, whole-name suffix guard', async () => {
    expect((await run('basename file.txt')).stdout).toBe('file.txt\n');
    expect((await run('basename file.txt .txt')).stdout).toBe('file\n');
    expect((await run('basename .txt .txt')).stdout).toBe('.txt\n');
  });

  it('dirname prints the directory part', async () => {
    expect((await run('dirname a/b/c.txt')).stdout).toBe('a/b\n');
  });

  it('dirname edge branches: bare name has no directory part', async () => {
    expect((await run('dirname file.txt')).stdout).toBe('.\n');
    expect((await run('dirname a')).stdout).toBe('.\n');
  });

  // Stryker triage (2026-10-16): the path face's own edge branches, pinned
  // directly — the dirname/basename applets ride the node:path shim, so the
  // command pins above never touch this implementation.
  it('path face edges: dirname/basename/relativePathFrom directly', () => {
    expect(P.dirname('file.txt')).toBe('.');
    expect(P.basename('file.txt', '.txt')).toBe('file');
    expect(P.basename('.txt', '.txt')).toBe('.txt');
    expect(P.basename('a/b/c.txt')).toBe('c.txt');
    expect(P.relative('a/b', 'a/c')).toBe('../c');
    expect(P.relative('a/b/c', 'a/d')).toBe('../../d');
  });

  it('env prints the shell variable table (not a host environment)', async () => {
    expect((await run('env')).stdout).toBe('');
    expect((await run('FOO=bar env')).stdout).toBe('FOO=bar\n');
    expect((await run('FOO=persisted')).exitCode).toBe(0); // assignment-only persists
    expect((await run('env')).stdout).toBe('FOO=persisted\n');
  });

});

// The repo-backed applets are PINNED to the in-repo libraries: identical
// bytes in, identical library output — no drift between the applet and
// runtime/dsh/sha256.js / tar-mini.js.
describe('shell-js: applets — pinned to the in-repo libraries', () => {
  it('sha256sum output equals runtime/dsh/sha256.js over the same bytes', async () => {
    const bytes = encoder.encode('dsh-shell-js pin\n');
    putBytes('bin.dat', bytes);
    const result = await run('sha256sum bin.dat');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${sha256Hex(bytes)}  bin.dat\n`);
  });

  it('tar -c archive bytes equal tar-mini tarWrite for the same members', async () => {
    putFile('one.txt', 'one\n');
    putFile('two.txt', 'two\n');
    const result = await run('tar -c -f a.tar one.txt two.txt');
    expect(result.exitCode).toBe(0);
    const expected = tarWrite([
      { path: 'one.txt', bytes: encoder.encode('one\n') },
      { path: 'two.txt', bytes: encoder.encode('two\n') },
    ]);
    expect(workspace.get('app/dsh/a.tar')).toEqual(expected);
  });

  it('tar -t lists exactly what tar-mini tarRead finds in the archive', async () => {
    const archive = tarWrite([{ path: 'm1.txt', bytes: encoder.encode('x') }]);
    putBytes('a.tar', archive);
    const result = await run('tar -t -f a.tar');
    expect(result.exitCode).toBe(0);
    const expected = tarRead(archive).map((m) => `${m.path}\n`).join('');
    expect(result.stdout).toBe(expected);
    expect(expected).toBe('m1.txt\n');
  });

  it('tar -x restores the members tar-mini wrote, byte for byte', async () => {
    const original = encoder.encode('payload\n');
    const archive = tarWrite([{ path: 'restored.txt', bytes: original }]);
    putBytes('a.tar', archive);
    expect((await run('tar -x -f a.tar')).exitCode).toBe(0);
    expect(workspace.get('app/dsh/restored.txt')).toEqual(original);
  });

  it('tar refuses -z (no inflate primitive) and directory members', async () => {
    putDir('d');
    const z = await run('tar -c -z -f a.tar d');
    expect(z.exitCode).toBe(2);
    expect(z.stderr).toContain('-z');
    const dirMember = await run('tar -c -f a.tar d');
    expect(dirMember.exitCode).toBe(2);
    expect(dirMember.stderr).toContain('regular files');
  });
});

// ---------------------------------------------------------------------------
// Pipelines: multi-member stdout confluence and backpressure through the
// bounded 64KB window (no data loss across window turns).
// ---------------------------------------------------------------------------
describe('shell-js: pipelines — confluence', () => {
  it('a two-member pipeline conflates stdout into the run result', async () => {
    putFile('p.txt', 'keep\n drop\n keep\n'.replace(/ /g, ''));
    const result = await run('cat p.txt | grep keep');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('keep\nkeep\n');
  });

  it('a three-member pipeline orders through both pipes', async () => {
    putFile('p.txt', 'y\nx\nx\n');
    const result = await run('cat p.txt | sort | uniq');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('x\ny\n');
  });

  it('a member that ignores its stdin closes it (EPIPE posture, no hang)', async () => {
    // The upstream writes into the pipe; the downstream never reads — the
    // run must still complete on the single-threaded runtime.
    putFile('f.txt', 'x\n');
    const result = await run('cat f.txt | echo replaced');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('replaced\n');
  });
});

describe('shell-js: pipelines — backpressure and mid-pipe redirects', () => {
  it('backpressure: 150KB through the 64KB window loses nothing', async () => {
    expect(PIPE_WINDOW_BYTES).toBe(64 * 1024); // the window the pipe bounds
    const lines = 30000; // 'line\n' * 30000 = 150KB — several window turns
    putFile('big.txt', 'line\n'.repeat(lines));
    const result = await run('cat big.txt | wc -l');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(String(lines));
  });

  it('a mid-pipeline > redirect cannot deadlock the run (the replaced pipe still gets EOF)', async () => {
    // bash: `echo hi > first.txt | wc -c` prints 0 — the redirect takes
    // echo's stdout, wc reads an empty pipe. The replaced pipe writer MUST
    // still be closed: a downstream member parked on that read is
    // unkillable on this single-threaded runtime.
    const result = await run('echo hi > first.txt | wc -c');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('0\n');
    expect(dumpFile('first.txt')).toBe('hi\n');
  });

  it('a mid-pipeline redirect in a three-member pipeline keeps the tail alive', async () => {
    putFile('p.txt', 'x1\nother\nx2\n');
    const result = await run('cat p.txt | grep x > hits.txt | wc -l');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('0\n'); // wc reads the emptied pipe
    expect(dumpFile('hits.txt')).toBe('x1\nx2\n');
  });
});
