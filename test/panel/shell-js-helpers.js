// The shared harness for the shell-js panel suites (the file split kept
// each suite under the code-size budgets; the helpers are common, the
// assertions live in the suites).
import { apply, shellExecutor } from '../../runtime/dsh/system-plugins/dsh-shell-js/index.js';
import { session } from '../../runtime/dsh/system-plugins/dsh-shell-js/applets.js';
import { workspace } from './gateway-shim.js';

/** The pinned profile container the executor maps the workspace through
 * (boot.js's pinProfileContainer globals) — the same seeding the
 * shell-wasm suite does; the workspace sits INSIDE the scope root, so a
 * workspace-relative file is `dsh/<name>`. */
export const seedGlobals = () => {
  globalThis.__dshProfileCwd = '/profiles/default/dsh';
  globalThis.__dshProfileScopeRoot = '/profiles/default';
};

/** One activation through the plugin's own apply. Registration is fully
 * synchronous here (the wasm sibling's starter writes need the two-flush
 * drain; this plugin has no activation writes), so the collected tools
 * are ready on return. */
export const activate = () => {
  const registered = [];
  apply({ tools: { register: (tool) => registered.push(tool) } });
  return registered;
};

export const encoder = new TextEncoder();
export const decoder = new TextDecoder();

/** Seed the in-memory workspace (scope 'app', workspace prefix 'dsh'). */
export const putFile = (path, text) => workspace.set(`app/dsh/${path}`, encoder.encode(text));
export const putDir = (path) => workspace.set(`app/dsh/${path}`, { dir: true });
export const putBytes = (path, bytes) => workspace.set(`app/dsh/${path}`, bytes);
export const dumpFile = (path) => decoder.decode(workspace.get(`app/dsh/${path}`));
export const exists = (path) => workspace.has(`app/dsh/${path}`);

export const run = (command) => shellExecutor.run({ command });

/** The per-test reset: a clean workspace and a clean shell session (the
 * session is module state — one shell per plugin instance — so `cd`/
 * assignment tests cannot leak into each other). */
export const resetShell = () => {
  workspace.clear();
  seedGlobals();
  session.cwd = '';
  session.vars = {};
  session.oldpwd = null;
};
