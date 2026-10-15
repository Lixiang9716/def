import { describe, it, expect, beforeEach } from 'vitest';
// The support layer's own faces, imported directly (the mutation pilot,
// test/mutation/, found these pure contracts unasserted through the applets;
// this file exists because the code-size gate budgets the applets suite).
import {
  NO_SUBPROCESS, P, ShellRefusal, normalizeInternal, resolveAgainstCwd,
  session, textOfStdin, toGateway, unavailableRefusal,
} from '../../runtime/dsh/system-plugins/dsh-shell-js/applets-support.js';
import { shellStringOutcome } from '../../runtime/dsh/system-plugins/dsh-shell-js/applets-shelljs.js';
import { subprocessStub } from '../../runtime/dsh/system-plugins/dsh-shell-js/applets-snapshot.js';
import { encoder, run, resetShell } from './shell-js-helpers.js';

beforeEach(resetShell);

// ---------------------------------------------------------------------------
// The support layer's own contracts (applets-support.js / applets-shelljs.js
// unit faces). The mutation pilot (test/mutation/) found these pure
// normalizers unasserted through the applets alone — they are pinned here
// table-style, one behavior per line.
// ---------------------------------------------------------------------------
describe('shell-js: support layer — the path face', () => {
  it('the path face keeps its POSIX spelling table', () => {
    expect(P.sep).toBe('/');
    expect(P.delimiter).toBe(':');
    expect(P.isAbsolute('/a')).toBe(true);
    expect(P.isAbsolute('a')).toBe(false);
    expect(P.isAbsolute('')).toBe(false);
    expect(P.isAbsolute(null)).toBe(false);
    expect(P.normalize('a/b/../c')).toBe('a/c');
    expect(P.normalize('a/./b')).toBe('a/b');
    expect(P.normalize('')).toBe('/');
    expect(P.normalize('/a//b')).toBe('/a/b');
    expect(() => P.normalize('../x')).toThrow(/escapes the workspace/);
    expect(P.join('a', 'b')).toBe('a/b');
    expect(P.join('a', '', 'b')).toBe('a/b'); // an empty member drops, never doubles the slash
    expect(P.join('', 'a')).toBe('a'); // a leading empty member never makes the join absolute
    expect(P.join()).toBe('/');
  });

  it('resolve anchors relative parts at the session cwd and resets on absolutes', () => {
    session.cwd = 'sub';
    expect(P.resolve('a')).toBe('/sub/a'); // relative parts anchor at the session cwd
    expect(P.resolve()).toBe('/sub'); // no parts: the cwd itself, absolute
    expect(P.resolve('a', '/b')).toBe('/b'); // an absolute part resets the walk
    expect(P.resolve('a', 'b')).toBe('/sub/a/b'); // relative parts accumulate
    expect(P.resolve('/a/../b')).toBe('/b');
    // cwd 'sub' folds one '..' to the root — only a real escape throws.
    expect(P.resolve('../x')).toBe('/x');
    expect(() => P.resolve('../../x')).toThrow(/escapes the workspace/);
    session.cwd = '';
  });

  it('the relative face spells bash words: up-walk, down-walk, root anchoring', () => {
    session.cwd = '';
    expect(P.relative('/a/b', '/a/c')).toBe('../c');
    expect(P.relative('/a', '/a/b')).toBe('b');
    expect(P.relative('/a/b', '/a')).toBe('..');
    expect(P.relative('/a', '/a')).toBe('');
    expect(P.relative('/a/b', '/c/d')).toBe('../../c/d');
    expect(P.relative('/', '/a')).toBe('a'); // from the root: no leading ../
    expect(P.relative('/a/b/c', '/a/b')).toBe('..'); // down one level: exactly one ..
    expect(P.relative('/a', '/')).toBe('..'); // to the root from one level down
  });

});

describe('shell-js: support layer — the canonical form and the derived tables', () => {
  it('dirname, basename and extname keep their POSIX tables and refuse escapes', () => {
    expect(P.dirname('')).toBe('.');
    expect(P.dirname('a')).toBe('.');
    expect(P.dirname('/a')).toBe('/');
    expect(P.dirname('a/b')).toBe('a');
    expect(P.dirname('/a/b')).toBe('/a');
    expect(P.dirname('/')).toBe('/');
    expect(P.dirname('a/b/')).toBe('a');
    expect(() => P.dirname('../x')).toThrow(/escapes the workspace/);
    expect(P.basename('a/b.txt')).toBe('b.txt');
    expect(P.basename('a/b.txt', '.txt')).toBe('b');
    expect(P.basename('a/.txt', '.txt')).toBe('.txt'); // base === suffix is kept whole
    expect(P.basename('a/b.txt', '.md')).toBe('b.txt');
    expect(P.basename('/')).toBe('/');
    expect(P.basename('a/')).toBe('a');
    expect(() => P.basename('../x')).toThrow(/escapes the workspace/);
    expect(P.extname('a/b.txt')).toBe('.txt');
    expect(P.extname('a/b')).toBe('');
    expect(P.extname('a/b.tar.gz')).toBe('.gz');
    expect(P.extname('a/.hidden')).toBe(''); // a dotfile has no extension
  });
});

describe('shell-js: support layer — the canonical relative form', () => {
  it('normalizeInternal and resolveAgainstCwd keep the canonical relative form', () => {
    expect(normalizeInternal('')).toBe('');
    expect(normalizeInternal('./a/./b')).toBe('a/b');
    expect(normalizeInternal('a/../b')).toBe('b');
    expect(normalizeInternal('..')).toBe(null); // escaping the root is the caller's refusal
    expect(normalizeInternal(null)).toBe('');
    expect(resolveAgainstCwd('x')).toBe('x');
    session.cwd = 'sub';
    expect(resolveAgainstCwd('x')).toBe('sub/x');
    expect(resolveAgainstCwd('/abs')).toBe('abs'); // '/'-absolute input folds to the canonical form
    expect(resolveAgainstCwd('deep/')).toBe('sub/deep'); // a trailing slash never un-anchors the cwd
    session.cwd = '';
  });
});


