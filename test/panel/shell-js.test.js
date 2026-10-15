import { describe, it, expect, beforeEach } from 'vitest';
import { manifest } from '../../runtime/dsh/system-plugins/dsh-shell-js/index.js';
import {
  activate, putFile, putDir, dumpFile, exists, run, resetShell,
} from './shell-js-helpers.js';

beforeEach(resetShell);

// ---------------------------------------------------------------------------
// The parser table: every construct the executor RUNS (DECISION §4.3's
// whitelist), each asserting stdout AND exitCode.
// ---------------------------------------------------------------------------

const PARSER_CASES = [
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

describe('shell-js: the parser table', () => {
  for (const { name, command, stdout, code, seed } of PARSER_CASES) {
    it(`${name} — ${command}`, async () => {
      if (seed !== undefined) seed();
      const result = await run(command);
      expect(result.exitCode).toBe(code);
      expect(result.stdout).toBe(stdout);
    });
  }
});

describe('shell-js: word and redirect semantics', () => {
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

describe('shell-js: globs in word position', () => {
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
});

// ---------------------------------------------------------------------------
// Refusal semantics: anything the seven primitives cannot honor fails BY
// NAME — exit 2 (or 127 for programs), stderr naming what is missing.
// ---------------------------------------------------------------------------

const REFUSAL_CASES = [
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
  { command: 'echo hi 2>&1', needle: 'fd-duplication' },
  { command: 'echo `pwd`', needle: 'command substitution' },
  { command: 'echo ${FOO:-default}', needle: 'parameter expansion operator' },
  { command: 'echo hi > ../escape.txt', needle: 'escapes the workspace' },
  { command: 'echo hi 2> ../../escape.txt', needle: 'escapes the workspace' },
];

describe('shell-js: refusals are by name', () => {
  for (const { command, needle } of REFUSAL_CASES) {
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
// The standing loop's pins (T-0217, 2026-10-13): every wild refusal the
// observation battery caught on the real gateway, pinned so the dialect
// contract carries it. The battery that found these drove agent-realistic
// command lines through the REAL ToolRuntime on the CLI carrier.
// ---------------------------------------------------------------------------
describe('shell-js: the wild refusals the standing loop pinned', () => {
  it('brace alternatives expand purely — `echo {a,b}` is the words, never a pathname match', async () => {
    // bash order: braces expand textually before pathname expansion, so a
    // real file named `a` must not attract the word, and a host without a
    // lister primitive must not turn a pure echo into a crash (the CLI
    // seat's wild refusal: the fsList walk hard-failed the line).
    putFile('a', 'X');
    const result = await run('echo {a,b}');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('a b\n');
  });

  it('a reader on a missing path refuses by name — never the wrapper-bug shape', async () => {
    // The contract answers kind "other" for a missing stat; the read face
    // must hand the body the ENOENT it catches (grep's exit-2 convention,
    // cat's exit 1), not the internal "(wrapper bug)" wording.
    const cat = await run('cat missing.txt');
    expect(cat.exitCode).not.toBe(0);
    expect(cat.stderr).toContain('missing.txt');
    expect(cat.stderr).not.toContain('wrapper bug');
    const grep = await run('grep x missing.txt');
    expect(grep.exitCode).toBe(2);
    expect(grep.stderr).toContain('missing.txt');
    expect(grep.stderr).not.toContain('wrapper bug');
  });

  it('head on a missing path fails loudly — never a silent empty success', async () => {
    // The battery caught head answering exit 0 with empty stdout for a
    // path that did not exist: the worst shape the refusal vocabulary
    // knows, a wrong result that looks like success.
    const result = await run('head -n 1 missing.txt');
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('missing.txt');
  });
});

// ---------------------------------------------------------------------------
// The argv face (DECISION §4.2's by-name refusal table, plus the '--' and
// '-' word rules). splitFlags semantics pinned through real applets — the
// mutation pilot (test/mutation/) found these refusal shapes unasserted.
// ---------------------------------------------------------------------------
describe('shell-js: the argv face', () => {
  it('a long option is refused BY NAME, with the implemented-flag hint', async () => {
    const result = await run('ls --all');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("long option '--all' is not implemented");
    expect(result.stderr).toContain('implemented flags: -a -A -R -d');
  });

  it('an unknown short flag inside a cluster is refused by its own name', async () => {
    // ls knows -a: the cluster walk must reach -l first and name IT.
    const result = await run('ls -la');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('-l is not implemented');
    expect(result.stderr).toContain('implemented flags: -a -A -R -d');
  });

  it('a multi-character known flag whole-matches before the per-char walk', async () => {
    putDir('tree');
    putFile('tree/a.c', 'x');
    const result = await run("find tree -name '*.c'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('tree/a.c\n');
  });

  it('-- ends flag parsing; the rest are words, even flag-shaped ones', async () => {
    // echo carries the words verbatim (pristine bodies re-parse their own
    // options, so the file-reading applets cannot take a dash-led word).
    const result = await run('echo -- -x');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('-x\n');
  });

  it('a lone - is a word, never a flag cluster', async () => {
    putFile('-', 'DASH');
    const result = await run('cat -');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('DASH');
  });

  it('a value flag at the end of the line refuses: it needs a value', async () => {
    const result = await run('find . -name');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('-name needs a value');
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
