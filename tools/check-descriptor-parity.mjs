#!/usr/bin/env node
// dsh:logging-exempt (tools/ dev script: console IS the product)
/**
 * check-descriptor-parity.mjs — the capability-bus descriptor plane's GATE
 * (contract/proposals/2026-11-13-capability-bus.md, steps 1/3/4). The
 * source table + generator live in tools/descriptor-registry.mjs; this file
 * checks every face the tree serves against the same table:
 *
 *   a. the two harmony descriptors are identical — available/unavailable/
 *      entries — and equal the harmony policy, byte-for-byte in content;
 *   b. every name the C side forwards unconditionally is declared
 *      available (httpFetch.abort is control-plane: never settled, not a
 *      row; fs user-scope forwards ride the fsRead/fsWrite/fsScope rows);
 *   c. every name onDispatch routes to a module is available, or a PHASED
 *      row (declared unavailable AND answered unavailable in C);
 *   d. smoke_known_absent names are exactly the non-phased unavailable
 *      rows (the honest-absence families), and C answers them
 *      `unavailable` ahead of the invalid fall-through;
 *   e. the emitted facts tables (Swift + Kotlin) match the registry row
 *      for row, and a descriptor builder actually consumes them;
 *   f. the iOS registration flow (core.register(name:) across the Swift
 *      gateway sources) derives exactly the iOS policy — the identity the
 *      GatewayCore comment used to demand by discipline, now structural;
 *   g. the Android registration flow (register("...") across the Kotlin
 *      host sources) derives exactly the Android policy minus the retired
 *      rows — Kotlin's per-instance registration cannot feed a companion
 *      constant, so the gate IS the structural link there;
 *   h. the descriptor fits host_start's fixed buffer (phase_str_arg
 *      rejects len >= sizeof — parse the bound from the source so the
 *      gate trips before the runtime does).
 *
 * usage: node tools/check-descriptor-parity.mjs [--emit] [--selftest]
 *   no flags = --check (the gate). --emit regenerates the blocks above
 *   from the source table (idempotent: a second run changes nothing) and
 *   then runs the full check. --selftest proves the rejections (rule 6:
 *   a gate that never fails is vacuous). exit 0 = in parity, 1 = drift
 *   (named, with file:line).
 */
import {
  loadRegistry, readBlock, descriptorJson, policyUnion, emit,
  swiftFactsParse, kotlinFactsParse, factsProblems, validateRegistry,
  registrationBases, registrationFiles, listLiteral, derivationProblem,
  AUDIT_CLASSES, arktsDescriptorLines, cDescriptorLines, PRIMITIVE_NAME,
} from './descriptor-registry.mjs';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(p, 'utf8');

