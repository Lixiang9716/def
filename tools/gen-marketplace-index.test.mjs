// dsh:logging-exempt (test file: assertions ARE the product)
/**
 * gen-marketplace-index.test.mjs — the signed catalog's data-level net
 * (tools/gen-marketplace-index.mjs).
 *
 * The generator fails loud (rule 5) the moment a system plugin lacks its
 * deploy/marketplace/summaries.json row — found the honest way on
 * 2026-10-08, when the device-verification round's marketplace cycle could
 * not build a catalog: dsh-plugin-manager-tools (added 2026-10-04) had no
 * summary row, so EVERY publish run aborted mid-flight. This suite pins the
 * invariant at the data level so the next plugin lands with its row: every
 * system-plugins/<pkg> carrying a manifest.json must have a summaries row
 * with non-empty en AND zh strings — the exact demand the generator's
 * fail-loud makes. Also pins the shape the resolver's display face reads
 * (each summary is exactly {en, zh}).
 *
 * Offline. The green legs read the repo's own files and write nothing. A
 * guard that only ever sees satisfying input is a vacuous script (rules.md
 * rule 6), so the fail-loud describe below hands the REAL generator a
 * fixture plugin tree (under the OS tmpdir, via --system-plugins) whose
 * manifest id has no row — the 2026-10-08 shape — and proves the publish
 * aborts exit 1 naming the plugin; the row-linked twin proves the same
 * fixture publishes clean, so the red is caused by exactly the missing
 * row and nothing else. deploy/marketplace/summaries.json is only ever
 * READ.
 */
import { describe, expect, it, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..');
const PLUGINS = join(REPO, 'system-plugins');
const SUMMARIES = join(REPO, 'deploy', 'marketplace', 'summaries.json');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

// The fail-loud leg's scaffolding lives at module scope: the code-size gate
// caps a function at 50 lines, and the red-leg describe reads cleaner with
// its fixtures beside the other module constants (the house idiom of the
// tools' counterexample nets).
const RED_SUMMARIES = readJson(SUMMARIES);
const GEN = join(import.meta.dirname, 'gen-marketplace-index.mjs');
const THROWAWAY_SEED = Buffer.alloc(32).toString('base64'); // never a real credential
const fixtures = [];

/** One tmp root: a system-plugins tree with a single VALID plugin (the
 * manifest clears validateManifest, so the run reaches the summaries
 * check, not an earlier guard) whose id's row presence is decided by
 * the caller's id choice. */
const fixtureTree = (id) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-marketplace-guard-'));
  fixtures.push(root);
  const dir = join(root, 'system-plugins', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 1, id, version: '0.0.1', type: 'service', entry: 'index.js',
    capabilities: { required: [], optional: [] },
  }, null, 2)}\n`);
  writeFileSync(join(dir, 'index.js'), 'export default {};\n');
  return { root, plugins: join(root, 'system-plugins'), out: join(root, 'dist') };
};

const runGenerator = ({ plugins, out }) => spawnSync(process.execPath, [
  GEN, '--base-url', 'https://marketplace.invalid',
  '--system-plugins', plugins, '--out', out, '--key-seed', THROWAWAY_SEED,
], { encoding: 'utf8' });

afterAll(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
});

describe('marketplace catalog summaries cover every system plugin', () => {
  const summaries = readJson(SUMMARIES);
  const pluginDirs = readdirSync(PLUGINS).filter((name) =>
    existsSync(join(PLUGINS, name, 'manifest.json')));

  it('there are system plugins to cover (the suite guards a real surface)', () => {
    expect(pluginDirs.length).toBeGreaterThan(0);
  });

  it('every system plugin has a summaries row with non-empty en and zh', () => {
    const missing = pluginDirs.filter((name) => summaries[name] === undefined);
    expect(missing, `deploy/marketplace/summaries.json has no row for: ${missing.join(', ')}`
      + ' — gen-marketplace-index.mjs aborts the publish on exactly this gap').toEqual([]);
    for (const name of pluginDirs) {
      for (const lang of ['en', 'zh']) {
        expect(typeof summaries[name]?.[lang], `${name}.${lang}`).toBe('string');
        expect(summaries[name][lang].trim().length, `${name}.${lang}`).toBeGreaterThan(0);
      }
    }
  });

  it('every summary row is exactly {en, zh} (the frozen display shape)', () => {
    for (const [name, row] of Object.entries(summaries)) {
      expect(Object.keys(row).sort(), name).toEqual(['en', 'zh']);
    }
  });
});

describe('the fail-loud leg: a plugin without its summaries row aborts the publish (rule 6)', () => {
  // The green legs above only prove the invariant holds on TODAY's tree —
  // the red proof they gesture at (the original note and commit message:
  // "with the row stashed the suite goes red") was a one-off manual run
  // CI cannot reproduce. These legs make that run permanent: the generator
  // itself, real CLI, must reject the exact gap the green legs name. The
  // counterexample is a fixture plugin whose manifest id has no row in the
  // real summaries file — the row is absent by construction, the data file
  // itself is never touched (scaffolding at module scope, above).
  it('a rowless plugin aborts the publish (exit 1) naming the plugin, writing nothing', () => {
    const id = 'dsh-redleg-no-summary-row';
    expect(RED_SUMMARIES[id], 'fixture precondition: the id must have no row in the real file')
      .toBeUndefined();
    const fx = fixtureTree(id);
    const r = runGenerator(fx);
    expect(r.status, r.stderr).toBe(1);
    expect(r.stderr).toContain('gen-marketplace-index: deploy/marketplace/summaries.json'
      + ` has no {en,zh} summary for ${id}`);
    expect(existsSync(join(fx.out, 'index.json')), 'a failed run must not publish').toBe(false);
  });

  it('the same fixture with a row-linked id publishes clean — the red fails on exactly the missing row', () => {
    const id = 'dsh-shell-wasm'; // a real summaries row exists (the green legs cover it)
    expect(RED_SUMMARIES[id], 'fixture precondition: the id must have a row in the real file')
      .toBeDefined();
    const fx = fixtureTree(id);
    const r = runGenerator(fx);
    expect(r.status, r.stderr).toBe(0);
    const index = JSON.parse(readFileSync(join(fx.out, 'index.json'), 'utf8'));
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].id).toBe(id);
    expect(index.entries[0].summary).toEqual(RED_SUMMARIES[id]);
  });
});
