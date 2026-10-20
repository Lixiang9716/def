#!/usr/bin/env node
// dsh:logging-exempt (CI wrapper: the child's stdout IS the step's product)
/**
 * flake-retry.mjs — ONE in-step retry for known-flaky CI signatures.
 *
 * usage: node tools/test/flake-retry.mjs -- <cmd...>
 *
 * Runs <cmd...> (stdin inherited; stdout/stderr captured and replayed
 * verbatim, so the step's product is byte-identical to a bare run). If the
 * command fails and its complete output contains a signature registered in
 * .github/flakes.json, the command is retried ONCE per that row's
 * maxRetries — the dev-harmonyos for-attempt precedent: the workflow step
 * (not the checker) owns the loop, so ci-verdict only ever sees the final
 * attempt. Visibility never drops: every retry and every green-on-retry
 * emits a ::warning:: annotation on the run. The exit code is always the
 * FINAL attempt's exit code.
 *
 * A missing or empty .github/flakes.json means plain pass-through — the
 * command still runs, nothing is ever retried. Rows carry an `expires`
 * date; pruning expired rows is a human debt-review act (the wrapper never
 * silently ignores a registered signature).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FLAKES_PATH = join(ROOT, '.github/flakes.json');

const usage = (message) => {
  console.error(`flake-retry.mjs: ${message}`);
  console.error('usage: node tools/test/flake-retry.mjs -- <cmd...>');
  process.exit(2);
};

const loadFlakes = () => {
  let raw;
  try {
    raw = readFileSync(FLAKES_PATH, 'utf8');
  } catch {
    return []; // no registry — plain pass-through (documented above)
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // A malformed registry is neither absent nor empty (rule 5): a typo
    // must not silently turn every retry off.
    usage(`.github/flakes.json is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed.flakes)) {
    usage('.github/flakes.json must carry a "flakes" array');
  }
  return parsed.flakes;
};

/** The first registered signature whose string occurs in the output. */
const matchFlake = (flakes, output) =>
  flakes.find((row) => typeof row.signature === 'string' && output.includes(row.signature));

const run = (cmd) => {
  const r = spawnSync(cmd[0], cmd.slice(1), { stdio: ['inherit', 'pipe', 'pipe'] });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  const output = `${r.stdout ? r.stdout.toString() : ''}${r.stderr ? r.stderr.toString() : ''}`;
  return { status: r.status, output };
};

const args = process.argv.slice(2);
if (args[0] !== '--') {
  usage(`expected '--' before the command, got ${args.length ? `'${args[0]}'` : '(nothing)'}`);
}
const cmd = args.slice(1);
if (cmd.length === 0) usage("no command after '--'");

const flakes = loadFlakes();
let attempt = 1;
let flake = null;
let retried = false;

for (;;) {
  const { status, output } = run(cmd);
  if (status === 0) {
    if (retried && flake) {
      process.stderr.write(`::warning::green on retry (known flake, ${flake.ref})\n`);
    }
    process.exit(0);
  }
  flake = matchFlake(flakes, output);
  if (flake && attempt < flake.maxRetries + 1) {
    process.stderr.write(`::warning::known flake (${flake.ref}), retrying once\n`);
    attempt += 1;
    retried = true;
    continue;
  }
  process.exit(status ?? 1);
}