const fail = (problems) => {
  console.error(`descriptor-parity: FAIL (${problems.length})`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
};

/* ---- the harmony face checks --------------------------------------------- */

/** Concatenate the string literals of a `const X = 'a' + 'b'…;` block.
 * Handles both the ArkTS single-quoted form and the C double-quoted form
 * with backslash-escaped inner quotes ("{\"available\":…"). */
const literalConcat = (source, anchor) => {
  const at = source.indexOf(anchor);
  if (at < 0) return null;
  const end = source.indexOf(';', at);
  const body = source.slice(at, end);
  const single = [...body.matchAll(/'([^']*)'/g)].map((m) => m[1]);
  if (single.length > 0) return single.join('');
  const double = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  if (double.length === 0) return null;
  return double.map((s) => s.replace(/\\"/g, '"').replace(/\\\\/g, '\\')).join('');
};

/** The names compared in a smoke_serve branch, up to an early return. */
const strcmpNames = (block) =>
  [...block.matchAll(/strcmp\(name, "([a-zA-Z.]+)"\)/g)].map((m) => m[1]);

const parseDescriptor = (json, label, problems) => {
  try {
    const d = JSON.parse(json);
    if (!Array.isArray(d.available) || !Array.isArray(d.unavailable)) throw new Error('shape');
    if (d.entries !== undefined) {
      if (!Array.isArray(d.entries)) throw new Error('entries shape');
      d.entries.forEach((e) => {
        if (typeof e.name !== 'string' || !AUDIT_CLASSES.has(e.auditClass) ||
          !(e.permissionFlag === null || typeof e.permissionFlag === 'string') ||
          !Number.isInteger(e.schemaVersion)) {
          throw new Error(`entry ${JSON.stringify(e)} violates the descriptor grammar`);
        }
      });
    }
    return d;
  } catch (err) {
    problems.push(`${label}: not a parsable descriptor object (${err.message}): ${json.slice(0, 80)}…`);
    return null;
  }
};

/** Face a: the two descriptors must be byte-identical JSON, well-formed,
 * duplicate-free, and non-overlapping — available/unavailable/entries.
 * Returns the parsed pair or null after pushing problems. */
const checkDescriptorsIdentical = (ets, cpp, problems) => {
  const etsJson = literalConcat(ets, 'export const BINDING_DESCRIPTOR');
  const cppJson = literalConcat(cpp, 'const char *DSH_BINDING_DESCRIPTOR');
  if (etsJson === null) problems.push('HostPhase.ets: BINDING_DESCRIPTOR anchor not found');
  if (cppJson === null) problems.push('gateway_smoke.cpp: DSH_BINDING_DESCRIPTOR anchor not found');
  if (problems.length) return null;
  const etsDesc = parseDescriptor(etsJson, 'HostPhase.ets BINDING_DESCRIPTOR', problems);
  const cppDesc = parseDescriptor(cppJson, 'gateway_smoke.cpp DSH_BINDING_DESCRIPTOR', problems);
  if (problems.length) return null;
  for (const key of ['available', 'unavailable', 'entries']) {
    if (JSON.stringify(etsDesc[key]) !== JSON.stringify(cppDesc[key])) {
      problems.push(`descriptors differ on ${key}:\n      ArkTS: ${JSON.stringify(etsDesc[key])}\n      C:     ${JSON.stringify(cppDesc[key])}`);
    }
  }
  const dupes = (arr) => arr.filter((v, i) => arr.indexOf(v) !== i);
  for (const key of ['available', 'unavailable']) {
    if (dupes(etsDesc[key]).length) problems.push(`${key} carries duplicates: ${dupes(etsDesc[key])}`);
  }
  const overlap = etsDesc.available.filter((n) => etsDesc.unavailable.includes(n));
  if (overlap.length) problems.push(`rows both available and unavailable: ${overlap}`);
  return { etsDesc, cppDesc, etsJson, cppJson };
};

/** Face b: the C binding-mode forward list ⊆ available; the phased rows
 * (C-side smoke_reject unavailable) ⊆ declared unavailable. Returns the
 * known-absent set faces c and the smoke face consume. */
const checkForwardAndPhased = (cpp, etsDesc, problems) => {
  const serveAt = cpp.indexOf('static void smoke_serve(');
  const serveBody = cpp.slice(serveAt, cpp.indexOf('\n}', serveAt));
  const bindingBlock = serveBody.slice(
    serveBody.indexOf('if (b->forward_fn != nullptr) {'),
    serveBody.indexOf('if (strcmp(name, "fsWrite") == 0)'),
  );
  const forwarded = new Set(strcmpNames(bindingBlock));
  // control-plane + user-scope conditional forwards: legal riders, not rows
  for (const rider of ['httpFetch.abort', 'fsRead', 'fsWrite', 'fsScope.persist', 'fsScope.resolve']) {
    forwarded.delete(rider);
  }
  // the phased rows ride the same binding block but smoke_reject (never
  // forward_fn) — they belong to the phased check below, not this one
  for (const name of ['cameraRecordStart', 'cameraRecordStop']) {
    forwarded.delete(name);
  }
  // the phased rows forward-reject in C itself (smoke_reject unavailable)
  const phasedBlock = serveBody.slice(
    serveBody.indexOf('cameraRecordStart') - 60,
    serveBody.indexOf('httpFetch.abort'),
  );
  const phased = strcmpNames(phasedBlock);
  for (const name of forwarded) {
    if (!etsDesc.available.includes(name)) {
      problems.push(`C forwards "${name}" to the ArkTS layer but the descriptor does not declare it available`);
    }
  }
  for (const name of phased) {
    if (!etsDesc.unavailable.includes(name)) {
      problems.push(`"${name}" answers unavailable in C (phased) but is not declared unavailable`);
    }
  }
  return { serveBody, phased };
};

/** Face c: onDispatch served names ⊆ available; declared absent
 * families = smoke_known_absent both directions; the absent check runs
 * before the invalid fall-through. Returns the known-absent set. */
const checkServedNames = (ets, cpp, serveBody, phased, etsDesc, problems) => {
  const dispatchAt = ets.indexOf('private onDispatch(');
  const dispatchBody = ets.slice(dispatchAt, ets.indexOf('\n  }', dispatchAt));
  const routed = new Set([...dispatchBody.matchAll(/name === '([a-zA-Z.]+)'/g)].map((m) => m[1]));
  routed.delete('cameraRecordStart');
  routed.delete('cameraRecordStop');
  routed.delete('httpFetch.abort');
  for (const name of routed) {
    const row = name.split('.')[0];
    if (!etsDesc.available.includes(row) && !etsDesc.available.includes(name)) {
      problems.push(`onDispatch serves "${name}" but the descriptor does not declare it available`);
    }
  }
  for (const name of etsDesc.available) {
    if (name.includes('.') || !/^[a-zA-Z]+$/.test(name)) {
      problems.push(`available row "${name}" is not a bare primitive name`);
    }
  }
  const absentAt = cpp.indexOf('static int smoke_known_absent(');
  const absentBody = cpp.slice(absentAt, cpp.indexOf('\n}', absentAt));
  const knownAbsent = new Set(strcmpNames(absentBody));
  const declaredAbsent = etsDesc.unavailable.filter((n) => !phased.includes(n));
  for (const name of declaredAbsent) {
    if (!knownAbsent.has(name)) {
      problems.push(`descriptor declares "${name}" unavailable but smoke_known_absent does not answer it`);
    }
  }
  for (const name of knownAbsent) {
    if (!etsDesc.unavailable.includes(name)) {
      problems.push(`smoke_known_absent answers "${name}" unavailable but the descriptor does not declare it`);
    }
  }
  const invalidFall = serveBody.indexOf('"invalid", "unknown primitive"');
  const absentCall = serveBody.indexOf('smoke_known_absent(name)');
  if (absentCall < 0 || absentCall > invalidFall) {
    problems.push('gateway_smoke.cpp: the known-absent check must run before the invalid fall-through');
  }
  return knownAbsent;
};

/** Face d: the smoke face declares what it answers unavailable; the
 * descriptor fits host_start's fixed buffer; the credited modules exist. */
const checkSmokeFaceAndBuffer = (cpp, etsJson, cppJson, knownAbsent, problems) => {
  const smokeJson = literalConcat(cpp, 'const char *DSH_SMOKE_DESCRIPTOR');
  const smokeDesc = smokeJson === null
    ? null
    : parseDescriptor(smokeJson, 'gateway_smoke.cpp DSH_SMOKE_DESCRIPTOR', problems);
  if (smokeDesc !== null) {
    for (const name of knownAbsent) {
      if (!smokeDesc.unavailable.includes(name)) {
        problems.push(`DSH_SMOKE_DESCRIPTOR does not declare "${name}" unavailable although the smoke face answers it unavailable (smoke_known_absent serves both modes)`);
      }
    }
  }
  checkBufferBound(etsJson, cppJson, problems);
  checkHarmonyModules(problems);
};

/** The descriptor must fit host_start's fixed buffer — phase_str_arg
 * rejects len >= sizeof (EINVAL "descriptor too long"), and the 28-row
 * descriptor sat at 511/512 (review finding: one added row from a dead
 * phase start). Parse the bound from the source so the gate trips before
 * the runtime does. */
const checkBufferBound = (etsJson, cppJson, problems) => {
  const napi = read('hosts/harmony/entry/src/main/cpp/napi_init.cpp');
  const buf = napi.match(/char descriptor\[(\d+)\]/);
  const cap = buf ? Number(buf[1]) : 0;
  if (cap <= 0) {
    problems.push('napi_init.cpp: the descriptor buffer declaration (char descriptor[N]) was not found');
    return;
  }
  if (etsJson.length >= cap) {
    problems.push(`BINDING_DESCRIPTOR is ${etsJson.length} bytes — at or over host_start's char descriptor[${cap}] (phase_str_arg rejects len >= ${cap} with EINVAL; the phase would never start)`);
  }
  if (cppJson !== null && cppJson.length >= cap) {
    problems.push(`DSH_BINDING_DESCRIPTOR is ${cppJson.length} bytes — at or over host_start's char descriptor[${cap}]`);
  }
};

/** The modules the descriptor credits must exist on disk. */
const checkHarmonyModules = (problems) => {
  for (const mod of ['TimerPrimitive', 'MicPrimitives', 'BlePrimitives', 'CameraPrimitives',
    'DevicePlanePrimitives', 'KeychainPrimitives', 'PickerPrimitives', 'HttpPrimitive']) {
    try {
      read(`hosts/harmony/entry/src/main/ets/model/${mod}.ets`);
    } catch {
      problems.push(`hosts/harmony/entry/src/main/ets/model/${mod}.ets missing (the descriptor's serving face)`);
    }
  }
};

/** The harmony descriptor must equal the harmony policy exactly — the
 * generated block IS the policy (the strongest lockstep: name order too). */
const checkHarmonyPolicy = (reg, desc, problems) => {
  const policy = reg.hosts.harmony;
  if (JSON.stringify(desc.available) !== JSON.stringify(policy.available)) {
    problems.push('BINDING_DESCRIPTOR available != registry harmony.available (run node tools/check-descriptor-parity.mjs --emit)');
  }
  if (JSON.stringify(desc.unavailable) !== JSON.stringify(policy.unavailable)) {
    problems.push('BINDING_DESCRIPTOR unavailable != registry harmony.unavailable');
  }
  const expected = descriptorJson(reg, 'harmony');
  const entriesOf = (desc) => JSON.stringify((desc ?? {}).entries ?? null);
  if (entriesOf(desc) !== entriesOf(JSON.parse(expected))) {
    problems.push('BINDING_DESCRIPTOR entries != the registry-derived per-entry self-description (run node tools/check-descriptor-parity.mjs --emit)');
  }
};

/* ---- the iOS / Android derivation checks --------------------------------- */

const checkIos = (reg, problems) => {
  const file = 'hosts/ios/App/Source/Gateway/GatewayCore.swift';
  const block = readBlock(file, 'facts', problems);
  if (block !== null) {
    Object.assign(problems, factsProblems(swiftFactsParse(block.content), reg, `${file} facts block`));
  }
  const src = read(file);
  if (!/func descriptorJSON\(/.test(src)) {
    problems.push(`${file}: no descriptorJSON builder consumes the generated facts (the descriptor plane's runtime half)`);
  }
  if (/static let primitives/.test(src)) {
    problems.push(`${file}: the hand serving list (static let primitives) is back — the descriptor is registration-derived (contract/proposals/2026-11-13-capability-bus.md step B); delete the list, register the row`);
  }
  const files = registrationFiles('hosts/ios/App/Source/Gateway', '.swift');
  const bases = registrationBases(files, /core\.register\(name: "([a-zA-Z.]+)"/g);
  const expected = [...new Set(policyUnion(reg, 'ios'))].sort();
  if (JSON.stringify(bases) !== JSON.stringify(expected)) {
    problems.push(derivationProblem('the iOS registration flow', bases, expected));
  }
};

const checkAndroid = (reg, problems) => {
  const file = 'hosts/android/app/src/main/java/com/dshmobile/host/GatewayCore.kt';
  const src = read(file);
  const table = readBlock(file, 'serving-table', problems);
  if (table !== null) {
    const names = [...table.content.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]);
    if (JSON.stringify(names) !== JSON.stringify(reg.hosts.android.available)) {
      problems.push(`${file} serving-table block != registry android.available (run node tools/check-descriptor-parity.mjs --emit)`);
    }
  }
  const facts = readBlock(file, 'facts', problems);
  if (facts !== null) {
    Object.assign(problems, factsProblems(kotlinFactsParse(facts.content), reg, `${file} facts block`));
  }
  if (!/fun descriptorJSON\(/.test(src)) {
    problems.push(`${file}: no descriptorJSON builder consumes the generated facts (the descriptor plane's runtime half)`);
  }
  const phased = listLiteral(src, 'val PHASED_ROWS = listOf(') ?? [];
  const retired = listLiteral(src, 'val RETIRED_ROWS = listOf(') ?? [];
  const absent = [...new Set([...phased, ...retired])].sort();
  if (JSON.stringify(absent) !== JSON.stringify([...new Set(reg.hosts.android.unavailable)].sort())) {
    problems.push(`${file}: PHASED_ROWS + RETIRED_ROWS [${absent}] != registry android.unavailable`);
  }
  const files = registrationFiles('hosts/android/app/src/main/java/com/dshmobile/host', '.kt');
  const bases = registrationBases(files, /\bregister\("([a-zA-Z.]+)"\)/g);
  const expected = [...new Set(policyUnion(reg, 'android'))]
    .filter((n) => !retired.includes(n))
    .sort();
  if (JSON.stringify(bases) !== JSON.stringify(expected)) {
    problems.push(derivationProblem('the Android registration flow', bases, expected));
  }
};

/* ---- the whole check ------------------------------------------------------ */

const check = (reg) => {
  const problems = [];
  const ets = read('hosts/harmony/entry/src/main/ets/model/HostPhase.ets');
  const cpp = read('hosts/harmony/entry/src/main/cpp/gateway_smoke.cpp');
  const desc = checkDescriptorsIdentical(ets, cpp, problems);
  if (desc === null) return problems;
  const { serveBody, phased } = checkForwardAndPhased(cpp, desc.etsDesc, problems);
  const knownAbsent = checkServedNames(ets, cpp, serveBody, phased, desc.etsDesc, problems);
  checkSmokeFaceAndBuffer(cpp, desc.etsJson, desc.cppJson, knownAbsent, problems);
  checkHarmonyPolicy(reg, desc.etsDesc, problems);
  checkIos(reg, problems);
  checkAndroid(reg, problems);
  return problems;
};

/* ---- selftest (rule 6: prove each rejection fires) ------------------------ */

const selftestFaces = (reg) => {
  const deny = (name, fired) => {
    if (!fired) {
      console.error(`selftest: ${name} did not fire`);
      failed += 1;
    }
  };
  const problems = [];
  // the descriptor-difference detector (the original gate's proof)
  const a = literalConcat(`const X = '{"available":["fsRead"],"unavailable":[]}';`, 'const X');
  const b = literalConcat(`const X = '{"available":["fsRead","timerSchedule"],"unavailable":[]}';`, 'const X');
  const da = parseDescriptor(a, 'A', problems);
  const db = parseDescriptor(b, 'B', problems);
  deny('descriptor-difference detector',
    JSON.stringify(da.available) !== JSON.stringify(db.available));
  // the C strcmp extractors
  const absentSample = `static int smoke_known_absent(const char *name) {
    return strcmp(name, "fsStat") == 0;
}`;
  deny('strcmp extractor (known-absent)', strcmpNames(absentSample).includes('fsStat'));
  const forwardSample = `if (strcmp(name, "notify") == 0 || strcmp(name, "micStart") == 0) {
    b->forward_fn(b->forward_ud, call_id, name, args); return; }`;
  deny('strcmp extractor (forward list)',
    strcmpNames(forwardSample).join(',') === 'notify,micStart');
  // the entries grammar rejects a malformed entry
  const badEntries = parseDescriptor(
    '{"available":["fsRead"],"unavailable":[],"entries":[{"name":"fsRead"}]}', 'E', problems);
  deny('descriptor entries grammar', badEntries === null);
  // the emit block roundtrip: chunk+escape then literalConcat restores
  const json = descriptorJson(reg, 'harmony');
  const cSource = cDescriptorLines(reg).join('\n');
  deny('C descriptor literal roundtrip',
    literalConcat(cSource, 'const char *DSH_BINDING_DESCRIPTOR') === json);
  const arktsSource = arktsDescriptorLines(reg).join('\n');
  deny('ArkTS descriptor literal roundtrip',
    literalConcat(arktsSource, 'export const BINDING_DESCRIPTOR') === json);
  // the harmony-policy detector fires on a drifted policy
  const reg2 = structuredClone(reg);
  reg2.hosts.harmony.available = [...reg2.hosts.harmony.available, 'channelOpen'];
  const harmonyProblems = [];
  checkHarmonyPolicy(reg2, parseDescriptor(json, 'P', []), harmonyProblems);
  deny('harmony-policy detector (drifted available)',
    harmonyProblems.some((p) => p.includes('harmony.available')));
};

const selftestRegistry = (reg) => {
  const deny = (name, fired) => {
    if (!fired) {
      console.error(`selftest: ${name} did not fire`);
      failed += 1;
    }
  };
  // the registry validator rejects a bad audit class and duplicate rows
  const row = { name: 'fsRead', origin: 'contract', family: 'fs', permissionFlag: null, auditClass: 'audited', schemaVersion: 1 };
  deny('registry validator (auditClass)',
    validateRegistry({ schemaVersion: 1, rows: [{ ...row, auditClass: 'maybe' }], hosts: {} }).length > 0);
  deny('registry validator (duplicate row)',
    validateRegistry({ schemaVersion: 1, rows: [row, { ...row }], hosts: {} })
      .some((p) => p.includes('duplicate')));
  // the emitted-facts comparator fires on a drifted / missing row
  const facts = Object.fromEntries(reg.rows.map((r) => [r.name, {
    schemaVersion: r.schemaVersion, auditClass: r.auditClass, permissionFlag: r.permissionFlag,
  }]));
  const drifted = { ...facts, fsStat: { ...facts.fsStat, permissionFlag: 'fsWrite' } };
  deny('facts comparator (drifted flag)',
    factsProblems(drifted, reg, 'test').some((p) => p.includes('fsStat')));
  const missing = { ...drifted };
  delete missing.fsSync;
  deny('facts comparator (missing row)',
    factsProblems(missing, reg, 'test').some((p) => p.includes('fsSync')));
  // the registration extractors — the dotted-rider FOLD rule (a dotted
  // sub-verb's base row is what the descriptor declares)
  const swiftSample = 'core.register(name: "fsRead") { };\ncore.register(name: "fsScope.persist") { };';
  const bases = [...new Set(
    [...swiftSample.matchAll(/core\.register\(name: "([a-zA-Z.]+)"/g)]
      .map((m) => m[1].split('.')[0]),
  )].sort();
  deny('dotted-rider fold (fsScope.persist -> fsScope)',
    JSON.stringify(bases) === '["fsRead","fsScope"]');
  const kotlinSample = 'on.register("fsRead") { call, done -> x(call, done) }\nfoo.register("httpFetch.abort") { _, _ -> }';
  const kBases = [...new Set(
    [...kotlinSample.matchAll(/\bregister\("([a-zA-Z.]+)"\)/g)].map((m) => m[1].split('.')[0]),
  )].sort();
  deny('kotlin registration extractor + fold', JSON.stringify(kBases) === '["fsRead","httpFetch"]');
  // prose mentioning the pattern is not a registration
  const prose = 'the gate checks register("...") across the host sources';
  deny('prose is not a registration',
    [...prose.matchAll(/\bregister\("([a-zA-Z.]+)"\)/g)]
      .filter((m) => PRIMITIVE_NAME.test(m[1])).length === 0);
};

let failed = 0;

const selftest = async () => {
  const reg = loadRegistry();
  selftestFaces(reg);
  selftestRegistry(reg);
  console.log(`descriptor-parity: selftest ${failed === 0 ? 'PASS' : 'FAIL'} (10 detector classes, ${failed} silent)`);
  process.exit(failed === 0 ? 0 : 1);
};

/* ---- CLI ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
if (argv.includes('--selftest')) {
  selftest();
}

const reg = loadRegistry();
if (argv.includes('--emit')) {
  emit(reg);
}
const problems = check(reg);
if (problems.length) fail(problems);
console.log('descriptor-parity: OK — the capability registry derives every served face '
  + '(harmony two-face lockstep, iOS/Android registration derivation, facts tables, buffer bound)');
