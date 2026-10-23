// dsh:logging-exempt (test provisioning script: console IS the product)
/**
 * provision-farm.mjs — vitest globalSetup: best-effort provisioning of the
 * runtime/dsh/node_modules farm (the device bare-map mirror the real-runtime
 * panel suites resolve through), via the spine suite's idempotent
 * provisioner. Needs the materialized vendored closure (external/ensure-dsh.sh
 * — build/ensure-seat.sh runs it); when the closure is absent the farm cannot
 * exist and the real-runtime suites skip loud instead (their own guards).
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const panel = fileURLToPath(new URL('.', import.meta.url));
const farm = join(panel, '../../runtime/dsh/node_modules/@deepseek-ai');
const setup = () => {
  const farm = join(panel, '../../runtime/dsh/node_modules/@deepseek-ai');
  try {
    execSync('node spine/provision-modules.mjs', { cwd: panel, stdio: 'pipe' });
    console.log('provision-farm: the runtime bare-map farm is ready');
  } catch (e) {
    const vendored = existsSync(join(panel, '../../runtime/dsh/vendor/dsh/settings@0.1.6-alpha.2'));
    console.warn(
      `provision-farm: the farm could not be provisioned (${String(e.message).slice(0, 160)}) — ` +
      (vendored
        ? 'the vendored closure IS present; check spine/provision-modules.mjs'
        : 'the vendored closure is not materialized — run external/ensure-dsh.sh; ' +
          'the real-runtime panel suites will skip loud (their own guards)'),
    );
  }
};

export default setup;
setup();
