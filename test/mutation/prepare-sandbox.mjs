// prepare-sandbox.mjs — family-1 (shell-js) Stryker buildCommand.
//
// Stryker's sandbox copier chokes on `runtime/dsh/vendor` (a symlink to the
// materialized `external/` tree: fs.copyFile cannot clone a symlink whose
// target is a 208 MB directory), so the stryker config ignores it — and this
// script re-creates the link INSIDE the sandbox, pointing at the real
// materialized `external/` of the checkout the sandbox sits in. parser.js's
// vendor seam (runtime/dsh/vendor/npm/<name>@<ver>) then reads the pristine
// pinned bytes exactly as it does outside mutation testing; nothing vendored
// is ever copied into or mutated by the sandbox.
//
// Invoked by Stryker with cwd = the sandbox root, after the file copy. The
// sandbox lives at <seat>/test/mutation/.stryker-tmp/sandbox-*/ — walking up
// from the script's own sandbox location (or cwd) reaches the seat root that
// carries external/npm/shelljs@0.10.0.
import { existsSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const marker = (dir) => existsSync(join(dir, 'external', 'npm', 'shelljs@0.10.0'));

let seat = resolve(process.cwd());
if (!marker(seat)) {
  // The config copy of this script sits at <sandbox>/test/mutation/; walk up
  // until the seat root (the checkout that owns external/) is found.
  for (let dir = dirname(new URL(import.meta.url).pathname); ; dir = dirname(dir)) {
    if (marker(dir)) { seat = dir; break; }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('prepare-sandbox: no seat root with external/npm/shelljs@0.10.0 above '
        + process.cwd());
    }
  }
}

const link = 'runtime/dsh/vendor';
try { unlinkSync(link); } catch { /* absent: fine */ }
symlinkSync(join(seat, 'external'), link);
console.log(`prepare-sandbox: runtime/dsh/vendor -> ${join(seat, 'external')}`);
