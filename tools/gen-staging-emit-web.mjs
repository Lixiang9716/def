// dsh:logging-exempt satellite of gen-staging-emit.mjs (dev script: console
// IS the product, like check-staging.mjs)
/**
 * gen-staging-emit-web.mjs — the webclient manifest legs of the staging
 * manifest consolidation. Every staged self-hosted web client declares its
 * SHIPPED-FILE list as one store rows file (client-relative paths,
 * CANONICAL SORTED, `#` prose):
 *
 *   webclient.rows         presentation/web-client          (v0)
 *   webclient-v2.rows      presentation/web-client-v2
 *   webclient-compact.rows presentation/web-client-compact
 *   webclient-mini.rows    presentation/web-client-mini
 *
 * The stagers keep whole-tree copies (constructive: a file rides by
 * existing); the store is the REVIEWED declaration of what may exist —
 * the hard-coded shipped-file count this replaces (the retired
 * check-webclient-staged-tree.sh count-16) could only notice a total,
 * never WHICH file leaked or went stale.
 *
 * check(dir) — per client, both directions everywhere:
 *   store ↔ product tree   a store row with no file is stale; a product
 *                          file with no store row is an undeclared leak
 *                          (the whole-tree-staged directory admits none);
 *   store ↔ android mirror (assets/dsh/webclient-*) and ↔ harmony mirror
 *                          (rawfile/dsh/webclient/dsh-web-client-*) —
 *                          byte-exact both ways: stale, missing, and
 *                          mirror-only dead bytes a sync never refreshes;
 *   store ↔ iOS declaration — the embedder's WEBCLIENT_TREES rows name
 *                          exactly the mirror members it embeds, and
 *                          gen_bundle_resources.py's RESOURCES rows cover
 *                          exactly every file of the resource-embedded
 *                          clients (v0, mini: iOS reads the product tree
 *                          directly — no mirror exists to drift).
 * emit(dir) — harvest a client's rows file when ABSENT (one-time walk);
 *   an existing rows file is hand-owned and never rewritten: a product
 *   change is a reviewed row edit in the same commit as the bytes.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './check-staging-graph.mjs';
import { walkDiskDir } from './gen-staging-legs.mjs';

const fail = (msg) => { throw new Error(`gen-staging-emit: ${msg}`); };

// The family, disk-authoritative: per client — the store file, the product
// dir, the committed mirrors (null = no mirror at that host), and the iOS
// face (trees: the WEBCLIENT_TREES bundle name; resources: the client's
// files ride the RESOURCES table).
const ANDROID_BASE = join(REPO, 'hosts/android/app/src/main/assets/dsh');
const HARMONY_BASE = join(REPO, 'hosts/harmony/entry/src/main/resources/rawfile/dsh/webclient');
const IOS_HEADER = 'hosts/ios/Tools/gen_bundle_header.py';
const IOS_RESOURCES = 'hosts/ios/Tools/gen_bundle_resources.py';
const WEBCLIENTS = [
  { rows: 'webclient.rows', dir: 'presentation/web-client',
    android: 'webclient', harmony: 'dsh-web-client', ios: { resources: true } },
  { rows: 'webclient-v2.rows', dir: 'presentation/web-client-v2',
    android: 'webclient-v2', harmony: 'dsh-web-client-v2', ios: { trees: 'v2' } },
  { rows: 'webclient-compact.rows', dir: 'presentation/web-client-compact',
    android: 'webclient-compact', harmony: 'dsh-web-client-compact', ios: { trees: 'compact' } },
  { rows: 'webclient-mini.rows', dir: 'presentation/web-client-mini',
    android: null, harmony: null, ios: { resources: true } },
];

/** Client-relative sorted file list of one product tree. */
const productFiles = (client) =>
  walkDiskDir(join(REPO, client.dir)).map((f) => f.slice(join(REPO, client.dir).length + 1));

/** Declared rows of a store file (comments and blanks dropped); null when
 * the file is absent (the caller decides whether absence is a harvest). */
