import { describe, it, expect, beforeEach } from 'vitest';
import { apply, shellExecutor, manifest } from '../../runtime/dsh/system-plugins/dsh-shell-js/index.js';
import { session } from '../../runtime/dsh/system-plugins/dsh-shell-js/applets.js';
import { PIPE_WINDOW_BYTES } from '../../runtime/dsh/system-plugins/dsh-shell-js/stream.js';
// The in-repo libraries the repo-backed applets ride — the alias map sends
// these to runtime/dsh/ exactly the way the plugin's own imports go there.
import { sha256Hex } from 'sha256.js';
import { tarWrite, tarRead } from 'tar-mini.js';
import { workspace } from './gateway-shim.js';

/** The pinned profile container the executor maps the workspace through
 * (boot.js's pinProfileContainer globals) — the same seeding the
 * shell-wasm suite does; the workspace sits INSIDE the scope root, so a
 * workspace-relative file is `dsh/<name>`. */
const seedGlobals = () => {
  globalThis.__dshProfileCwd = '/profiles/default/dsh';
  globalThis.__dshProfileScopeRoot = '/profiles/default';
};

/** One activation through the plugin's own apply. Registration is fully
 * synchronous here (the wasm sibling's starter writes need the two-flush
 * drain; this plugin has no activation writes), so the collected tools
 * are ready on return. */
