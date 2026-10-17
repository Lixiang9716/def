import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Standalone config for the app-shell (dsh-appshell) test family only.
// Root is pinned to the WORKTREE root (not test/panel) so coverage.include
// can address the component contract at system-plugins/dsh-appshell/lib/**
// with in-repo relative paths. Run:
//   node node_modules/vitest/vitest.mjs run -c test/panel/appshell.vitest.config.js [--coverage]
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: ROOT,
  test: {
    include: ['test/panel/appshell-*.test.js'],
    environment: 'node',
  },
  coverage: {
    provider: 'v8',
    include: ['system-plugins/dsh-appshell/lib/**'],
    reporter: ['text'],
  },
});
