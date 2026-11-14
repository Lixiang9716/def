// #790 — the session-persistence flush failure's two glue seams, pinned at
// the unit face:
//
//   1. surfaceFlushFailures — the mounted backend's flush face wrapped so
//      the AggregateError's PER-WRITER causes reach the log (warn survives
//      the release L4 strip). Before, only the aggregate `.message`
//      ("session-persistence-jsonl flush failed") survived anywhere — the
//      real cause was invisible and the flush failure undiagnosable.
//   2. backendWorkspaceRoot / armWorkspaceForBackend — the gated row re-arms
//      the fs shims' writable-workspace VFS at the profile container before
//      the vendored backend mounts: the backend's durable journal I/O rides
//      the RAW node:fs/promises faces, which this host serves through that
//      VFS (retired from the product boot by #762 — this gated row is the
//      remaining consumer). A pre-mounted workspace at the container is
//      kept (the suite legs' own mount), and no container means no-op.
import { describe, it, expect, afterEach } from 'vitest';

import {
  surfaceFlushFailures,
  backendWorkspaceRoot,
  armWorkspaceForBackend,
} from '../../runtime/dsh/upstream/boot-session-persistence.js';

const fakeLog = () => {
  const calls = [];
  return {
    calls,
    warn: (message, data) => calls.push({ level: 'warn', message, data }),
    debug: () => {},
    info: () => {},
    error: () => {},
  };
};

const PROFILE_CWD = '/tmp/dsh-790-container';
describe('#790 flush surfacing', () => {
  it('warns each per-writer cause of the AggregateError and rethrows unchanged', async () => {
    const log = fakeLog();
    const inner1 = Object.assign(new Error('node:fs.mkdir: path outside the writable workspace root: /tmp/x/dsh/sessions/y'), {
      code: undefined,
      stack: '    at wsMkdir (upstream/shims/fs-workspace-write.js:72:99)',
    });
    const inner2 = Object.assign(new Error('EACCES: permission denied, open /tmp/x/dsh/sessions/y/session.v3.jsonl'), {
      code: 'EACCES',
      stack: '    at wsWriteFile (upstream/shims/fs-workspace-write.js:171:99)',
    });
    const backend = {
      name: 'session-persistence-jsonl',
      flush: async () => {
        throw new AggregateError([inner1, inner2], 'session-persistence-jsonl flush failed');
      },
    };
    surfaceFlushFailures(backend, log);
    await expect(backend.flush()).rejects.toThrow('session-persistence-jsonl flush failed');
    expect(log.calls.length).toBe(2);
    expect(log.calls[0].level).toBe('warn');
    expect(log.calls[0].data.backend).toBe('session-persistence-jsonl');
    expect(log.calls[0].data.cause).toContain('path outside the writable workspace root');
    expect(log.calls[1].data.cause).toContain('EACCES');
    expect(log.calls[1].data.code).toBe('EACCES');
    expect(log.calls[1].data.stack).toContain('wsWriteFile');
  });

  it('surfaces a non-aggregate rejection as one warn with the error itself', async () => {
    const log = fakeLog();
    const backend = {
      name: 'session-persistence-jsonl',
      flush: async () => {
        throw Object.assign(new Error('SessionHandleClosedError'), { code: 'CLOSED' });
      },
    };
    surfaceFlushFailures(backend, log);
    await expect(backend.flush()).rejects.toThrow('SessionHandleClosedError');
    expect(log.calls.length).toBe(1);
    expect(log.calls[0].data.cause).toBe('SessionHandleClosedError');
    expect(log.calls[0].data.code).toBe('CLOSED');
  });

  it('leaves a flush-less backend untouched', () => {
    const log = fakeLog();
    const backend = { name: 'session-persistence-jsonl' };
    expect(surfaceFlushFailures(backend, log)).toBe(backend);
    expect(backend.flush).toBeUndefined();
  });
});

describe('#790 workspace arm', () => {
  const saved = {};
  afterEach(() => {
    delete globalThis.__dshProfileCwd;
    if ('__DSH_WORKSPACE_FS__' in saved) globalThis.__DSH_WORKSPACE_FS__ = saved.__DSH_WORKSPACE_FS__;
    else delete globalThis.__DSH_WORKSPACE_FS__;
  });

  it('backendWorkspaceRoot normalizes the container spelling and refuses unusable pins', () => {
    expect(backendWorkspaceRoot('/tmp/x/')).toBe('/tmp/x');
    expect(backendWorkspaceRoot('/tmp/x')).toBe('/tmp/x');
    expect(backendWorkspaceRoot('/')).toBeNull();
    expect(backendWorkspaceRoot('')).toBeNull();
    expect(backendWorkspaceRoot(undefined)).toBeNull();
  });

  it('keeps a pre-mounted workspace whose root already covers the container', async () => {
    globalThis.__dshProfileCwd = PROFILE_CWD;
    saved.__DSH_WORKSPACE_FS__ = { root: PROFILE_CWD };
    globalThis.__DSH_WORKSPACE_FS__ = saved.__DSH_WORKSPACE_FS__;
    // No shim import, no remount, no state wipe.
    await expect(armWorkspaceForBackend()).resolves.toBe(false);
    expect(globalThis.__DSH_WORKSPACE_FS__).toBe(saved.__DSH_WORKSPACE_FS__);
  });

  it('is a no-op without a pinned container', async () => {
    delete globalThis.__dshProfileCwd;
    await expect(armWorkspaceForBackend()).resolves.toBe(false);
  });

  it('mounts the workspace VFS at the container when none is pinned', async () => {
    globalThis.__dshProfileCwd = PROFILE_CWD;
    delete globalThis.__DSH_WORKSPACE_FS__;
    await expect(armWorkspaceForBackend()).resolves.toBe(true);
    expect(globalThis.__DSH_WORKSPACE_FS__?.root).toBe(PROFILE_CWD);
  });
});