const activate = () => {
  const registered = [];
  apply({ tools: { register: (tool) => registered.push(tool) } });
  return registered;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Seed the in-memory workspace (scope 'app', workspace prefix 'dsh'). */
const putFile = (path, text) => workspace.set(`app/dsh/${path}`, encoder.encode(text));
const putDir = (path) => workspace.set(`app/dsh/${path}`, { dir: true });
const dumpFile = (path) => decoder.decode(workspace.get(`app/dsh/${path}`));
const exists = (path) => workspace.has(`app/dsh/${path}`);

const run = (command) => shellExecutor.run({ command });

beforeEach(() => {
  workspace.clear();
  seedGlobals();
  // The shell session is module state (one shell per plugin instance) —
  // reset it so `cd`/assignment tests cannot leak into each other.
  session.cwd = '';
  session.vars = {};
  session.oldpwd = null;
});

// ---------------------------------------------------------------------------
// The parser table: every construct the executor RUNS (DECISION §4.3's
// whitelist), each asserting stdout AND exitCode.
// ---------------------------------------------------------------------------
describe('shell-js: the parser table', () => {
  const cases = [
    { name: 'a bare command', command: 'echo hello', stdout: 'hello\n', code: 0 },
    { name: 'double quotes fold to one word', command: 'echo "a b" c', stdout: 'a b c\n', code: 0 },
    { name: 'single quotes fold to one word', command: "echo 'x y'", stdout: 'x y\n', code: 0 },
    { name: 'a single quote inside double quotes stays literal', command: 'echo "a\'b"', stdout: 'a\'b\n', code: 0 },
    { name: 'backslash-space escapes fold', command: 'echo a\\ b', stdout: 'a b\n', code: 0 },
    { name: 'simple $VAR expansion', command: 'FOO=bar; echo $FOO', stdout: 'bar\n', code: 0 },
    { name: 'braced ${VAR} composes with a suffix', command: 'FOO=bar; echo ${FOO}post', stdout: 'barpost\n', code: 0 },
    { name: 'expansion inside double quotes', command: 'FOO=bar; echo "pre$FOO post"', stdout: 'prebar post\n', code: 0 },
    { name: 'an unset variable expands empty', command: 'echo [$MISSING]', stdout: '[]\n', code: 0 },
    {
      name: 'prefix assignment reaches the command but does not persist',
      command: 'FOO=one echo $FOO; echo [$FOO]',
      stdout: 'one\n[]\n',
      code: 0,
    },
    { name: 'a two-member pipeline', command: 'echo two words | grep two', stdout: 'two words\n', code: 0 },
    { name: '&& runs the second only on success', command: 'echo a && echo b', stdout: 'a\nb\n', code: 0 },
    { name: '&& short-circuits on a grep miss (exit 1)', command: 'echo x > f.txt; grep zzz f.txt && echo never', stdout: '', code: 1 },
    { name: '|| runs the second only on failure', command: 'echo x > f.txt; grep zzz f.txt || echo fallback', stdout: 'fallback\n', code: 0 },
    { name: '|| keeps the first output on success', command: 'echo ok || echo never', stdout: 'ok\n', code: 0 },
    { name: 'a semicolon sequence', command: 'echo a; echo b', stdout: 'a\nb\n', code: 0 },
    { name: 'the sequence status is the last member', command: 'echo x > f.txt; grep zzz f.txt; echo after', stdout: 'after\n', code: 0 },
    { name: '> redirects stdout away from the run', command: 'echo x > f.txt', stdout: '', code: 0 },
    { name: 'a trailing comment is dropped', command: 'echo x # the comment', stdout: 'x\n', code: 0 },
    { name: 'a full-line comment is a no-op', command: '# nothing at all', stdout: '', code: 0 },
    { name: 'an empty line is a silent success', command: '   ', stdout: '', code: 0 },
    {
      name: 'a glob expands in word position, sorted',
      seed: () => { putFile('x1.txt', '1'); putFile('x2.txt', '2'); },
      command: 'echo *.txt',
      stdout: 'x1.txt x2.txt\n',
      code: 0,
    },
    {
      name: 'a glob with no match passes through as the literal word',
      command: 'echo *.zzz',
      stdout: '*.zzz\n',
      code: 0,
    },
  ];

  for (const { name, command, stdout, code, seed } of cases) {
    it(`${name} — ${command}`, async () => {
      if (seed !== undefined) seed();
      const result = await run(command);
      expect(result.exitCode).toBe(code);
      expect(result.stdout).toBe(stdout);
    });
  }

  it('quotes around an expansion do not survive the word', async () => {
    // bash-parser keeps quotes in the RAW text of expansion-bearing words;
    // the executor's quote state machine must remove exactly the syntax
    // quotes and keep literal data quotes (probe-verified semantics).
    const result = await run('FOO=bar; echo "$FOO\'s"');
    expect(result.stdout).toBe("bar's\n");
  });

  it('> creates and >> appends through fsWrite', async () => {
    expect((await run('echo first > out.txt')).exitCode).toBe(0);
    expect(dumpFile('out.txt')).toBe('first\n');
    expect((await run('echo second >> out.txt')).exitCode).toBe(0);
    expect(dumpFile('out.txt')).toBe('first\nsecond\n');
  });

  it('2> captures stderr to a file', async () => {
    const result = await run('grep zzz missing.txt 2> err.txt');
    expect(result.exitCode).toBe(2); // the grep convention on a bad file
    expect(result.stderr).toBe('');
    expect(dumpFile('err.txt')).toContain('missing.txt');
  });

  it('a glob only expands the magic word, not its neighbours', async () => {
    putFile('x1.txt', '1');
    putFile('x2.txt', '2');
    const result = await run('echo head *.txt tail');
    expect(result.stdout).toBe('head x1.txt x2.txt tail\n');
  });

  it('a relative glob expands against the session cwd, not the root', async () => {
    putFile('a.txt', 'root\n');
    putDir('sub');
    putFile('sub/s.txt', 'sub\n');
    await run('cd sub');
    const result = await run('echo *.txt');
    // bash spelling: matched inside the cwd, returned relative to it —
    // `rm *.tmp` after a cd acts on the right directory's files.
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('s.txt\n');
  });

  it('a ..-prefixed glob after a cd targets the matched directory, not the cwd', async () => {
    // Same-name collision: the bare-name regression deleted the cwd's
    // copy while the MATCHED (root) copy survived — the word must come
    // back as ../name so the applet re-resolves to the match.
    putFile('a.txt', 'RIGHT\n');
    putDir('sub');
    putFile('sub/a.txt', 'WRONG\n');
    await run('cd sub');
    const read = await run('cat ../*.txt');
    expect(read.exitCode).toBe(0);
    expect(read.stdout).toBe('RIGHT\n');
    const remove = await run('rm ../*.txt');
    expect(remove.exitCode).toBe(0);
    expect(exists('a.txt')).toBe(false);  // the root copy is gone
    expect(exists('sub/a.txt')).toBe(true); // the cwd's copy survives
  });

  it('a failed redirect write fails the command loudly, never a silent success', async () => {
    putDir('adir'); // writing a directory: every host rejects with io
    const result = await run('echo hi > adir');
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('redirect write failed');
    expect(result.stderr).toContain('Is a directory');
  });

  it('a failed redirect write does not stop the rest of the line (bash runs on)', async () => {
    putDir('adir');
    const result = await run('echo hi > adir; echo after');
    expect(result.exitCode).toBe(0); // the sequence status is the last member
    expect(result.stdout).toBe('after\n');
    expect(result.stderr).toContain('redirect write failed');
  });

  it('2> to an unwritable target fails the same way', async () => {
    putDir('adir');
    const result = await run('echo x > f.txt 2> adir');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('redirect write failed');
  });
});

// ---------------------------------------------------------------------------
// Refusal semantics: anything the seven primitives cannot honor fails BY
// NAME — exit 2 (or 127 for programs), stderr naming what is missing.
// ---------------------------------------------------------------------------
describe('shell-js: refusals are by name', () => {
  const refusals = [
    { command: 'ls -l', needle: '-l' },
    { command: 'cp -p a b', needle: '-p' },
    { command: 'tar -c -z -f a.tar f', needle: '-z' },
    { command: 'chmod +x f', needle: 'contract proposal' },
    { command: 'ln -s a b', needle: 'link primitive' },
    { command: 'touch f', needle: 'utimes primitive' },
    { command: 'echo $((1+2))', needle: 'arithmetic' },
    { command: 'echo $(ls)', needle: 'command substitution' },
    { command: 'if true; then echo x; fi', needle: 'if' },
    { command: 'for f in *; do echo $f; done', needle: 'for' },
    { command: '(cd x)', needle: 'subshell' },
    { command: 'cat <<EOF\nhi\nEOF', needle: 'heredoc' },
    { command: 'echo a & echo b', needle: 'background' },
    { command: '! echo a', needle: 'negation' },
    { command: 'cat < f.txt', needle: 'input redirect' },
    { command: 'echo ${FOO:-default}', needle: 'parameter expansion operator' },
    { command: 'echo hi > ../escape.txt', needle: 'escapes the workspace' },
    { command: 'echo hi 2> ../../escape.txt', needle: 'escapes the workspace' },
  ];

  for (const { command, needle } of refusals) {
    it(`${JSON.stringify(command)} refuses naming ${JSON.stringify(needle)}`, async () => {
      const result = await run(command);
      expect(result.exitCode).toBe(2);
      expect(result.stderr.toLowerCase()).toContain(needle.toLowerCase());
    });
  }

  it('an unknown program is 127, self-describing like the wasm sibling', async () => {
    const result = await run('python3 -c x');
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain('python3: not found');
    expect(result.stderr).toContain('Available applets:');
    expect(result.stderr).toContain('fs tools');
  });

  it('a heredoc refusal stops the whole line, not just its first member', async () => {
    // bash-parser 0.5.0 degrades a heredoc into separate commands; the
    // executor refuses the line AS one (exit 2), never trailing into the
    // degraded members as 127s.
    const result = await run('cat <<EOF\nhi\nEOF');
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
  });
});

// ---------------------------------------------------------------------------
// The 22 MVP applets — at least one behavioral assertion each, semantics
// per the spike tables (DECISION §4.1); shelljs-dialect output shapes are
// asserted as the pristine bodies emit them.
// ---------------------------------------------------------------------------
describe('shell-js: the MVP applets', () => {
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

  it('ls lists sorted, hides dotfiles without -a, never shows . or ..', async () => {
    putDir('dir');
    putFile('dir/b.txt', 'x');
    putFile('dir/a.txt', 'x');
    putFile('dir/.hidden', 'x');
    expect((await run('ls dir')).stdout).toBe('a.txt\nb.txt\n');
    expect((await run('ls -a dir')).stdout).toBe('.hidden\na.txt\nb.txt\n');
  });

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

  it('uniq collapses runs; -c uses the shelljs count format', async () => {
    putFile('u.txt', 'a\na\nb\n');
    expect((await run('uniq u.txt')).stdout).toBe('a\nb\n');
    // The pristine body pads counts to width 7 — the disclosed shelljs
    // dialect (spike B's table), asserted as emitted.
    expect((await run('uniq -c u.txt')).stdout).toBe('      2 a\n      1 b\n');
  });

  it('mkdir -p is idempotent; without -p an existing dir fails', async () => {
    expect((await run('mkdir -p x/y')).exitCode).toBe(0);
    expect((await run('mkdir -p x/y')).exitCode).toBe(0); // existing: "ok" is native
    const repeat = await run('mkdir x');
    expect(repeat.exitCode).not.toBe(0);
    expect(repeat.stderr).toContain('exists');
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

  it('dirname prints the directory part', async () => {
    expect((await run('dirname a/b/c.txt')).stdout).toBe('a/b\n');
  });

  it('env prints the shell variable table (not a host environment)', async () => {
    expect((await run('env')).stdout).toBe('');
    expect((await run('FOO=bar env')).stdout).toBe('FOO=bar\n');
    expect((await run('FOO=persisted')).exitCode).toBe(0); // assignment-only persists
    expect((await run('env')).stdout).toBe('FOO=persisted\n');
  });

  it('cd is session-persistent across runs of the same shell', async () => {
    putDir('stay');
    await run('cd stay');
    expect((await run('pwd')).stdout).toBe('/stay\n'); // no workdir default reset
  });
});

// ---------------------------------------------------------------------------
// Pipelines: multi-member stdout confluence and backpressure through the
// bounded 64KB window (no data loss across window turns).
// ---------------------------------------------------------------------------
describe('shell-js: pipelines', () => {
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

// ---------------------------------------------------------------------------
// The repo-backed applets are PINNED to the in-repo libraries: identical
// bytes in, identical library output — no drift between the applet and
// runtime/dsh/sha256.js / tar-mini.js.
// ---------------------------------------------------------------------------
describe('shell-js: repo-module applets are pinned to the in-repo libraries', () => {
  it('sha256sum output equals runtime/dsh/sha256.js over the same bytes', async () => {
    const bytes = encoder.encode('dsh-shell-js pin\n');
    workspace.set('app/dsh/bin.dat', bytes);
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
    workspace.set('app/dsh/a.tar', archive);
    const result = await run('tar -t -f a.tar');
    expect(result.exitCode).toBe(0);
    const expected = tarRead(archive).map((m) => `${m.path}\n`).join('');
    expect(result.stdout).toBe(expected);
    expect(expected).toBe('m1.txt\n');
  });

  it('tar -x restores the members tar-mini wrote, byte for byte', async () => {
    const original = encoder.encode('payload\n');
    const archive = tarWrite([{ path: 'restored.txt', bytes: original }]);
    workspace.set('app/dsh/a.tar', archive);
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
// The plugin shape (the wasm sibling's registration/description checks).
// ---------------------------------------------------------------------------
describe('shell-js: the plugin shape', () => {
  it('the manifest declares exactly the seven contract fs primitives', () => {
    expect(manifest.id).toBe('dsh-shell-js');
    expect(manifest.type).toBe('service');
    expect(manifest.capabilities.required).toEqual([
      'fsRead', 'fsWrite', 'fsStat', 'fsList', 'fsMkdir', 'fsRemove', 'fsRename',
    ]);
    expect(manifest.capabilities.optional).toEqual([]);
  });

  it('the tool registration carries the honest description and works end to end', async () => {
    const [shell] = activate();
    expect(shell.name).toBe('shell');
    // The dialect disclosures (DECISION §6) the model reads before its
    // first command.
    expect(shell.description).toContain('JavaScript RegExp');
    expect(shell.description).toContain('localeCompare');
    expect(shell.description).toContain('whole-file');
    expect(shell.description).toContain('SHELL variable table');
    expect(shell.description).toContain('not enforced');
    const value = await shell.execute({ command: 'echo end to end' });
    expect(value).toEqual({ exitCode: 0, stdout: 'end to end\n', stderr: '' });
  });

  it('run returns the dsh-shell-wasm result shape', async () => {
    const result = await run('echo shape');
    expect(result).toEqual({
      exitCode: 0, stdout: 'shape\n', stderr: '', command: 'echo shape',
    });
  });
});
