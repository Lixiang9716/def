import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, rmSync, chmodSync, statSync as nodeStatSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { mountWorkspace } from 'upstream/shims/fs-workspace.js';
import { statSync as shimStatSync, accessSync as shimAccessSync } from 'upstream/shims/fs-stat.js';
import { access as promisesAccess } from 'upstream/shims/fs-promises.js';
import { readFileSync } from 'upstream/shims/fs.js';
import { mkdtempPosix } from './posix-fixture.mjs';

// #259 (2026-10-19): the lsp-stdio residual failures traced to two stat-face
// lies. This suite pins the truthful metadata law each fix installed, with
// the seam faked over node:fs (the two loop-r suites' shapes):
//
//   1. The real-disk stat fallback answers the TRUTHFUL kind — the old
//      `isDir ? 'dir' : 'file'` presented every FIFO/device as a regular
//      file, so the vendored is-regular-file gates (fs-local
//      statRegularFile, pathType's 'other', the lsp provider's own gate)
//      never fired and a FIFO read died in open instead.
//   2. stat/access are METADATA faces: a path the host disk holds answers
//      from OUTSIDE the root too (the existsSync "visible ≠ accessible"
//      precedent) — the pre-spawn executability check must see the real
//      node binary — while the DATA faces keep the loop-r boundary and
//      absence keeps node-ENOENT (R3-G1).
//   3. access X_OK answers the real (or chmod-tracked) mode on regular
//      files — a 0644 file must refuse — on BOTH the sync face and the
//      promises face (the vendored resolveExecutable is async).

const root = mkdtempPosix('dsh-stat-meta-');
mountWorkspace(root);

// An outside-root sibling tree with the three metadata shapes the lsp-stdio
// provider exercises: a REAL executable (the process.execPath stand-in), a
// REAL non-executable regular file (the not-exe.txt shape), and a FIFO (the
// host spec's pipe.ts shape).
const outside = mkdtempPosix('dsh-stat-meta-out-');
writeFileSync(join(outside, 'tool'), 'binary\n');
chmodSync(join(outside, 'tool'), 0o755);
writeFileSync(join(outside, 'not-exe.txt'), 'plain text, not executable\n');
if (process.platform !== 'win32') {
  const r = spawnSync('mkfifo', [join(outside, 'pipe')]);
  if (r.status !== 0) throw new Error(`mkfifo failed: ${r.stderr}`);
}

// The seam faked over node:fs (the C host's face: plain booleans — truthfully
// S_ISREG/S_ISDIR — plus the full mode/mtime fields the fallback versions).
const statReal = (p) => {
  try {
    const st = nodeStatSync(p);
    return {
      isDirectory: st.isDirectory(),
      isFile: st.isFile(),
      isSymbolicLink: st.isSymbolicLink(),
      size: Number(st.size),
      mode: Number(st.mode),
      mtimeMs: Math.trunc(Number(st.mtimeMs)),
    };
  } catch {
    return null;
  }
};
globalThis.__dshProcStatReal = statReal;

