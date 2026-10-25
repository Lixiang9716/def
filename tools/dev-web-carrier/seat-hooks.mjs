// dsh:logging-exempt (node-side loader bridge: specifier mapping, no logging surface)
/**
 * seat-hooks.mjs — the REAL SEAT's loader mapping for the presets service:
 * `@deepseek-ai/dsh-agent-presets` resolves to the WORKSPACE copy of the
 * vendored package (tmp/hero-seat/workspace/vendor/dsh/…), so the service's
 * SHIPPED_PRESET_ROOT lands inside the workspace and the fs shim's ws seam
 * serves its presets walk with real files. Registered BEFORE the panel's
 * dsh-loader-hooks (this hook short-circuits only its one specifier; every
 * other specifier delegates down the chain untouched).
 */
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const WS_ROOT = join(REPO_ROOT, 'tmp/hero-seat/workspace');
const PRESETS_LIB = pathToFileURL(
  join(WS_ROOT, 'vendor/dsh/agent-presets@0.1.6-alpha.2/lib/index.js'),
).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@deepseek-ai/dsh-agent-presets') {
    return { url: PRESETS_LIB, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
