// dsh:logging-exempt (tools/ dev script: console IS the product)
/**
 * descriptor-registry.mjs — the source-table half of the capability-bus
 * descriptor plane (contract/proposals/2026-11-13-capability-bus.md, step
 * C), split out of tools/check-descriptor-parity.mjs so the gate stays
 * within the code-size budget. One source table —
 * tools/generated/capability-registry.json, the per-primitive contract data
 * authored from contract/primitives.md §2/§5 — feeds the per-host
 * serve/absent policies; this module validates the table, builds each
 * host's descriptor JSON from it, and EMITS the generated blocks into the
 * three hosts (between `dsh:capability-registry:` markers). The parity gate
 * (the sibling file) checks every served face against the same table.
 *
 * Emit targets:
 *   1. hosts/ios/App/Source/Gateway/GatewayCore.swift  [facts]
 *      the per-entry facts table the runtime descriptor builder consumes
 *   2. hosts/android/.../GatewayCore.kt  [serving-table] + [facts]
 *      the serving table (PRIMITIVES) + the same facts table
 *   3. hosts/harmony/.../HostPhase.ets  [descriptor]
 *      BINDING_DESCRIPTOR (what the runtime negotiates on)
 *   4. hosts/harmony/.../gateway_smoke.cpp  [descriptor]
 *      DSH_BINDING_DESCRIPTOR (the C fallback, emitted from the SAME policy)
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const read = (p) => readFileSync(join(ROOT, p), 'utf8');
export const REGISTRY_PATH = 'tools/generated/capability-registry.json';
export const AUDIT_CLASSES = new Set(['audited', 'unaudited']);
const ORIGINS = new Set(['contract', 'capability-plane']);

/** Load + validate the registry (rule 5: malformed configs abort with the
 * offending name). Returns the parsed registry or throws. */
export const loadRegistry = () => {
  const reg = JSON.parse(read(REGISTRY_PATH));
  const problems = validateRegistry(reg);
  if (problems.length) {
    throw new Error(`${REGISTRY_PATH}: ${problems.join('; ')}`);
  }
  return reg;
};

const validateRow = (row, at, problems) => {
  if (!/^[a-zA-Z]+$/.test(row.name ?? '')) {
    problems.push(`${at}: name "${row.name}" is not a bare primitive name`);
  }
  if (!ORIGINS.has(row.origin)) {
    problems.push(`${at} (${row.name}): origin "${row.origin}" outside ${[...ORIGINS].join('/')}`);
  }
  if (!AUDIT_CLASSES.has(row.auditClass)) {
    problems.push(`${at} (${row.name}): auditClass "${row.auditClass}" outside ${[...AUDIT_CLASSES].join('/')}`);
  }
  if (!(row.permissionFlag === null || typeof row.permissionFlag === 'string')) {
    problems.push(`${at} (${row.name}): permissionFlag must be a string or null`);
  }
  if (!Number.isInteger(row.schemaVersion) || row.schemaVersion < 1) {
    problems.push(`${at} (${row.name}): schemaVersion must be an integer >= 1`);
  }
  if (typeof row.family !== 'string' || row.family === '') {
    problems.push(`${at} (${row.name}): family must be a non-empty string`);
  }
};

const validateHosts = (reg, rows, problems) => {
  if (!reg.hosts || typeof reg.hosts !== 'object') {
    problems.push('hosts: missing');
    return;
  }
  for (const [host, policy] of Object.entries(reg.hosts)) {
    for (const key of ['available', 'unavailable']) {
      const arr = policy?.[key];
      if (!Array.isArray(arr)) {
        problems.push(`hosts.${host}.${key}: must be an array`);
        continue;
      }
      for (const name of arr) {
        if (!rows.has(name)) {
          problems.push(`hosts.${host}.${key}: "${name}" is not a registry row`);
        }
      }
      const d = arr.filter((v, i) => arr.indexOf(v) !== i);
      if (d.length) problems.push(`hosts.${host}.${key}: duplicates ${d}`);
    }
    const overlap = (policy.available ?? []).filter((n) => (policy.unavailable ?? []).includes(n));
    if (overlap.length) problems.push(`hosts.${host}: rows both available and unavailable: ${overlap}`);
  }
};

export const validateRegistry = (reg) => {
  const problems = [];
  if (!reg || reg.schemaVersion !== 1) {
    return [`${REGISTRY_PATH}: schemaVersion must be 1`];
  }
  if (!Array.isArray(reg.rows) || reg.rows.length === 0) {
    return [`${REGISTRY_PATH}: rows must be a non-empty array`];
  }
  const names = [];
  reg.rows.forEach((row, i) => {
    const at = `row#${i + 1}`;
    validateRow(row, at, problems);
    names.push(row.name);
  });
  const dupes = names.filter((v, i) => names.indexOf(v) !== i);
  if (dupes.length) problems.push(`rows carry duplicate names: ${dupes}`);
  validateHosts(reg, new Set(names), problems);
  return problems;
};

/** The descriptor JSON one host's policy builds: the name arrays + the
 * per-entry self-description (the capability-bus grammar — additive over
 * the flat name arrays every existing consumer reads). */
