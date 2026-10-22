// dsh:logging-exempt (diagnostic: stdout is the seed line)
/** seed-fixtures.mjs — the NODE leg's fixture seeding. The qjs leg's driver
 * seeds each spec's `.fixtures.js` module into a one-runtime-per-spec staged
 * fs ("one spec per runtime, so the flat namespace never collides"); the
 * Node leg reproduces that isolation with a PER-PROCESS seed root: the
 * caller creates `<root>` (unique per smoke process), chdirs into
 * `<root>/runtime/dsh`, and this module writes the fixture bytes at their
 * VFS paths under it — VFS '/X' maps to `<root>/runtime/dsh/X`, the same
 * root the resolve hook's '/x' branch uses for bundle-root specifiers. The
 * caller removes the whole per-process root after the run, so concurrent
 * smoke processes never see each other's fixtures and nothing leaks into
 * the next spec. A spec without a fixtures module is a silent no-op (the
 * qjs leg's same contract); a write failure fails loud (rule 5). Returns
 * the number of files seeded. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const seedSpecFixtures = async (specPath, workRuntimeDsh) => {
  let fx;
  try {
    fx = await import(pathToFileURL(specPath.replace(/\.spec\.mjs$/, '.fixtures.js')).href);
  } catch {
    return 0;
  }
  if (!fx || !Array.isArray(fx.fixtures) || fx.fixtures.length === 0) return 0;
  for (const f of fx.fixtures) {
    const out = join(workRuntimeDsh, f.path.startsWith('/') ? f.path.slice(1) : f.path);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(f.b64, 'base64'));
  }
  return fx.fixtures.length;
};
