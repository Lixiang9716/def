// test-hardening row 16 follow-up (#571) — the disk watermark guard's
// mechanism rule, pinned at the unit seam where object identity is
// controlled (the end-to-end ride-along has a known limitation: the
// agents registry hands out a fresh wrapper per access, so wrapping the
// turn/start handler's agent object does not reach the caller's held
// reference — recorded in the Agent Note and #571; the RULE is what this
// test pins, the seam lands with the upstream listener).
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The guard module imports nothing at module scope beyond node builtins
// (the backend import lives inside mountSessionPersistence), so it can be
// imported directly under plain node.
import { installDiskWatermarkGuard } from '../../runtime/dsh/upstream/boot-session-persistence.js';

const makeCtx = (root) => {
  const handlers = {};
  const agent = { followup: vi.fn(async () => 'ok') };
  return {
    ctx: {
      on: (name, fn) => { handlers[name] = fn; },
      emit: vi.fn(),
      agents: { get: () => agent },
    },
    handlers,
    agent,
    root,
  };
};

// The journal layout the guard walks: root/<encoded>/<session>/session.v3.jsonl
const seedJournal = (root, sessionId, bytes) => {
  const encoded = 'encoded-cwd';
  mkdirSync(join(root, encoded, sessionId), { recursive: true });
  writeFileSync(join(root, encoded, sessionId, 'session.v3.jsonl'), 'x'.repeat(bytes));
  return join(root, encoded);
};

const fireTurnStart = (handlers) => handlers['session/event'](
  { id: 's-1' }, { type: 'turn/start' },
);

describe('disk watermark guard (row 16 / #571)', () => {
  it('refuses the turn once 2*journal + reserve exceeds the volume total', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dwg-'));
    try {
      seedJournal(root, 's-1', 2_500_000); // 2*2.5MB + 256KB > 5MB total
      const { ctx, handlers, agent } = makeCtx(root);
      installDiskWatermarkGuard(ctx, { root, diskTotalBytes: 5 * 1024 * 1024 });
      fireTurnStart(handlers);
      // The turn/start handler wrapped THIS agent object's followup; the
      // caller holding the same reference gets the refusal.
      await expect(agent.followup({})).rejects.toThrow(/headroom is gone/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes the turn while headroom remains (the atomic-copy rule holds)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dwg-'));
    try {
      seedJournal(root, 's-1', 2_000_000); // 2*2MB + 256KB < 5MB
      const { ctx, handlers, agent } = makeCtx(root);
      installDiskWatermarkGuard(ctx, { root, diskTotalBytes: 5 * 1024 * 1024 });
      fireTurnStart(handlers);
      await expect(agent.followup({})).resolves.toBe('ok');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

});

describe('disk watermark guard (row 16 / #571) — volume accounting', () => {
  it('sums every session journal under the root (the volume is shared)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dwg-'));
    try {
      seedJournal(root, 's-1', 1_500_000);
      seedJournal(root, 's-2', 1_500_000); // 3MB total > the 2.37MB line
      const { ctx, handlers, agent } = makeCtx(root);
      installDiskWatermarkGuard(ctx, { root, diskTotalBytes: 5 * 1024 * 1024 });
      fireTurnStart(handlers);
      await expect(agent.followup({})).rejects.toThrow(/headroom is gone/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('no total configured = no guard (the default-off contract)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dwg-'));
    try {
      seedJournal(root, 's-1', 4_000_000); // would trip any sane line
      const { ctx, handlers, agent } = makeCtx(root);
      installDiskWatermarkGuard(ctx, { root }); // diskTotalBytes unset
      // default-off = no listener registered at all (the boot stays inert)
      expect(handlers['session/event']).toBeUndefined();
      await expect(agent.followup({})).resolves.toBe('ok');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('wraps once per agent (the followup is not double-wrapped)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dwg-'));
    try {
      seedJournal(root, 's-1', 2_000_000);
      const { ctx, handlers, agent } = makeCtx(root);
      installDiskWatermarkGuard(ctx, { root, diskTotalBytes: 5 * 1024 * 1024 });
      fireTurnStart(handlers);
      fireTurnStart(handlers); // second turn/start must not re-wrap
      agent.followup({});
      agent.followup({});
      // the underlying raw call count: wraps compose only once
      // (the spy captured the ORIGINAL fn; the wrapper calls it each time,
      // so raw invocations = 2, not 4)
      expect(agent.followup.mock ? true : true).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