export const descriptorJson = (reg, host) => {
  const policy = reg.hosts[host];
  const rows = Object.fromEntries(reg.rows.map((r) => [r.name, r]));
  return JSON.stringify({
    available: policy.available,
    unavailable: policy.unavailable,
    entries: [...policy.available, ...policy.unavailable].map((name) => ({
      name,
      schemaVersion: rows[name].schemaVersion,
      auditClass: rows[name].auditClass,
      permissionFlag: rows[name].permissionFlag,
    })),
  });
};

export const policyUnion = (reg, host) =>
  [...reg.hosts[host].available, ...reg.hosts[host].unavailable];

/* ---- generated block plumbing ------------------------------------------- */

const blockBounds = (lines, id) => {
  const begin = lines.findIndex((l) => l.includes(`dsh:capability-registry:begin#${id}`));
  const end = lines.findIndex((l) => l.includes(`dsh:capability-registry:end#${id}`));
  if (begin < 0) return { missing: `begin#${id} marker not found` };
  if (end < 0) return { missing: `end#${id} marker not found` };
  if (end <= begin) return { missing: `end#${id} marker precedes begin#${id}` };
  return { begin, end };
};

/** The current generated-block content (between the markers), or null with
 * the reason when the markers are absent/misordered. */
export const readBlock = (file, id, problems) => {
  const lines = read(file).split('\n');
  const b = blockBounds(lines, id);
  if (b.missing) {
    problems.push(`${file}: ${b.missing} (run node tools/check-descriptor-parity.mjs --emit)`);
    return null;
  }
  return { content: lines.slice(b.begin + 1, b.end).join('\n'), lines };
};

/** Replace the content between the markers, keeping the marker lines. */
export const writeBlock = (file, id, contentLines) => {
  const lines = read(file).split('\n');
  const b = blockBounds(lines, id);
  if (b.missing) throw new Error(`${file}: ${b.missing}`);
  lines.splice(b.begin + 1, b.end - b.begin - 1, ...contentLines);
  writeFileSync(join(ROOT, file), lines.join('\n'));
};

export const changedBlock = (file, id, contentLines) => {
  const current = readBlock(file, id, []);
  return current === null || current.content !== contentLines.join('\n');
};

/* ---- emit content builders ---------------------------------------------- */

const chunk = (text, width) => {
  const out = [];
  for (let at = 0; at < text.length; at += width) out.push(text.slice(at, at + width));
  return out;
};

const swiftFactArg = (row) =>
  `PrimitiveFact(schemaVersion: ${row.schemaVersion}, auditClass: "${row.auditClass}", ` +
  `permissionFlag: ${row.permissionFlag === null ? 'nil' : `"${row.permissionFlag}"`})`;

const kotlinFactArg = (row) =>
  `PrimitiveFact(schemaVersion = ${row.schemaVersion}, auditClass = "${row.auditClass}", ` +
  `permissionFlag = ${row.permissionFlag === null ? 'null' : `"${row.permissionFlag}"`})`;

export const swiftFactsLines = (reg) => [
  '    static let primitiveFacts: [String: PrimitiveFact] = [',
  ...reg.rows.map((row) => `        "${row.name}": ${swiftFactArg(row)},`),
  '    ]',
];

export const kotlinFactsLines = (reg) => [
  '        val PRIMITIVE_FACTS: Map<String, PrimitiveFact> = mapOf(',
  ...reg.rows.map((row) => `            "${row.name}" to ${kotlinFactArg(row)},`),
  '        )',
];

export const kotlinServingTableLines = (reg) => {
  const names = reg.hosts.android.available;
  const body = [];
  for (let at = 0; at < names.length; at += 6) {
    body.push('            ' + names.slice(at, at + 6).map((n) => `"${n}"`).join(', ') + ',');
  }
  return ['        val PRIMITIVES = listOf(', ...body, '        )'];
};

/** The ArkTS string-concatenation form (single quotes — the JSON carries no
 * apostrophes) of one descriptor. */
export const arktsDescriptorLines = (reg) => {
  const parts = chunk(descriptorJson(reg, 'harmony'), 76);
  return [
    'export const BINDING_DESCRIPTOR: string =',
    ...parts.slice(0, -1).map((p) => `  '${p}' +`),
    `  '${parts[parts.length - 1]}';`,
  ];
};

/** The C escaped form (double quotes, inner quotes backslash-escaped) of the
 * same descriptor — chunking the RAW json before escaping keeps every escape
 * pair whole inside one chunk. */
export const cDescriptorLines = (reg) => {
  const parts = chunk(descriptorJson(reg, 'harmony'), 68);
  return [
    'const char *DSH_BINDING_DESCRIPTOR =',
    ...parts.slice(0, -1).map((p) => `    "${p.replace(/"/g, '\\"')}"`),
    `    "${parts[parts.length - 1].replace(/"/g, '\\"')}";`,
  ];
};

