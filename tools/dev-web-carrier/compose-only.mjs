// dsh:logging-exempt (node-side driver: console IS the product)
/** compose-only.mjs — composeBootWire in a FRESH process: the page boot wire
 * (facade, graph, preloads) composed in a clean Node context, printed as one
 * JSON array of serialized rows for the real seat to inject. Out-of-process
 * keeps the compose-only loader shape away from the live runtime (the
 * loader's internal-resolver guard refuses a second compose in-process). */
import { resolve as pathResolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const here = pathResolve(fileURLToPath(import.meta.url), '..');
const repoRoot = pathResolve(here, '..', '..');
const { composeBootWire, serializeRows } = await import(
  pathToFileURL(join(here, 'compose-boot.mjs')).href);
function join(a, b) { return a + '/' + b; }
const boot = await composeBootWire({ repoRoot, stageDir: join(repoRoot, 'tmp/dev-web-carrier') });
process.stdout.write(JSON.stringify({ rows: serializeRows(boot.rows), plugins: boot.plugins }));
