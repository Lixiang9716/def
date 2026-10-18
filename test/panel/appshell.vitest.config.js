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
  // The plugin entry (index.js) imports the runtime's bare specifiers —
  // 'logger.js' and the vendored '@deepseek-ai/dsh-tools' (defineTool, the
  // ToolRuntime registration contract). The dsh loader's module map resolves
  // both on-device; under Node the aliases point at the same canonical bytes
  // the map serves (references, not copies).
  resolve: {
    alias: {
      'logger.js': fileURLToPath(new URL('../../runtime/dsh/logger.js', import.meta.url)),
      '@deepseek-ai/dsh-tools': fileURLToPath(
        new URL('../../runtime/dsh/vendor/dsh/tools@0.1.6-alpha.2/lib/index.js', import.meta.url),
      ),
    },
  },
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
