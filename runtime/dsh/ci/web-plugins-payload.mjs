// dsh:logging-exempt (node-side driver: console IS the product)
/**
 * web-plugins-payload.mjs — build the `web.plugins` bus delivery for the
 * web-boot CLI drive (the OFFICIAL web boot producer).
 *
 * Two shapes:
 *   1. FULL ROSTER (default): the staged application-tier tree
 *      (presentation/official-web/client-bundles/npm, the `dsh.client`
 *      roster verified against the committed MANIFEST.sha256) plus the
 *      pinned vendored bootstrap package
 *      (runtime/dsh/vendor/npm/@deepseek-ai/dsh-client-modules — the same
 *      bundle bytes, sha256-pinned tarball, D6 pin record). This is what a
 *      platform embedder stages: the whole scan-scope file view delivered
 *      over the bus seam.
 *   2. BOOTSTRAP-ONLY (`--bootstrap-only`): the pre-W-SHELL shape (the
 *      vendored client-modules package alone — a bootstrap-phase graph).
 *      Kept as the documented fallback and for narrow debugging.
 *
 * The payload is exactly the scan-scope file view (package manifests + the
 * client bundles), base64-encoded, with a FIXED mtimeMs — mobile staging has
 * no wall-clock meaning, and a fixed generation stamp makes the composed
 * graph revs reproducible across runs and devices (the initial revs are the
 * upstream nonce placeholders regardless; the stamp pins the HMR baseline
 * input). Plugins are listed in staged-DIRECTORY order (`<name>@<version>`
 * sorted — the same key the platform drives use when they enumerate the
 * staging tree): the registry's scan order (= loader entry order) is the
 * module-graph tie-break, so the composed `__DSH_BOOT__` entry order is
 * deterministic and IDENTICAL across the CLI proof and the devices.
 *
 * usage: node web-plugins-payload.mjs <out.json> [--bootstrap-only]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDOR_NPM = join(HERE, '..', 'vendor', 'npm');
const BOOTSTRAP_NAME = '@deepseek-ai/dsh-client-modules';
const BOOTSTRAP_DIR = join(VENDOR_NPM, `${BOOTSTRAP_NAME}@0.1.6-alpha.2`);
const REPO_ROOT = join(HERE, '..', '..', '..');
const BUNDLES_DIR = join(REPO_ROOT, 'presentation', 'official-web', 'client-bundles');
const BUNDLES_NPM = join(BUNDLES_DIR, 'npm');
const BUNDLES_MANIFEST = join(BUNDLES_DIR, 'MANIFEST.sha256');
/** This environment's own build record for the staged tree (D15): the upstream
 *  client build embeds its absolute work path, so the committed reference
 *  record is satisfiable only where that path matches. See the verify block. */
const BUNDLES_COMPUTED = join(BUNDLES_DIR, 'MANIFEST.sha256.computed');
const BUNDLES_ROSTER = join(BUNDLES_DIR, 'ROSTER.json');
const VFS_ROOT = '/web-plugins';
const STAGED_MTIME_MS = 0;

const bootstrapOnly = process.argv.includes('--bootstrap-only');
const out = process.argv[2];
if (!out) {
  console.error('usage: node web-plugins-payload.mjs <out.json> [--bootstrap-only]');
  process.exit(2);
}

/** `shasum -a 256 --check`, in process: verify every `<64 hex> SP|* ./path`
 *  line of the record against the tree at BUNDLES_NPM. Same semantics as the
 *  external tool's check mode — recorded files must exist and digest-match,
 *  unrecorded extras are not this check's business — plus the rule-5
 *  loudness: an unparsable record line names the record, failures name the
 *  files. In-process on purpose: an external `shasum` resolves through the
 *  inherited PATH, and a stripped environment died right here with
 *  `spawnSync shasum ENOENT` (T-0218). */