function declaredRows(dir, name) {
  const p = join(dir, name);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8').split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/** Mirror-side byte comparison of one client, both directions. */
function mirrorFindings(client, label, base, files, rows) {
  const out = [];
  const mirror = join(base, client[label]);
  if (!existsSync(mirror)) {
    out.push(`${client.rows}: the ${label} mirror dir is absent: ${mirror}`);
    return out;
  }
  const mirrorFiles = new Set(walkDiskDir(mirror).map((f) => f.slice(mirror.length + 1)));
  for (const rel of files) {
    if (!mirrorFiles.has(rel)) {
      out.push(`${client.rows}: the ${label} mirror lacks ${rel} (${client.dir})`);
    } else if (!readFileSync(join(mirror, rel)).equals(readFileSync(join(REPO, client.dir, rel)))) {
      out.push(`${client.rows}: the ${label} mirror is stale for ${rel} (${client.dir})`);
    }
  }
  for (const rel of mirrorFiles) {
    if (!rows.includes(rel)) {
      out.push(`${client.rows}: the ${label} mirror carries dead bytes: ${rel} (${client.dir})`);
    }
  }
  return out;
}

/** Quote-bearing patterns ride new RegExp from plain strings (govrail#411 —
 * see check-staging-graph.mjs). */
const TREES_ROW = new RegExp('\\("webclient-([a-z0-9-]+)",\\s*REPO', 'g');
const RESOURCES_ROW = new RegExp('"presentation"\\s*/\\s*"web-client(-[a-z0-9-]+)?"((?:\\s*/\\s*"[^"]+")+)', 'g');
const PY_STR = new RegExp('"([^"]*)"', 'g');

/** The iOS half: WEBCLIENT_TREES names exactly the trees-embedded members;
 * RESOURCES covers exactly every file of the resource-embedded ones. */
function iosFindings(clients) {
  const out = [];
  const headerSrc = readFileSync(join(REPO, IOS_HEADER), 'utf8');
  const treeRows = [...headerSrc.matchAll(TREES_ROW)].map((m) => m[1]);
  const wantTrees = clients.filter((c) => c.ios.trees).map((c) => c.ios.trees);
  for (const want of wantTrees) {
    if (!treeRows.includes(want)) out.push(`WEBCLIENT_TREES lacks the webclient-${want} embed row`);
  }
  for (const row of treeRows) {
    if (!wantTrees.includes(row)) out.push(`WEBCLIENT_TREES names webclient-${row} outside the store family`);
  }
  const resSrc = readFileSync(join(REPO, IOS_RESOURCES), 'utf8');
  const resPaths = [...resSrc.matchAll(RESOURCES_ROW)]
    .map((m) => ({ suffix: m[1] ?? '', rel: [...m[2].matchAll(PY_STR)].map((x) => x[1]).join('/') }));
  for (const client of clients.filter((c) => c.ios.resources)) {
    const suffix = client.dir === 'presentation/web-client'
      ? '' : client.dir.slice('presentation/web-client'.length);
    const covered = resPaths.filter((r) => r.suffix === suffix).map((r) => r.rel);
    for (const rel of productFiles(client)) {
      if (!covered.includes(rel)) {
        out.push(`the iOS RESOURCES table lacks ${client.dir}/${rel} (${client.rows} family)`);
      }
    }
    for (const rel of covered) {
      if (!existsSync(join(REPO, client.dir, rel))) {
        out.push(`the iOS RESOURCES table names a missing file: ${client.dir}/${rel}`);
      }
    }
  }
  return out;
}

/** --check half: store ↔ product ↔ mirrors ↔ iOS declaration, both ways. */
export function webCheck(dir) {
  const drift = [];
  for (const client of WEBCLIENTS) {
    const rows = declaredRows(dir, client.rows);
    if (!rows) {
      drift.push(`${client.rows} is missing — run --emit to harvest it from ${client.dir}`);
      continue;
    }
    const files = productFiles(client);
    for (const row of rows) {
      if (!files.includes(row)) drift.push(`${client.rows} row is stale (no such file): ${row}`);
    }
    for (const rel of files) {
      if (!rows.includes(rel)) {
        drift.push(`${client.rows} does not declare a product file (leak or new): ${rel}`);
      }
    }
    if (client.android) drift.push(...mirrorFindings(client, 'android', ANDROID_BASE, files, rows));
    if (client.harmony) drift.push(...mirrorFindings(client, 'harmony', HARMONY_BASE, files, rows));
  }
  drift.push(...iosFindings(WEBCLIENTS));
  return { drift };
}

/** --emit half: harvest the declared shipped-file lists when absent. An
 * existing rows file is hand-owned (a product change is a reviewed row
 * edit); the mirrors and host sources are never written by this tool. */
export function webEmit(dir) {
  const did = [];
  for (const client of WEBCLIENTS) {
    const p = join(dir, client.rows);
    if (existsSync(p)) continue;
    writeFileSync(p, `${productFiles(client).join('\n')}\n`);
    did.push(`${client.rows} harvested (${productFiles(client).length} files)`);
  }
  return did;
}

// Standalone CLI face for the runners that assert ONLY this family (the
// presentation tests' before/after product-tree check — running the full
// gen-staging-emit there would drag in the vendored-pin legs): the same
// exit contract as the consolidation gate (0 = green, 1 = drift).
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const dir = process.argv[3] ?? 'tools/generated/staging';
  const { drift } = webCheck(dir);
  if (drift.length) {
    console.error('gen-staging-emit-web: the webclient family drifted — a product change'
      + ' is a reviewed webclient*.rows row edit in the same commit as the bytes:');
    for (const d of drift) console.error(`  DRIFT ${d}`);
    process.exitCode = 1;
  } else {
    console.log(`gen-staging-emit-web: the webclient family matches its store declarations in ${dir}`);
  }
}
