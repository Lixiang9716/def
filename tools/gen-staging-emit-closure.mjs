// dsh:logging-exempt satellite of gen-staging-emit.mjs (dev script: console
// IS the product, like check-staging.mjs)
/**
 * gen-staging-emit-closure.mjs — the closure/pin legs of the staging
 * manifest consolidation (gen-staging-emit.mjs is the CLI + the harmony
 * BUNDLE_FILES half, gen-staging-emit-hosts.mjs the android scenario +
 * ios embedder halves; the code-size gate splits the tool, the files
 * together are one). The three legs flip the last hand-maintained copy
 * rosters into the store:
 *
 * harmony — ci/vendor-official.sh's three newline-separated copy lists
 *   materialize from the store, in CANONICAL SORTED order (the sorted
 *   list is THE list; the store's row order and marker positions are
 *   declarations, not bytes):
 *     harmony-closure.rows         → the CLOSURE base assignment
 *     harmony-closure-spine.rows   → the SPINE_OURS assignment
 *     harmony-closure-shelljs.rows → the SHELLJS_PARSER_FACES assignment
 *   A literal row is hand policy (it must exist under runtime/dsh — the
 *   copy source). An `@walk <rule> <dir>…` line is a find-span position:
 *   the pre-flip script's `$(cd runtime/dsh && find … | LC_ALL=C sort)`
 *   spans, now recomputed at check/emit time from the materialized pin
 *   trees and spliced in as literal rows. THE FLIP CONTRACT: a new
 *   vendored file joins the staging lists only via `--emit` + commit
 *   (reviewed in the diff) — the find's automaticity is gone by design.
 *   The assembly line (CLOSURE="$CLOSURE\n$SPINE_OURS…"), the npm-face /
 *   MOBILE-preset stage blocks and the NOBLE_DIR/PIAI_DIR whole-pin scans
 *   stay script-side (whole-tree mirrors are drift-free by construction).
 *   SPINE_OURS absorbs its pre-flip continuation group: after the flip it
 *   is one assignment carrying the whole list (identical shell value).
 *
 * android — ci/stage-spine-closure.sh's pin/face rosters materialize from
 *   android-pins.rows' `# block:` sections: dsh-spine, dsh-npm-faces and
 *   presets-npm splice into their stage AND verify `for pkg in` headers
 *   (one list, spliced twice — the twins cannot drift apart because both
 *   headers are one materialization); shelljs-face-dirs/-single-files/
 *   -pkgs are the SHELLJS_* assignment values. The whole-dir upstream/
 *   system-plugins mirrors, the dsh-root file list and the scenario/
 *   web-live rosters stay with their own legs and mechanics.
 *
 * ios — Tools/gen_bundle_header.py's ZOD_FILES (the pinned zod's runtime
 *   closure) materializes from ios-zod.rows, which is DERIVED, not
 *   declared: zodClosureRows recomputes the pin's relative-import closure
 *   from the ZOD_ROOT pin the py itself declares. Rows file and py block
 *   are machine-written; --check recomputes both. (The harmony CLOSURE
 *   carries the same zod rows as hand rows — one store copy is derived,
 *   the other declared; the recomputation pins them together.)
 *
 * check(dir) — every committed block must equal the materialization of
 *   its rows file byte-for-byte (the blocks are machine-owned; a hand
 *   edit IS drift), every declared row must name a materialized pin, and
 *   every @walk root must exist (a missing pin tree is a loud structural
 *   error, never an empty expansion). emit(dir) — write the
 *   materialization in place; a hand REORDER of a machine-owned block is
 *   drift like a hand edit. An emit on a correct tree is a no-op diff.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { REPO, DSH } from './check-staging-graph.mjs';
import { walkDiskDir, dirPinRows, zodClosureRows } from './gen-staging-legs.mjs';

const fail = (msg) => { throw new Error(`gen-staging-emit: ${msg}`); };

const HARMONY_SH = 'hosts/harmony/ci/vendor-official.sh';
const ANDROID_SH = 'hosts/android/ci/stage-spine-closure.sh';
const IOS_HEADER = 'hosts/ios/Tools/gen_bundle_header.py';
const PINS_FILE = 'android-pins.rows';
const ZOD_FILE = 'ios-zod.rows';
// ios-zod.rows is machine-written (derived), so its prose rides here and is
// stamped on every write — the ZOD_FILES block comment moved out of the py.
const ZOD_HEADER = [
  '# ios-zod.rows — the pinned zod runtime closure, DERIVED by',
  '# gen-staging-emit-closure.mjs (zodClosureRows over the ZOD_ROOT pin that',
  '# gen_bundle_header.py itself declares). Do not hand-edit: --emit rewrites',
  "# this file and machine-materializes the py's ZOD_FILES block from it; the",
  '# rest of the package (src/, v3/, mini/, .d.ts) never loads.',
];

// Walk rules for `@walk` markers, dsh-relative dir in, dsh rows out.
// `all` is the find's plain `-type f` (walkDiskDir: NO extension and NO
// .d.ts filter — the domino lib stages its index.d.ts today); the filtered
// rules ride dirPinRows. Both keep walkDiskDir's byte-sort order — the
// find's `LC_ALL=C sort` on ASCII paths.
const walkAll = (dir) => {
  const base = join(DSH, dir);
  return walkDiskDir(base).map((f) => `${dir}/${f.slice(base.length + 1).split(sep).join('/')}`);
};
const WALK_RULES = {
  all: walkAll,
  'js-json': (dir) => dirPinRows(DSH, dir, { exts: ['.js', '.json'] }) ?? [],
  'js-mjs-json': (dir) => dirPinRows(DSH, dir, { exts: ['.js', '.mjs', '.json'] }) ?? [],
};

// --- rows-file parsing -------------------------------------------------------

/** One store file's items, in order: { row } literals and { walk, rule,
 * dirs } @walk positions; `#` prose and blanks are dropped. */
