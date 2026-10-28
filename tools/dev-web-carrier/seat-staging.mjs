// dsh:logging-exempt (node-side driver: console IS the product)
/**
 * seat-staging.mjs — the runtime-plugin staging (split from real-seat.mjs
 * at the code-size gate): walk each mobile-composition package from the
 * farm, key the VFS at /web-plugins/<loader><rel>, mirror the bytes for
 * the HTTP face, and push the delivery row.
 */
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const walkFiles = (dir, base, out) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = `${base}/${entry.name}`;
    if (entry.isDirectory()) walkFiles(full, rel, out);
    else {
      out[rel] = { b64: readFileSync(full).toString('base64'), mtimeMs: 0 };
    }
  }
};

/** The mobile composition's RUNTIME plugin rows (each names a vendored
 * package the loader must resolve — staged like the device web-plugins). */
const MOBILE_PRESET_PACKAGES = [
  'dsh-persona', 'dsh-agent-instructions', 'dsh-tool-fs', 'dsh-tool-jobs',
  'dsh-skill-filesystem', 'dsh-tool-skill', 'dsh-command-goal',
  'dsh-tool-goal', 'dsh-plan-mode', 'dsh-compaction-basic',
  'dsh-command-compact', 'dsh-compaction-tool-result-pruner',
  'dsh-tool-subagent-control', 'dsh-tool-subagent', 'dsh-tool-ask-user',
  'dsh-tool-todo', 'dsh-tool-present',
];

/** Stage one runtime plugin package into `plugins` (the delivery rows). */
const stageRuntimePlugin = (repoRoot, wsRoot, plugins, pkg) => {
  const real = join(repoRoot, 'runtime/dsh/node_modules/@deepseek-ai', pkg);
  if (!existsSync(join(real, 'package.json'))) {
    console.log(`[real-seat] plugin package missing on the farm: ${pkg}`);
    return;
  }
  const loaderName = `@deepseek-ai/${pkg}`;
  const diskDir = join(wsRoot, 'web-plugins', loaderName);
  mkdirSync(diskDir, { recursive: true });
  const keyed = {};
  walkFiles(real, '', keyed);
  const stagedFiles = {};
  for (const [rel, file] of Object.entries(keyed)) {
    const vfsPath = `/web-plugins/${loaderName}${rel}`;
    stagedFiles[vfsPath] = file;
    const dst = join(wsRoot, 'web-plugins', loaderName, rel);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, Buffer.from(file.b64, 'base64'));
  }
  plugins.push({
    loaderName,
    pkgJsonPath: join(real, 'package.json'),
    entryPath: `${wsRoot}/web-plugins/${loaderName}/lib/index.js`,
    files: stagedFiles,
  });
};

import { dirname } from 'node:path';

/** The mobile composition's runtime plugin packages, staged beside the
 * client bundles (the 19-row preset join names them). */
export const stageRuntimePlugins = (repoRoot, wsRoot, plugins) => {
  for (const pkg of MOBILE_PRESET_PACKAGES) {
    stageRuntimePlugin(repoRoot, wsRoot, plugins, pkg);
  }
};