const verifyManifestRecord = (record) => {
  const bad = [];
  let checked = 0;
  for (const raw of readFileSync(record, 'utf8').split('\n')) {
    // A core.autocrlf checkout hands the record over with CRLF endings; the
    // digests are the payload, the terminator is not (same strip as
    // verify-manifest.mjs).
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '') continue;
    const m = /^([0-9a-f]{64}) [ *]\.\/(.+)$/.exec(line);
    if (!m) throw new Error(`web-plugins-payload: unparsable record line in ${record}: ${line.slice(0, 60)}`);
    checked++;
    let digest = '';
    try {
      digest = createHash('sha256').update(readFileSync(join(BUNDLES_NPM, m[2]))).digest('hex');
    } catch { /* a missing or unreadable file is the named failure below */ }
    if (digest !== m[1]) bad.push(m[2]);
  }
  if (bad.length > 0) {
    throw new Error(`web-plugins-payload: ${bad.length}/${checked} recorded files fail ${record} verification: `
      + (bad.length <= 8 ? bad.join(', ') : `${bad.slice(0, 8).join(', ')} … (+${bad.length - 8} more)`));
  }
};

/** One delivery plugin row: the scan-scoped file view, base64. */
const pluginRow = (name, dir, files) => {
  const vfsDir = `${VFS_ROOT}/npm/${name}@0.1.6-alpha.2`;
  const entry = {
    loaderName: name,
    pkgJsonPath: `${vfsDir}/package.json`,
    entryPath: `${vfsDir}/lib/client.js`,
    files: {},
  };
  for (const rel of files) {
    entry.files[`${vfsDir}/${rel}`] = {
      b64: readFileSync(join(dir, rel)).toString('base64'),
      mtimeMs: STAGED_MTIME_MS,
    };
  }
  return entry;
};

/** The pinned vendored bootstrap package (package.json + lib/client.js). */
const bootstrapRow = () => pluginRow(BOOTSTRAP_NAME, BOOTSTRAP_DIR, ['package.json', 'lib/client.js']);

let plugins;
if (bootstrapOnly) {
  plugins = [bootstrapRow()];
} else {
  // Verify the staged application-tier tree against the record that travels
  // with it — the one THIS environment's build wrote (or a cache carried
  // here) — then read the roster record. The committed MANIFEST.sha256 is the
  // REFERENCE build's record: `test/e2e/ensure-client-bundles.sh` (which the
  // web-boot legs run before staging) materializes the tree, verifies it, and
  // bounds the reference divergence the embedded work path causes. Fail loud
  // on drift (rules 5/6).
  if (!existsSync(BUNDLES_NPM)) {
    throw new Error(`web-plugins-payload: staged application-tier tree missing (${BUNDLES_NPM}) — `
      + 'run test/e2e/ensure-client-bundles.sh first');
  }
  const record = existsSync(BUNDLES_COMPUTED) ? BUNDLES_COMPUTED : BUNDLES_MANIFEST;
  verifyManifestRecord(record);
  const roster = JSON.parse(readFileSync(BUNDLES_ROSTER, 'utf8'));
  plugins = [];
  for (const entry of [...roster.entries].sort((a, b) => (
    `${a.name}@${a.version}` < `${b.name}@${b.version}` ? -1 : 1))) {
    if (entry.bootstrap) {
      // The pinned vendored tarball row owns the bootstrap package (its
      // lib/client.js is byte-identical to the workspace build; PROVENANCE).
      plugins.push(bootstrapRow());
      continue;
    }
    const dir = join(BUNDLES_NPM, `${entry.name}@${entry.version}`);
    if (!existsSync(dir)) throw new Error(`web-plugins-payload: staged tree missing ${entry.name}`);
    plugins.push(pluginRow(entry.name, dir, entry.files));
  }
}

const payload = { type: 'web.plugins', plugins };

writeFileSync(out, JSON.stringify(payload));
const files = plugins.reduce((n, p) => n + Object.keys(p.files).length, 0);
console.error(`web-plugins-payload: ${plugins.length} plugins, ${files} files, `
  + `${JSON.stringify(payload).length} bytes -> ${out}`);