afterAll(() => {
  delete globalThis.__dshProcStatReal;
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('the real-disk stat answers the truthful kind (#259 fix 1)', () => {
  it('a FIFO is neither file nor directory — the provider-owned gates can fire', () => {
    if (process.platform === 'win32') return; // no special-entry fixture there
    const shape = shimStatSync(join(outside, 'pipe'));
    expect(shape.isFile()).toBe(false);
    expect(shape.isDirectory()).toBe(false);
  });

  it('a real regular file outside the root still answers isFile()=true', () => {
    const shape = shimStatSync(join(outside, 'tool'));
    expect(shape.isFile()).toBe(true);
    expect(shape.isDirectory()).toBe(false);
  });

  it('the real permission bits ride the answer (the executable reads 0755)', () => {
    const shape = shimStatSync(join(outside, 'tool'));
    expect(shape.mode & 0o777).toBe(0o755);
  });
});

describe('stat is a metadata face — visible from outside the root (#259 fix 2)', () => {
  it('answers a real outside-root regular file with its true mode', () => {
    const shape = shimStatSync(join(outside, 'not-exe.txt'));
    expect(shape.isFile()).toBe(true);
    expect(shape.mode & 0o777).toBe(0o644);
  });

  it('keeps node-absence (ENOENT) for an outside-root path the host does not hold (R3-G1)', () => {
    let error;
    try {
      shimStatSync(`/tmp/dsh-stat-meta-absent-${process.pid}/no-such.txt`);
      expect.unreachable('the absent stat must throw');
    } catch (caught) {
      error = caught;
    }
    expect(error.code).toBe('ENOENT');
    expect(error.syscall).toBe('stat');
  });

  it('the data face keeps the loop-r boundary: an outside-root read refuses with the anchor', () => {
    // The #259 law: visible ≠ accessible. stat may answer; the bytes may
    // not move — readFileSync still refuses with the #358 anchor.
    let error;
    try {
      readFileSync(join(outside, 'not-exe.txt'), 'utf8');
      expect.unreachable('the outside-root read must refuse');
    } catch (caught) {
      error = caught;
    }
    expect(error.message).toContain('outside the writable workspace root');
    expect(error.message).toContain('maybe you meant');
    expect(error.code).toBe('EACCES');
    expect(error.syscall).toBe('readFileSync');
  });
});

describe('access answers the real mode on regular files (#259 fix 2, sync face)', () => {
  it('X_OK on a real outside-root executable resolves (the pre-spawn check sees its candidate)', () => {
    expect(() => shimAccessSync(join(outside, 'tool'), 1)).not.toThrow(); // constants.X_OK
  });

  it('X_OK on a real outside-root non-executable refuses EACCES', () => {
    let error;
    try {
      shimAccessSync(join(outside, 'not-exe.txt'), 1);
      expect.unreachable('the non-executable X_OK must refuse');
    } catch (caught) {
      error = caught;
    }
    expect(error.code).toBe('EACCES');
    expect(error.errno).toBe(-13);
    expect(error.syscall).toBe('access');
  });

  it('R_OK on the non-executable still resolves (the runner-invocation probe leg)', () => {
    expect(() => shimAccessSync(join(outside, 'not-exe.txt'), 4)).not.toThrow(); // constants.R_OK
  });

  it('an outside-root ABSENT path stays ENOENT on the access face (R3-G1)', () => {
    let error;
    try {
      shimAccessSync(`/tmp/dsh-stat-meta-absent-${process.pid}/no-such.txt`, 1);
      expect.unreachable('the absent access must throw');
    } catch (caught) {
      error = caught;
    }
    expect(error.code).toBe('ENOENT');
    expect(error.syscall).toBe('stat'); // access inherits stat's absence shape
  });

  it('X_OK answers the chmod-TRACKED mode on workspace files (the provider not-exe shape)', () => {
    // The lsp provider spec's absolute not-executable command is an
    // INSIDE-root workspace file: tracked 0644 must refuse X_OK, a chmod to
    // 0755 must pass — the same mode statSync reads.
    const wsFile = join(root, 'candidate.txt');
    writeFileSync(wsFile, 'plain\n');
    let error;
    try {
      shimAccessSync(wsFile, 1);
      expect.unreachable('the 0644 X_OK must refuse');
    } catch (caught) {
      error = caught;
    }
    expect(error.code).toBe('EACCES');
    chmodSync(wsFile, 0o755);
    expect(() => shimAccessSync(wsFile, 1)).not.toThrow();
  });
});

describe('access answers the real mode on the promises face too (the vendored resolveExecutable leg)', () => {
  it('X_OK resolves for the outside-root executable and refuses for the 0644 file', async () => {
    await expect(promisesAccess(join(outside, 'tool'), 1)).resolves.toBeUndefined();
    await expect(promisesAccess(join(outside, 'not-exe.txt'), 1)).rejects.toMatchObject({
      code: 'EACCES',
      syscall: 'access', // the delegation answers with the sync face's error shape
    });
  });

  it('F_OK stays the existence probe — staged answers without mode checks', async () => {
    await expect(promisesAccess(join(outside, 'not-exe.txt'))).resolves.toBeUndefined();
    await expect(promisesAccess(`/tmp/dsh-stat-meta-absent-${process.pid}/no-such.txt`)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