describe('shell-js: support layer — the gateway mapping and outcome shapes', () => {
  it('toGateway reads the pinned workspace prefix; an escape refuses exit 2', () => {
    expect(toGateway('a/b')).toEqual({ scope: 'app', path: 'dsh/a/b' });
    expect(toGateway('')).toEqual({ scope: 'app', path: 'dsh' });
    expect(() => toGateway('../x')).toThrow(ShellRefusal);
    try {
      toGateway('../x');
    } catch (e) {
      expect(e.exitCode).toBe(2); // the refusal family's exit-code convention
      expect(e.message).toContain('escapes the workspace');
    }
  });

  it('a host that grants the workspace AT the scope root joins paths without a prefix', () => {
    // The pinned globals are a contract, and workspace === scopeRoot is a
    // legal grant: the gateway path is then workspace-relative with no
    // 'dsh' prefix, and the root itself is '.'.
    globalThis.__dshProfileCwd = '/profiles';
    globalThis.__dshProfileScopeRoot = '/profiles';
    expect(toGateway('a/b')).toEqual({ scope: 'app', path: 'a/b' });
    expect(toGateway('')).toEqual({ scope: 'app', path: '.' });
  });

  it('a host that granted no scoped workspace refuses loudly, never silently', async () => {
    delete globalThis.__dshProfileScopeRoot;
    expect(() => toGateway('a')).toThrow(/scoped workspace/);
    // Through the executor, the gateway's capability-gap code maps into the
    // refusal family: exit 2, naming the primitive and the missing grant.
    const result = await run('ls');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('shell is not available on this host');
    expect(result.stderr).toContain('scoped workspace');
  });

  it('a host that granted no workspace refuses the same way', () => {
    delete globalThis.__dshProfileCwd;
    expect(() => toGateway('a')).toThrow(/scoped workspace/);
  });

});

describe('shell-js: support layer — shellStringOutcome', () => {
  it('normalizes every body shape into the executor outcome', () => {
    const out = (result) => shellStringOutcome(result);
    expect(out(undefined)).toEqual({ stdout: '', stderr: '', code: 0 });
    expect(out(null)).toEqual({ stdout: '', stderr: '', code: 0 });
    expect(out('plain')).toEqual({ stdout: 'plain', stderr: '', code: 0 });
    expect(out(['a', 'b'])).toEqual({ stdout: 'a\nb\n', stderr: '', code: 0 });
    expect(out([])).toEqual({ stdout: '', stderr: '', code: 0 }); // an empty join adds no artifact newline
    expect(out({ stdout: 'x', stderr: 'e', code: 3 }))
      .toEqual({ stdout: 'x', stderr: 'e', code: 3 });
    expect(out({ stdout: 'partial\n', code: 1 }))
      .toEqual({ stdout: 'partial\n', stderr: '', code: 1 }); // real output survives a failure
    expect(out({ stdout: '\n', code: 1 })).toEqual({ stdout: '', stderr: '', code: 1 }); // the bare newline is formatting
    expect(out({ stdout: '\n', code: 0 })).toEqual({ stdout: '\n', stderr: '', code: 0 }); // a success keeps its newline
    expect(out({ stdout: '\n' })).toEqual({ stdout: '\n', stderr: '', code: 0 }); // no code: not a refusal shape
    expect(out({ code: '3' })).toEqual({ stdout: '', stderr: '', code: 0 }); // a non-numeric code is not a code
    expect(out({ stderr: 42 })).toEqual({ stdout: '', stderr: '', code: 0 });
  });

  it('textOfStdin drains a reader and answers null when there is none', async () => {
    expect(await textOfStdin(null)).toBe(null);
    expect(await textOfStdin(undefined)).toBe(null);
    expect(await textOfStdin({ read: async () => ({ done: true }) })).toBe('');
    const chunks = [encoder.encode('ab'), encoder.encode('cd')];
    let i = 0;
    const reader = { read: async () => (i < chunks.length
      ? { done: false, bytes: chunks[i++] }
      : { done: true }) };
    expect(await textOfStdin(reader)).toBe('abcd');
  });

  it('an unavailable primitive answers as a refusal family member: exit 2, named, detailed', () => {
    const named = unavailableRefusal({ primitive: 'fsList', message: 'the host lacks the lister' });
    expect(named).toBeInstanceOf(ShellRefusal);
    expect(named.exitCode).toBe(2);
    expect(named.message).toContain('fsList');
    expect(named.message).toContain('the host lacks the lister');
    const bare = unavailableRefusal({});
    expect(bare.exitCode).toBe(2);
    expect(bare.message).toContain('a gateway primitive');
    expect(bare.message).toContain('the capability is absent');
  });

});

describe('shell-js: support layer — stdin and the refusal family', () => {
  it('the subprocess stub refuses by the NO_SUBPROCESS contract, never silently', () => {
    // Assert the thrown VALUE, not just that something flew: a refusal that
    // degrades to `throw undefined` must not pass as a refusal.
    let thrown;
    try {
      void subprocessStub.spawn;
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toContain('no child processes');
    expect(thrown.message).toContain('no subprocess by design');
    expect(NO_SUBPROCESS).toContain('no subprocess by design');
  });
});