function parseRowsFile(dir, name) {
  const p = join(dir, name);
  if (!existsSync(p)) fail(`${name} is missing from ${dir} — author it (the`
    + ' one-time transcription of the committed block)');
  const items = [];
  for (const raw of readFileSync(p, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('@walk ')) {
      const [rule, ...dirs] = line.slice('@walk '.length).split(/\s+/);
      if (!WALK_RULES[rule] || !dirs.length) {
        fail(`${name}: @walk marker needs a rule (${Object.keys(WALK_RULES).join('/')})`
          + ` and at least one dir: ${line}`);
      }
      items.push({ walk: rule, dirs });
    } else items.push({ row: line });
  }
  if (!items.length) fail(`${name} parsed to zero rows`);
  return items;
}

/** android-pins.rows → { section: rows[] }, keyed by `# block: <id>`;
 * prose comments ride inside their section and are dropped here. */
function parsePinsFile(dir) {
  const p = join(dir, PINS_FILE);
  if (!existsSync(p)) fail(`${PINS_FILE} is missing from ${dir}`);
  const blocks = {};
  let at = null;
  for (const raw of readFileSync(p, 'utf8').split('\n')) {
    const line = raw.trim();
    const head = line.match(/^# block: (\S+)/);
    if (head) { at = head[1]; blocks[at] = []; continue; }
    if (!line || line.startsWith('#')) continue;
    if (!at) fail(`${PINS_FILE}: rows before the first '# block:' marker: ${line}`);
    blocks[at].push(line);
  }
  return blocks;
}

// --- shell block spans -------------------------------------------------------

/** The quoted `NAME="…"` assignments of one name, in file order:
 * [{ start, end, text }] — start = the assignment line's start, end = one
 * past the closing quote. Multiline bodies carry no embedded double quotes
 * (rows are paths), so the first quote after the opener closes. */
function quotedAssignments(src, name) {
  const spans = [];
  const lines = src.split('\n');
  let at = 0;
  for (const line of lines) {
    if (line.startsWith(`${name}="`)) {
      const open = at + `${name}="`.length;
      const close = src.indexOf('"', open);
      if (close < 0) fail(`unterminated ${name} assignment in ${HARMONY_SH}`);
      spans.push({ start: at, end: close + 1, text: src.slice(open, close) });
    }
    at += line.length + 1;
  }
  return spans;
}

/** Materialize one harmony block: literal rows plus every `@walk` span's
 * recomputation, one sort ACROSS the whole block (CANONICAL SORTED — the
 * sorted list is THE list; the pre-flip spans sorted only their own dirs,
 * and the store's row order / marker positions are declarations, not
 * bytes). */
function expandItems(items, where) {
  const rows = [];
  for (const item of items) {
    if (item.row) { rows.push(item.row); continue; }
    const absent = item.dirs.filter((d) => !existsSync(join(DSH, d)));
    if (absent.length) {
      fail(`@walk pin tree(s) absent (${where}): ${absent.join(', ')}`
        + ' — external/ensure*.sh materializes the pins');
    }
    const expanded = item.dirs.flatMap((d) => WALK_RULES[item.walk](d));
    if (!expanded.length) fail(`@walk ${item.dirs.join(' ')} (${where}) expanded to zero rows`);
    rows.push(...expanded);
  }
  return [...new Set(rows)].sort();
}

// --- harmony -----------------------------------------------------------------

/** --check/--emit, harmony half: the three committed assignments must equal
 * the store materialization byte-for-byte. Only SPINE_OURS absorbs its
 * pre-flip continuation groups (the first assignment carries the list, the
 * rest are deleted — the accumulated shell value, written once); the
 * CLOSURE assembly line and every later assignment of the other names are
 * hand composition the splicer must never touch. Returns the drift lines
 * plus the splice plan. */
const HARMONY_BLOCKS = [
  { name: 'CLOSURE', file: 'harmony-closure.rows', absorb: false },
  { name: 'SPINE_OURS', file: 'harmony-closure-spine.rows', absorb: true },
  { name: 'SHELLJS_PARSER_FACES', file: 'harmony-closure-shelljs.rows', absorb: false },
];

function harmonyPlan(dir) {
  const src = readFileSync(join(REPO, HARMONY_SH), 'utf8');
  const drift = [];
  const edits = [];
  for (const spec of HARMONY_BLOCKS) {
    const spans = quotedAssignments(src, spec.name);
    if (!spans.length) fail(`${spec.name} assignment not found in ${HARMONY_SH}`);
    const items = parseRowsFile(dir, spec.file);
    for (const item of items) {
      if (item.row && !existsSync(join(DSH, item.row))) {
        drift.push(`${spec.file} row names a missing source file: ${item.row}`);
      }
    }
    const want = `${spec.name}="${expandItems(items, spec.file).join('\n')}"`;
    if (src.slice(spans[0].start, spans[0].end) !== want) {
      drift.push(`${HARMONY_SH} ${spec.name} drifted from ${spec.file}`);
    }
    edits.push({ start: spans[0].start, end: spans[0].end, text: want });
    if (spec.absorb) {
      for (const extra of spans.slice(1)) {
        edits.push({ start: extra.start - 1, end: extra.end, text: '' });
      }
    }
  }
  return { src, drift, edits };
}

// --- android -----------------------------------------------------------------

/** The spliced pin/face blocks: a store section plus its stage/verify
 * for-in anchors (the header spans from the preceding `for pkg in ` to
 * that loop's `; do`), or the SHELLJS_* value assignments. */
const PINS_SECTIONS = [
  { section: 'dsh-spine', pin: (r, ver) => `vendor/dsh/${r}@${ver}`,
    anchors: ['stage_pkg "$DSH/../../external/dsh/$pkg@$VER"',
      'external/dsh/$pkg@$VER" && find lib'] },
  { section: 'dsh-npm-faces', pin: (r, ver) => `vendor/npm/@deepseek-ai/dsh-${r}@${ver}`,
    anchors: ['stage_npm_face_at_dsh_path "$pkg"',
      'verify_npm_face_at_dsh_path "$pkg"'] },
  { section: 'presets-npm', pin: (r, ver) => `vendor/npm/@deepseek-ai/${r}@${ver}`,
    anchors: ['say "staging vendor/npm/@deepseek-ai/$pkg@$VER (lib)"',
      'path="vendor/npm/@deepseek-ai/$pkg@$VER/$rel"'] },
  { section: 'shelljs-face-dirs', pin: (r) => `vendor/npm/${r}`, assign: 'SHELLJS_FACE_DIRS' },
  { section: 'shelljs-single-files', pin: (r) => `vendor/npm/${r}`, assign: 'SHELLJS_SINGLE_FILES' },
  { section: 'shelljs-pkgs', pin: (r) => `vendor/npm/${r}`, assign: 'SHELLJS_PKGS' },
];

/** The for-in header shape: four names per line, ` \` continuations; the
 * loop's own `; do` stays in the script (the span ends before it). */
function forInHeader(rows) {
  const lines = [];
  for (let i = 0; i < rows.length; i += 4) {
    const chunk = rows.slice(i, i + 4).join(' ');
    lines.push(i === 0 ? `for pkg in ${chunk}` : `         ${chunk}`);
  }
  return lines.join(' \\\n');
}

/** --check/--emit, android half: one store section materializes every span
 * it owns; any disagreement (either twin, or a value) is drift, and the
 * section's rows must name materialized pins (dsh rosters judge the pin
 * dir, the shelljs faces their vendor/npm paths). */
function androidPlan(dir) {
  const src = readFileSync(join(REPO, ANDROID_SH), 'utf8');
  const ver = src.match(/^VER=(\S+)$/m)?.[1];
  if (!ver) fail('VER assignment not found in stage-spine-closure.sh');
  const blocks = parsePinsFile(dir);
  const drift = [];
  const edits = [];
  for (const spec of PINS_SECTIONS) {
    const rows = blocks[spec.section];
    if (!rows || !rows.length) fail(`${PINS_FILE}: no '# block: ${spec.section}' section`);
    for (const row of rows) {
      if (!existsSync(join(DSH, spec.pin(row, ver)))) {
        drift.push(`${PINS_FILE} [${spec.section}] row names a missing pin: ${row}`);
      }
    }
    if (spec.assign) {
      const spans = quotedAssignments(src, spec.assign);
      if (!spans.length) fail(`${spec.assign} assignment not found in ${ANDROID_SH}`);
      const want = `${spec.assign}="${[...rows].sort().join(' ')}"`;
      if (src.slice(spans[0].start, spans[0].end) !== want) {
        drift.push(`${ANDROID_SH} ${spec.assign} drifted from ${PINS_FILE}`);
      }
      edits.push({ start: spans[0].start, end: spans[0].end, text: want });
      continue;
    }
    for (const anchor of spec.anchors) {
      const at = src.indexOf(anchor);
      const head = at < 0 ? -1 : src.lastIndexOf('for pkg in ', at);
      const end = head < 0 ? -1 : src.indexOf('; do', head);
      if (at < 0 || head < 0 || end < 0) {
        fail(`the ${spec.section} for-in loop (anchor '${anchor.slice(0, 36)}…')`
          + ` not found in ${ANDROID_SH}`);
      }
      if (src.slice(head, end) !== forInHeader([...rows].sort())) {
        drift.push(`${ANDROID_SH} ${spec.section} list drifted from ${PINS_FILE}`);
      }
      edits.push({ start: head, end, text: forInHeader([...rows].sort()) });
    }
  }
  return { src, drift, edits };
}

// --- ios ---------------------------------------------------------------------

/** The py ZOD_ROOT declaration: ("vendor/npm/zod@4.4.3", DSH / … / "pin") —
 * { prefix, abs }: the bundle-rel prefix and the pin's absolute source dir.
 * The pin CHOICE stays the py's own declaration, never a default. */
function zodRoot(src) {
  const m = src.match(/^ZOD_ROOT = \("([^"]+)", (.+)\)$/m);
  if (!m) fail('ZOD_ROOT declaration not found in gen_bundle_header.py');
  const segs = [...m[2].matchAll(new RegExp('"([^"]*)"', 'g'))].map((x) => x[1]);
  const abs = join(DSH, ...segs);
  if (!existsSync(abs)) {
    fail(`the ZOD_ROOT pin tree is absent: ${abs} — external/ensure-dsh.sh materializes it`);
  }
  return { prefix: m[1], abs };
}

/** The derived zod closure, pin-relative (zodClosureRows over the py's pin). */
function zodDerived(root) {
  const pin = root.abs.split('/').pop();
  const parent = root.abs.split('/').slice(0, -1).join('/');
  return zodClosureRows(parent, pin).map((r) => r.slice(pin.length + 1));
}

/** --check/--emit, ios half: the DERIVED rows file and the committed py
 * block must both equal the recomputed closure. */
function iosPlan(dir) {
  const src = readFileSync(join(REPO, IOS_HEADER), 'utf8');
  const root = zodRoot(src);
  const rows = zodDerived(root);
  const drift = [];
  const at = src.indexOf('ZOD_FILES = [');
  const end = src.indexOf('\n]', at);
  if (at < 0 || end < 0) fail('ZOD_FILES block not found in gen_bundle_header.py');
  const p = join(dir, ZOD_FILE);
  if (!existsSync(p)) {
    drift.push(`${ZOD_FILE} is missing — run --emit to derive it from the ${root.prefix} pin`);
  } else {
    const committed = readFileSync(p, 'utf8').split('\n').map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    if (committed.join('\n') !== rows.join('\n')) {
      drift.push(`${ZOD_FILE} drifted from the recomputed ${root.prefix} closure`);
    }
  }
  const want = `ZOD_FILES = [\n${rows.map((r) => `    "${r}",`).join('\n')}\n]`;
  if (src.slice(at, end + 2) !== want) {
    drift.push(`${IOS_HEADER} ZOD_FILES drifted from ${ZOD_FILE}`);
  }
  return { src, drift, edits: [{ start: at, end: end + 2, text: want }], rows };
}

// --- CLI halves --------------------------------------------------------------

/** Apply edits bottom-up so the earlier offsets stay valid. */
function applyEdits(src, edits) {
  let out = src;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

/** --check half: the committed blocks must equal the materializations
 * exactly. `drift` is what an emit fixes; the caller adds the remedy. */
export function closureCheck(dir) {
  const plans = [harmonyPlan(dir), androidPlan(dir), iosPlan(dir)];
  return { drift: plans.flatMap((p) => p.drift) };
}

/** --emit half: write the materializations in place. An emit on a current
 * tree is a no-op diff. The harmony/android rows files are hand-declared
 * (never rewritten); ios-zod.rows is derived (rewritten every emit). */
export function closureEmit(dir) {
  const did = [];
  const harmony = harmonyPlan(dir);
  if (harmony.drift.length) {
    writeFileSync(join(REPO, HARMONY_SH), applyEdits(harmony.src, harmony.edits), 'utf8');
    did.push(`vendor-official.sh closure blocks materialized from the store`
      + ` (${harmony.drift.length} drift line(s) healed)`);
  }
  const android = androidPlan(dir);
  if (android.drift.length) {
    writeFileSync(join(REPO, ANDROID_SH), applyEdits(android.src, android.edits), 'utf8');
    did.push(`stage-spine-closure.sh pin/face lists materialized from the store`
      + ` (${android.drift.length} drift line(s) healed)`);
  }
  const ios = iosPlan(dir);
  writeFileSync(join(dir, ZOD_FILE), `${ZOD_HEADER.join('\n')}\n${ios.rows.join('\n')}\n`);
  if (ios.drift.length) {
    writeFileSync(join(REPO, IOS_HEADER), applyEdits(ios.src, ios.edits), 'utf8');
    did.push(`ZOD_FILES (${ios.rows.length} rows) materialized from the`
      + ' recomputed pin closure');
  } else did.push(`ZOD_FILES (${ios.rows.length} rows) already current`);
  return did;
}
