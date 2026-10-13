#!/usr/bin/env node
/* check-asset-mirrors.mjs — the product-tree ↔ host-mirror comparator.
 *
 * The #286-class drift: a product-tree file (presentation/web-client-v2/
 * web/js/timeline.js, #279) moves while the host mirrors that ship its bytes
 * (android assets, harmony rawfile, the iOS embed) stay at the old version —
 * silent on a dev disk, stale on every fresh install, and (measured
 * 2026-10-01) invisible to the android stager's own --check because its
 * webclient loop's find(1) `./` prefix made is_tracked match nothing — the
 * whole tree verified as counted SKIPs. This tool is the cross-host face of
 * that comparison: ONE named surface that walks every product tree in the
 * mirror family and byte-compares each host mirror in BOTH directions
 * (mirror file stale/missing vs product, and mirror-only files — dead bytes
 * a sync would never refresh), plus the iOS embedder's tree declaration vs
 * the family (the D9 flip made generated freshness the iOS claim; the
 * declaration is what decides WHICH trees the embedder even carries).
 *
 * The mirror family is a declared table, not a glob: v0, v2 and compact
 * (the trees the stagers whole-copy — stage-spine-closure.sh's
 * `for client in v2 compact`, vendor-official.sh's WEBCLIENT_DIRS, the v0
 * hand-committed webclient mirrors) plus mini, which ships with NO mirrors
 * at all (iOS reads its three files straight from the product tree through
 * the RESOURCES table — nothing byte-mirrored exists to compare, so mini is
 * managed through that declaration instead). The same family lives as the
 * webclient*.rows store files of gen-staging-emit-web.mjs, which adds the
 * store↔product direction; this tool stays the cross-host byte face and is
 * BLOCKING in the DAG. A new web-client-* tree outside the family is
 * reported as an informational `outside-family` row — whether it must
 * mirror is a human call, not a glob's — while a FAMILY member whose
 * product dir is absent fails loud (rule 5).
 *
 * usage:
 *   node tools/check-asset-mirrors.mjs           # human report; exit 1 on drift
 *   node tools/check-asset-mirrors.mjs --json    # structured findings for the gate
 *
 * exit 0 = every family mirror byte-identical both ways + declarations aligned;
 * exit 1 = any finding (drift, missing/extra mirror file, declaration gap).
 * Gate wiring: `asset-mirrors` (BLOCKING since the webclient manifest legs
 * made the family store-declared — a finding here fails the DAG). The
 * closures gate's per-host --check remains the second net on the same
 * mirrors. Rejection case: .gov/rejections/case-asset-mirrors.sh.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const fail = (msg) => {
  console.error(`check-asset-mirrors: ${msg}`);
  process.exit(2);
};

// The family, in the stagers' own words (suffix, product dir, per-host
// mirror dir or null, and whether iOS embeds it as a WEBCLIENT_TREES row or
// straight from the product tree via RESOURCES). Adding a member = adding
// it to the stagers AND the webclient*.rows store family, then a row here.
const FAMILY = [
  { name: 'v0', dir: 'web-client', android: 'webclient', harmony: 'dsh-web-client', iosTrees: false },
  { name: 'v2', dir: 'web-client-v2', android: 'webclient-v2', harmony: 'dsh-web-client-v2', iosTrees: true },
  { name: 'compact', dir: 'web-client-compact', android: 'webclient-compact', harmony: 'dsh-web-client-compact', iosTrees: true },
  { name: 'mini', dir: 'web-client-mini', android: null, harmony: null, iosTrees: false },
];
const PRODUCT_DIR = (m) => join(ROOT, 'presentation', m.dir);
// (label, member mirror path) — the committed copies the platform builds consume.
const MIRRORS = (m) => [
  ['android', m.android && join(ROOT, 'hosts', 'android', 'app', 'src', 'main', 'assets', 'dsh', m.android)],
  ['harmony', m.harmony && join(ROOT, 'hosts', 'harmony', 'entry', 'src', 'main', 'resources', 'rawfile', 'dsh', 'webclient', m.harmony)],
].filter(([_, p]) => p);
const IOS_EMBEDDER = join(ROOT, 'hosts', 'ios', 'Tools', 'gen_bundle_header.py');
const IOS_RESOURCES = join(ROOT, 'hosts', 'ios', 'Tools', 'gen_bundle_resources.py');

const walk = (dir) => {
  const out = [];
  const visit = (cur) => {
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      const p = join(cur, e.name);
      if (e.isDirectory()) visit(p);
      else if (e.isFile()) out.push(relative(dir, p).split('\\').join('/'));
    }
  };
  visit(dir);
  return out.sort();
};

const bytes = (p) => readFileSync(p);
const sameBytes = (a, b) => bytes(a).equals(bytes(b));
const srcFilesSet = (dir) => new Set(walk(dir));

const findings = [];
const outsideFamily = [];
const hosts = [];

for (const member of FAMILY) {
  const name = member.name;
  const src = PRODUCT_DIR(member);
  if (!statSync(src, { throwIfNoEntry: false })?.isDirectory?.()) {
    findings.push({ host: '*', tree: `web-client-${member.dir}`, kind: 'family-dir-absent', file: `presentation/${member.dir}` });
    continue;
  }
  const srcFiles = walk(src);
  const perHost = { tree: member.dir, mirrors: [] };
  for (const [host, mirrorPath] of MIRRORS(member)) {
    const row = { host, files: srcFiles.length, stale: [], missing: [], extra: [] };
    if (!statSync(mirrorPath, { throwIfNoEntry: false })?.isDirectory?.()) {
      findings.push({ host, tree: `web-client-${name}`, kind: 'mirror-dir-absent', file: relative(ROOT, mirrorPath) });
      row.missing.push('<mirror dir>');
    } else {
      const dstFiles = new Set(walk(mirrorPath));
      for (const rel of srcFiles) {
        if (!dstFiles.has(rel)) {
          row.missing.push(rel);
          findings.push({ host, tree: `web-client-${name}`, kind: 'mirror-file-missing', file: rel });
        } else if (!sameBytes(join(src, rel), join(mirrorPath, rel))) {
          row.stale.push(rel);
          findings.push({ host, tree: `web-client-${name}`, kind: 'mirror-stale', file: rel });
        }
      }
      for (const rel of dstFiles) {
        if (!srcFiles.includes(rel)) {
          row.extra.push(rel);
          findings.push({ host, tree: `web-client-${name}`, kind: 'mirror-file-extra', file: rel });
        }
      }
    }
    perHost.mirrors.push(row);
  }
  hosts.push(perHost);
}

// presentation/ trees outside the family — informational, never a verdict.
const presDir = join(ROOT, 'presentation');
for (const e of readdirSync(presDir, { withFileTypes: true })) {
  if (e.isDirectory() && e.name.startsWith('web-client') &&
      !FAMILY.some((m) => m.dir === e.name)) {
    outsideFamily.push(e.name);
  }
}

// The iOS embedder's declaration must name exactly the family: a member it
// omits ships no iOS bytes; a row it names beyond the family embeds a tree
// the stagers don't maintain.
const embedderSrc = readFileSync(IOS_EMBEDDER, 'utf8');
const declRows = [...embedderSrc.matchAll(/\("webclient-([a-z0-9-]+)",\s*REPO\s*\/\s*"presentation"\s*\/\s*"web-client-([a-z0-9-]+)"/g)]
  .map((m) => m[1]);
const treesMembers = FAMILY.filter((m) => m.iosTrees).map((m) => m.name);
for (const name of treesMembers) {
  if (!declRows.includes(name)) {
    findings.push({ host: 'ios', tree: `web-client-${name}`, kind: 'embedder-declaration-missing', file: 'WEBCLIENT_TREES' });
  }
}
for (const row of declRows) {
  if (!treesMembers.includes(row)) {
    findings.push({ host: 'ios', tree: `webclient-${row}`, kind: 'embedder-declaration-extra', file: 'WEBCLIENT_TREES' });
  }
}
// The resource-embedded members (v0, mini) ride the RESOURCES table — the
// embedder reads the product tree directly, so the declaration must cover
// exactly each member's file set (name-for-name; bytes cannot drift).
const resSrc = readFileSync(IOS_RESOURCES, 'utf8');
const RESOURCES_ROW = /"presentation"\s*\/\s*"(web-client(?:-[a-z0-9-]+)?)"((?:\s*\/\s*"[^"]+")+)/g;
const PY_STR = /"([^"]*)"/g;
const resCovered = {};
for (const m of resSrc.matchAll(RESOURCES_ROW)) {
  const rel = [...m[2].matchAll(PY_STR)].map((x) => x[1]).join('/');
  (resCovered[m[1]] ??= []).push(rel);
}
for (const member of FAMILY.filter((m) => !m.iosTrees)) {
  const got = new Set(resCovered[member.dir] ?? []);
  for (const rel of walk(PRODUCT_DIR(member))) {
    if (!got.has(rel)) {
      findings.push({ host: 'ios', tree: member.dir, kind: 'resources-declaration-missing', file: rel });
    }
  }
  for (const rel of resCovered[member.dir] ?? []) {
    if (!srcFilesSet(PRODUCT_DIR(member)).has(rel)) {
      findings.push({ host: 'ios', tree: member.dir, kind: 'resources-declaration-extra', file: rel });
    }
  }
}

const json = process.argv.includes('--json');
if (json) {
  console.log(JSON.stringify({ ok: findings.length === 0, family: FAMILY, hosts, findings, outsideFamily }, null, 2));
} else {
  for (const h of hosts) {
    for (const m of h.mirrors) {
      console.log(`check-asset-mirrors: ${h.tree} → ${m.host}: ${m.files} files · stale ${m.stale.length} · missing ${m.missing.length} · extra ${m.extra.length}`);
    }
  }
  for (const f of findings) {
    console.log(`::error::check-asset-mirrors: ${f.kind}: ${f.tree}/${f.file} (${f.host})`);
  }
  if (outsideFamily.length) {
    console.log(`check-asset-mirrors: outside the mirror family (informational): ${outsideFamily.join(', ')}`);
  }
  console.log(findings.length === 0
    ? 'check-asset-mirrors: every family mirror byte-identical both ways; embedder declaration aligned'
    : `check-asset-mirrors: ${findings.length} finding(s) — re-stage with build/build.sh sync <platform>`);
}
process.exit(findings.length === 0 ? 0 : 1);
