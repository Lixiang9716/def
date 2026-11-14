// dsh:logging-exempt satellite of check-staging.mjs (dev script: console IS the
// product, like check-staging-hosts.mjs)
/**
 * check-staging-stager.mjs — the BundleStager-exclude face of check-staging
 * (issue #798, the staging blind-spot guard).
 *
 * The staging gate read the EMBEDDER's declared lists (iOS:
 * gen_bundle_resources.py RESOURCES + gen_bundle_header.py TREES) but could
 * not see the BundleStager's own exclude policy
 * (tools/generated/staging/ios-stager.exclude.rows), so a file that is
 * (a) reached by the import graph, (b) embedded in the binary (a RESOURCES
 * row), but (c) excluded from the launch-time staging writes AND not covered
 * by any TREES whole-dir mirror passed every gate — and died on-device at
 * import-link. That exact class killed every iOS interactive boot after #780
 * mounted dsh-mcp from the def bundle while the stale pre-#780 exclude rows
 * stayed (#691; un-excluded ad hoc by PR #797).
 *
 * This module closes the CLASS at gate time: for every exclude row it
 * resolves the accessor suffix to its declared RESOURCES row (a suffix
 * nothing embeds is structural drift — fail loud, matching gen-staging-emit's
 * stagerTable), and reports a finding when the row's file is graph-reached
 * while no TREES mirror root covers its source path. Excluded-but-TREES-
 * covered rows (the scenario / web-live / upstream/shims / system-plugins
 * mirrors) and excluded-but-never-reached rows (dead embedded bytes — a
 * different concern) are not findings.
 *
 * Both the accessor→path mapping (declaredResources) and the destination
 * (stageDest) are imported from gen-staging-emit-hosts.mjs: the guard must
 * judge the SAME rows store and the SAME destination the emitted
 * BundleStager table derives from, never a re-derived copy that could drift.
 * Split out of check-staging-hosts.mjs purely for the code-size gate (that
 * file sits at the 500-line cap); the files together are one tool — see the
 * CLI's header for the full contract.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './check-staging-graph.mjs';
import { fail, mirrorCovers } from './check-staging-hosts.mjs';
import { declaredResources, stageDest } from './gen-staging-emit-hosts.mjs';

const STAGING_DIR = 'tools/generated/staging';
const EXCLUDE_STORE = `${STAGING_DIR}/ios-stager.exclude.rows`;

/** The BundleStager exclude state, parsed EAGERLY beside buildHosts (a store
 * this gate cannot judge fails loud before any check runs, whatever --host
 * selected): the declared RESOURCES rows the exclude store joins to
 * (`<suffix>=<rel>`, `repo:` prefix, ` -> dest` tail — the emitted table's
 * own input), plus the store itself — one accessor suffix per line, `#`
 * comments and blanks dropped. A suffix no RESOURCES row embeds, or a store
 * missing entirely, exits loud: default-include makes silence the failure.
 * A store whose comments alone remain is a valid empty policy. */
export function readStagerFace() {
  const resRows = declaredResources(join(REPO, STAGING_DIR));
  let src;
  try {
    src = readFileSync(join(REPO, EXCLUDE_STORE), 'utf8');
  } catch {
    fail(`the BundleStager exclude store is missing (${EXCLUDE_STORE}) — the stager exclude is a staging face this gate must judge (#798)`);
  }
  const rows = src.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const unknown = rows.filter((s) => !resRows.some((r) => r.suffix === s));
  if (unknown.length) {
    fail(`${EXCLUDE_STORE} names suffixes no RESOURCES row embeds: ${unknown.join(', ')} — retire the exclude row with its accessor`);
  }
  return { resRows, exclude: rows };
}

/** The #798 guard: the exclude rows that are graph-reached ∧ embedded ∧ not
 * TREES-covered. The reach test runs on the row's BUNDLE destination (the
 * path the loader imports — a vendored row spells its source
 * ../../external/... but stages at vendor/...); the TREES test runs on its
 * SOURCE path, the spelling the parsed mirror roots carry (identity dirs
 * spell both sides alike; the presets' ` -> dest` tails stage INTO a
 * vendored tree that does not carry those files, so a source-side miss is
 * the honest verdict there too). Returns { suffix, file, source, via, kind }
 * findings for the CLI to count and report. */
export function stagerBlindSpots(resRows, mirrorRoots, exclude, reached) {
  const findings = [];
  for (const suffix of exclude) {
    const row = resRows.find((r) => r.suffix === suffix);
    const dest = stageDest(row);
    if (!reached.has(dest)) continue; // never reached: dead embedded bytes, out of scope
    if (mirrorCovers(row.rel, mirrorRoots.map((r) => r.rel))) {
      continue; // a TREES whole-dir mirror stages the bytes another way
    }
    const edge = reached.get(dest);
    findings.push({
      suffix,
      file: dest,
      source: row.root === 'REPO' ? `repo:${row.rel}` : row.rel,
      via: `${edge.via}${edge.line ? `:${edge.line}` : ''}`,
      kind: edge.kind,
    });
  }
  return findings;
}
