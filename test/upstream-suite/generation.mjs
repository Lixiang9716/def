#!/usr/bin/env node
// dsh:logging-exempt (tool: its stdout is the fingerprint)
/**
 * generation.mjs — the upstream-tests generation fingerprint.
 *
 * The staged specs under runtime/dsh/upstream-tests/ are LOCAL-ONLY
 * (untracked): nothing updates them when an input changes, so a tree that
 * survived a transpiler change silently served the OLD artifacts (measured
 * 2026-10-20: #614's transpiler fix stayed invisible on main — 29/2 stale
 * vs 31/0 fresh — until transpile.mjs was re-run by hand).
 *
 * The fingerprint = sha256 over every input that determines the staged
 * bytes, represented by CHEAP markers: the transpilers' own bytes, the
 * suite's lockfile (the bundler's version), and the vendored trees'
 * .vendor-pin stamps — each stamp carries its tarball's sha256, so by the
 * D6 pin discipline the stamp IS the tree's content identity (hashing
 * 250 MB would say the same thing slower). Written by transpile.mjs as
 * runtime/dsh/upstream-tests/.generation after a FULL successful pass;
 * compared by tools/test/sweep.mjs (the Node sweep driver — the
 * run-upstream-suite-sweep.sh exec shim forwards to it) and
 * `verifications.mjs --check-fresh`. A half-finished transpile never
 * claims freshness.
 *
 * usage: node generation.mjs → prints the hex fingerprint.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SUITE = join(ROOT, 'test/upstream-suite');

/** The pinned submodule corpus (third-party/deepseek-harness): the gitlink
 * sha is the pin; the working tree's own HEAD marks whether it is
 * MATERIALIZED. Without these markers an uninitialized seat produced the
 * IDENTICAL stamp over 33 fewer specs — the identical-stamp/648≠681 trap
 * (#627). 'absent' is the un-materialized marker. The .git existence check
 * comes FIRST: rev-parse on a missing/empty submodule dir walks UP and
 * would answer the superproject's HEAD. */
const hashSubmoduleMarkers = (hash) => {
  hash.update('submodule:third-party/deepseek-harness');
  hash.update(execFileSync('git', ['ls-tree', 'HEAD', '--', 'third-party/deepseek-harness'], { cwd: ROOT }).toString());
  let submoduleHead = 'absent';
  if (existsSync(join(ROOT, 'third-party/deepseek-harness/.git'))) {
    try {
      submoduleHead = execFileSync('git', ['-C', 'third-party/deepseek-harness', 'rev-parse', 'HEAD'], {
        cwd: ROOT,
      }).toString();
    } catch {
      /* a .git entry exists but is not resolvable — treat as absent */
    }
  }
  hash.update(submoduleHead);
};

/** The staged bytes' full input set, as deterministic marker bytes. */
export const computeFingerprint = () => {
  const hash = createHash('sha256');
  // The transpilers + the lockfile (which pins esbuild): the code half.
  for (const f of [
    'transpile.mjs',
    'transpile-rewrites.mjs',
    'transpile-decorators.mjs',
    'package-lock.json',
  ]) {
    hash.update(f);
    hash.update(readFileSync(join(SUITE, f)));
  }
  // The vendored trees' pin stamps (external/, recursive): the data half.
  const stamps = [];
  const walk = (dir, depth) => {
    if (depth > 6 || !existsSync(dir)) return;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, name.name);
      if (name.isDirectory()) walk(full, depth + 1);
      else if (name.name === '.vendor-pin') {
        stamps.push([relative(ROOT, full).split('\\').join('/'), readFileSync(full)]);
      }
    }
  };
  walk(join(ROOT, 'external'), 0);
  stamps.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [p, bytes] of stamps) {
    hash.update(p);
    hash.update(bytes);
  }
  hashSubmoduleMarkers(hash);
  return hash.digest('hex');
};

/** CLI: print the fingerprint (the sweep and the stamp writer call the
 * export directly; this face is for a human checking by hand). The argv
 * side is realpath'd: the ESM loader resolves symlinks in import.meta.url,
 * argv[1] stays as typed, and a symlinked checkout must not turn this into
 * a silent exit 0 (rule 5). */
const isEntryModule = () => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
};

if (isEntryModule()) {
  console.log(computeFingerprint());
}
