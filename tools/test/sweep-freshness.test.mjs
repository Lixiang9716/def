// dsh:logging-exempt (dev tool: its stdout is the report)
/** sweep-freshness.test.mjs — the freshness gate's tests, split from
 * sweep.test.mjs when that file crossed the line budget (2026-10-22). */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { ensureFresh, SweepFailure } from './sweep.mjs';
import { computeFingerprint } from '../../test/verifications.mjs';

const seat = () => mkdtempSync(join(tmpdir(), 'sweep-test-'));
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

it('ensureFresh does nothing when the staged stamp matches the fingerprint', async () => {
  const root = seat();
  const now = computeFingerprint();
  writeFileSync(join(root, 'gen.stamp'), now);
  const drive = { freshness: { stamp: 'gen.stamp', refresh: [{ cwd: '.', argv: ['node', '-e', 'process.exit(1)'] }] } };
  const out = await ensureFresh({ root, drive, dryRun: false });
  expect(out).toEqual({ staged: now, now, stale: false, ranRefresh: false });
  cleanup(root);
});

it('ensureFresh prints the bash stale line and runs every refresh step in order on mismatch', async () => {
  const root = seat();
  const marker = join(root, 'marker');
  writeFileSync(join(root, 'gen.stamp'), 'stale-stamp-value');
  const drive = {
    freshness: {
      stamp: 'gen.stamp',
      refresh: [
        { cwd: '.', argv: ['node', '-e', 'require("node:fs").writeFileSync(process.argv[1], "one")', marker] },
        { cwd: '.', argv: ['node', '-e', 'require("node:fs").appendFileSync(process.argv[1], "two")', marker] },
      ],
    },
  };
  const logged = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...parts) => logged.push(parts.join(' ')));
  try {
    const out = await ensureFresh({ root, drive, dryRun: false });
    expect(out.stale).toBe(true);
    expect(out.ranRefresh).toBe(true);
    expect(readFileSync(marker, 'utf8')).toBe('onetwo');
  } finally {
    spy.mockRestore();
  }
  expect(logged.join('\n')).toContain('sweep: staged upstream-tests stale (gen stale-stamp-');
  expect(logged.join('\n')).toContain('— re-transpiling');
  cleanup(root);
});

it('ensureFresh aborts with a SweepFailure when a refresh step fails (delta 4)', async () => {
  const root = seat();
  writeFileSync(join(root, 'gen.stamp'), 'stale-stamp-value');
  const drive = { freshness: { stamp: 'gen.stamp', refresh: [{ cwd: '.', argv: ['node', '-e', 'process.exit(3)'] }] } };
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await expect(ensureFresh({ root, drive, dryRun: false })).rejects.toThrow(/freshness step failed.*exit 3/s);
  } finally {
    spy.mockRestore();
  }
  cleanup(root);
});

it('ensureFresh dryRun compares only — a stale stamp triggers no refresh step', async () => {
  const root = seat();
  writeFileSync(join(root, 'gen.stamp'), 'stale-stamp-value');
  const drive = {
    freshness: {
      stamp: 'gen.stamp',
      refresh: [
        { cwd: '.', argv: ['node', '-e', 'require("node:fs").writeFileSync(process.argv[1], "RAN")', join(root, 'marker')] },
      ],
    },
  };
  const out = await ensureFresh({ root, drive, dryRun: true });
  expect(out.stale).toBe(true);
  expect(out.ranRefresh).toBe(false);
  expect(existsSync(join(root, 'marker'))).toBe(false);
  cleanup(root);
});
