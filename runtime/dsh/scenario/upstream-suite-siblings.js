// dsh:logging-exempt (scenario driver; no logging surface beyond the log face)
/** scenario/upstream-suite-siblings.js — the real-disk sibling staging,
 * split from upstream-suite-leg.js when the file crossed the line budget
 * (2026-10-22). REAL_SIBLING_FILES + stageRealSiblingFiles: see the
 * commentary at each. */
export 
const REAL_SIBLING_FILES = [
  // lsp-stdio's scriptable fake LSP server (connection/lifecycle spawn it;
  // its header: "Run: node fixture-server.ts (Node's erasable TypeScript
  // syntax support)")
  ['packages/lsp/lsp-stdio/tests/fixture-server.ts', 'fixture-server.ts'],
  // the win32-dialog driver spawns the worker and expects the native-less
  // failure to reject through it ("rejects through the real worker where
  // the Win32 surface is unavailable")
  ['packages/host/directory-picker-native/src/win32-dialog-worker.ts', 'win32-dialog-worker.ts'],
  // the sdk-client fake runtime server (spawned as `execPath fake-runtime.ts`)
  ['packages/sdk/client/tests/fake-runtime.ts', 'fake-runtime.ts'],
  // the acp bridge's stdio MCP server — the transpiled spec joins
  // ../../../mcp/mcp-client/tests/fixture-server.ts at the bundle root, and
  // the mounted session's MCP mount spawns it through cross-spawn (the
  // acp bridge row, 2026-10-22)
  // (destination walks out of upstream-tests/: the bridge spec's URL math
  // joins ../../../mcp/... at the BUNDLE root, so the remap looks under
  // runtime/dsh/mcp/... — not under upstream-tests/)
  ['packages/mcp/mcp-client/tests/fixture-server.ts', '../mcp/mcp-client/tests/fixture-server.ts'],
  // skill-office's checkers spec spawns `python3 check_office_test.py` — the
  // script is a REAL sibling of the vendored spec (#238, 2026-09-28)
  ['packages/skill/skill-office/tests/check_office_test.py', 'check_office_test.py'],
];
import { createLogger } from 'logger.js';
const log = createLogger('scenario.upstream-suite-siblings');

export const VENDOR_TESTS_TAG = 'dsh-v0.1.6-alpha.2'; // the ensure-dsh-tests.sh pin
export const stageRealSiblingFiles = async () => {
  log.debug('real sibling staging begin', {});
  // Real children read the REAL disk, so the copies must be real too — and
  // the runtime's own fs face is the in-memory workspace VFS. The one real
  // disk actor this seam owns is a CHILD PROCESS: /bin/cp runs in the CLI's
  // real working directory (the checkout root, where vendor/ and
  // upstream-tests/ live) — no cwd option on purpose (options.cwd would pin
  // the virtual profile container, which is NOT on the real disk).
  const { spawnSync } = await import('node:child_process');
  for (const [from, to] of REAL_SIBLING_FILES) {
    const vendorPath = `vendor/dsh-tests@${VENDOR_TESTS_TAG}/${from}`;
    if (to.includes('/')) {
      // cp -R needs the destination dir (no implicit mkdir in /bin/cp).
      spawnSync('/bin/mkdir', ['-p', `upstream-tests/${to.slice(0, to.lastIndexOf('/'))}`]);
    }
    const res = spawnSync('/bin/cp', [vendorPath, `upstream-tests/${to}`]);
    if (res.status !== 0) {
      log.debug('sibling stage failed', { from, to, code: res.error?.code ?? res.stderr?.slice?.(0, 80) });
    }
  }
};