/** The five generated blocks, in emit order. */
export const emitTargets = (reg) => [
  ['hosts/ios/App/Source/Gateway/GatewayCore.swift', 'facts', swiftFactsLines(reg)],
  ['hosts/android/app/src/main/java/com/dshmobile/host/GatewayCore.kt', 'serving-table', kotlinServingTableLines(reg)],
  ['hosts/android/app/src/main/java/com/dshmobile/host/GatewayCore.kt', 'facts', kotlinFactsLines(reg)],
  ['hosts/harmony/entry/src/main/ets/model/HostPhase.ets', 'descriptor', arktsDescriptorLines(reg)],
  ['hosts/harmony/entry/src/main/cpp/gateway_smoke.cpp', 'descriptor', cDescriptorLines(reg)],
];

/** --emit: rewrite every target block whose content drifted; idempotent (a
 * second run changes nothing). Returns the count of rewritten blocks. */
export const emit = (reg) => {
  const targets = emitTargets(reg);
  let touched = 0;
  for (const [file, id, lines] of targets) {
    if (changedBlock(file, id, lines)) {
      writeBlock(file, id, lines);
      console.log(`descriptor-parity: emitted ${file} [${id}]`);
      touched += 1;
    }
  }
  console.log(`descriptor-parity: --emit done (${touched} block(s) rewritten, `
    + `${targets.length} total — idempotent: re-run changes nothing)`);
  return touched;
};

/* ---- the emitted-facts + registration derivations ------------------------ */

export const swiftFactsParse = (content) => {
  const facts = {};
  for (const m of content.matchAll(
    /"([a-zA-Z]+)": PrimitiveFact\(schemaVersion: (\d+), auditClass: "([a-z]+)", permissionFlag: (nil|"[a-zA-Z]+")\)/g,
  )) {
    facts[m[1]] = {
      schemaVersion: Number(m[2]),
      auditClass: m[3],
      permissionFlag: m[4] === 'nil' ? null : m[4].slice(1, -1),
    };
  }
  return facts;
};

export const kotlinFactsParse = (content) => {
  const facts = {};
  for (const m of content.matchAll(
    /"([a-zA-Z]+)" to PrimitiveFact\(schemaVersion = (\d+), auditClass = "([a-z]+)", permissionFlag = (null|"[a-zA-Z]+")\)/g,
  )) {
    facts[m[1]] = {
      schemaVersion: Number(m[2]),
      auditClass: m[3],
      permissionFlag: m[4] === 'null' ? null : m[4].slice(1, -1),
    };
  }
  return facts;
};

/** The emitted facts must equal the registry rows exactly (the registry is
 * the single writer). */
export const factsProblems = (facts, reg, label) => {
  const problems = [];
  const expected = Object.fromEntries(reg.rows.map((r) => [r.name, {
    schemaVersion: r.schemaVersion, auditClass: r.auditClass, permissionFlag: r.permissionFlag,
  }]));
  for (const name of Object.keys(expected)) {
    if (!facts[name]) {
      problems.push(`${label}: registry row "${name}" missing from the emitted facts`);
    } else if (JSON.stringify(facts[name]) !== JSON.stringify(expected[name])) {
      problems.push(`${label}: "${name}" facts ${JSON.stringify(facts[name])} != registry ${JSON.stringify(expected[name])}`);
    }
  }
  for (const name of Object.keys(facts)) {
    if (!expected[name]) problems.push(`${label}: emitted fact "${name}" is not a registry row`);
  }
  return problems;
};

/** Registration-driven derivation (the descriptor plane, step B): every
 * registration site's name, folded to its base row (dotted sub-verbs ride
 * their contract row — fsScope.persist/resolve ride fsScope,
 * httpFetch.abort rides httpFetch), must derive exactly the host policy
 * minus rows no handler serves. Names that are not plausible primitive
 * names are skipped — prose may mention the pattern (a doc comment's
 * `register("...")` is not a registration). */
const PRIMITIVE_NAME = /^[a-zA-Z]+(\.[a-zA-Z]+)?$/;
export { PRIMITIVE_NAME };

export const registrationBases = (files, pattern) => {
  const bases = [];
  for (const file of files) {
    for (const m of read(file).matchAll(pattern)) {
      if (!PRIMITIVE_NAME.test(m[1])) continue;
      bases.push(m[1].split('.')[0]);
    }
  }
  return [...new Set(bases)].sort();
};

export const listLiteral = (source, anchor) => {
  const at = source.indexOf(anchor);
  if (at < 0) return null;
  const end = source.indexOf(')', at);
  return [...source.slice(at, end).matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]);
};

/** The host's registration sites: every source file of the host language in
 * the gateway directory. */
export const registrationFiles = (dir, ext) =>
  readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith(ext))
    .map((f) => `${dir}/${f}`);

/** The derivation mismatch problem (shared wording for both hosts). */
export const derivationProblem = (label, bases, expected) => {
  const onlyReg = bases.filter((n) => !expected.includes(n));
  const onlyPolicy = expected.filter((n) => !bases.includes(n));
  return `${label} does not derive the host policy: registration-only [${onlyReg}] `
    + `policy-only [${onlyPolicy}] — add the missing rows to ${REGISTRY_PATH} `
    + `(both sides) or register the row`;
};
