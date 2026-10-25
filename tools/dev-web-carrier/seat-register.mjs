import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const panel = join(here, '..', '..', 'test', 'panel', 'spine', 'dsh-loader-hooks.mjs');
const seat = join(here, 'seat-hooks.mjs');
// The seat mapping registers LAST so it runs FIRST (Node order).
register(pathToFileURL(panel).href, pathToFileURL(panel));
register(pathToFileURL(seat).href, pathToFileURL(seat));
