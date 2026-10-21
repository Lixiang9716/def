// dsh:logging-exempt (dev tool: its stdout is the progress line)
/**
 * parity-farm.mjs — the node leg's bare-specifier resolution farm,
 * self-materialized. The farm lives under external/node_modules and its
 * links resolve INTO the vendored closure, so a tree without external/dsh
 * (hermetic test fixtures, tests-only checkouts) has no node leg to feed
 * and is skipped silently; a real seat without the farm used to die at
 * module load with every node cell landing TIMEOUT-OR-ERROR (#627).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Build the farm when absent. Returns true when the leg can resolve
 * (farm present or freshly built), false when the build failed. */
export const ensureParityFarm = (root) => {
  if (!existsSync(join(root, 'external', 'dsh'))) return true;
  if (existsSync(join(root, 'external', 'node_modules'))) return true;
  console.log('sweep: external/node_modules absent — building the parity farm');
  const r = spawnSync('sh', ['runtime/dsh/ci/parity-node-modules.sh'], { cwd: root, stdio: 'inherit' });
  return (r.status ?? 1) === 0;
};
