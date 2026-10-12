/**
 * M3 on-device install driver `m3.android-install` — ANDROID-SPECIFIC (this
 * file exists ONLY in hosts/android assets; the canonical scenario set under
 * runtime/spike/scenario/ is frozen for host embeds). All logic stays in the
 * canonical modules (install-fetch.js + install-pipeline.js +
 * receipt-journal.js + config-layer.js + fixtures/); this driver only wires
 * them to the real Android gateway surface:
 *
 *   build the dsh-notes tgz on-device (fixtures/dsh-notes.js) → hand it to
 *   the loopback carrier (fsWrite into the app scope; CarrierServer serves
 *   it) → installFromFetch with the REAL gateway httpFetch over
 *   http://127.0.0.1:<port>/ → receipt + journal → the dsh-badge package
 *   (requires `notify`) installs cleanly against the device's honest
 *   nine-primitive descriptor — the install-time negotiation POSITIVE leg —
 *   → a driver-built package requiring `subprocess` (not offered by this
 *   host) is rejected BEFORE unpack — the negotiation NEGATIVE leg — →
 *   crash-simulated pending receipts replayed (§4) → the INSTALLED entry
 *   loaded via __dshModuleDefine and exercised (notes roundtrip) → the
 *   config-layer override applied to the session slot gate. UI stages ride
 *   the bus (__dshBusPost) so the host screen renders the receipt and the
 *   notes acknowledgement (screenshots are human evidence only).
 *
 * Every expected step emits exactly one structured log entry, in the order
 * declared by tools/e2e/scenarios/m3-android-install.json.
 */
import { createLogger } from 'logger.js';
import { fsRead, fsWrite, httpFetch, onEvent } from 'gateway.js';
import { createRegistry } from 'registry.js';
import { InstallRejected } from 'install-pipeline.js';
import { installFromFetch } from 'install-fetch.js';
import { readJournal, simulateCrash, replayPendingReceipts } from 'receipt-journal.js';
import { resolveConfig, slotAllowed } from 'config-layer.js';
import { sha256Hex } from 'sha256.js';
import { tarWrite } from 'tar-mini.js';
import * as fsPlugin from 'system-plugins/dsh-fs/index.js';
import { buildNotesTgz, NOTES_MANIFEST_BYTES } from 'fixtures/dsh-notes.js';
import { NOTES_PLUGIN_SOURCE } from 'fixtures/dsh-notes-source.js';
import { buildBadgeTgz, BADGE_MANIFEST_BYTES } from 'fixtures/dsh-badge.js';

const SCENARIO = 'm3.android-install';
const log = createLogger('m3.spike');
const emit = (event, fields = {}) => log.info('e2e', { scenario: SCENARIO, event, ...fields });
const onStep = (name, fields) => emit(`install.${name}`, fields);
const fail = (reason) => {
  log.debug('scenario failed', { reason });
  emit('scenario.failed', { reason });
  globalThis.__dshComplete(false, reason);
};
const demand = (cond, reason) => {
  if (cond) return;
  log.debug('demand failed', { reason });
  fail(reason);
  throw new Error(reason);
};

const toText = (bytes) => [...bytes].map((c) => String.fromCharCode(c)).join('');
const toBytes = (text) => Uint8Array.from([...text].map((c) => c.charCodeAt(0)));
const PKG_DIR = 'e2e/packages';
const NOTE_TEXT = 'hello from dsh-notes';

/** The negsub fixture (driver-authored, android-only): a well-formed package
 * whose manifest REQUIRES `subprocess` — a capability this host's descriptor
 * honestly does not offer. Its entry source is never executed. */
const NEGSUB_MANIFEST = {
  schemaVersion: 1,
  id: 'dsh-negsub',
  version: '0.1.0',
  type: 'service',
  entry: 'index.js',
  capabilities: { required: ['fsRead', 'fsWrite', 'subprocess'], optional: [] },
};
const NEGSUB_SOURCE = '// never executed - the install is rejected at negotiation\n';

let carrierPort = 0;
let notesResult = null;
let badgeResult = null;

/** Renders one UI stage on the host screen via the bus (human evidence —
 * never a checker input); the ui.stage event IS a checker-asserted step. */
const uiStage = (stage, fields, lines) => {
  emit('ui.stage', { stage, ...fields });
  globalThis.__dshBusPost(JSON.stringify({ type: 'ui', stage, lines }));
};

/** Hands one package to the carrier: bytes into the app scope under
 * e2e/packages/, served at /gateway-e2e/pkg/<name> by CarrierServer. */
const servePackage = async (name, bytes) => {
  const path = `${PKG_DIR}/${name}`;
  log.debug('serve package', { path, bytes: bytes.length });
  const wrote = await fsWrite('app', path, bytes);
  demand(wrote.written === bytes.length, `package write drifted: ${name}`);
  emit('package.stored', { path, written: bytes.length });
};

/** One on-device install transaction: the package rides the REAL gateway
 * httpFetch from the loopback carrier into installFromFetch. A capability
 * rejection resolves to null (the negative leg asserts the fallout). */
const fetchInstall = async (name, bytes, trust, txId, journal) => {
  log.debug('fetch install', { name, txId, journal });
  const path = `/gateway-e2e/pkg/${name}`;
  emit('install.fetch.url', { host: '127.0.0.1', path, live: carrierPort > 0 });
  return await installFromFetch({
    fetchImpl: httpFetch,
    url: `http://127.0.0.1:${carrierPort}${path}`,
    id: name.replace(/-0\.1\.0\.tar$/, ''),
    trust,
    txId,
    on: onStep,
    journal,
  }).catch((err) => {
    if (err instanceof InstallRejected && err.code === 'capability') {
      emit('install.capability-rejected', { missing: err.detail.missing, required: 3 });
      return null;
    }
    throw err;
  });
};

/** Phase 1: dsh-notes through the carrier + the REAL httpFetch; receipt
 * asserted through the gateway fs, then rendered (UI stage `receipt`). */
const notesPhase = async (registry) => {
  log.debug('notes phase begin');
  registry.install({ manifest: fsPlugin.manifest, module: fsPlugin });
  emit('fs.ready', { service: 'fs' });
  const packageBytes = buildNotesTgz();
  emit('fixture.built', { members: 2, bytes: packageBytes.length });
  await servePackage('dsh-notes-0.1.0.tar', packageBytes);
  const trust = {
    blobSha256: sha256Hex(packageBytes),
    manifestSha256: sha256Hex(NOTES_MANIFEST_BYTES),
  };
  notesResult = await fetchInstall('dsh-notes-0.1.0.tar', packageBytes, trust, 'm3-a001', true);
  const receipt = JSON.parse(toText((await fsRead('app', notesResult.receiptPath)).bytes));
  demand(receipt.status === 'committed' && receipt.id === 'dsh-notes'
    && receipt.version === '0.1.0' && receipt.blobSha256 === notesResult.digest,
  'notes receipt fields drifted');
  const journal = await readJournal();
  demand(journal.length === 2 && journal[0].receipt.status === 'pending'
    && journal[1].receipt.status === 'committed', 'notes journal order drifted');
  emit('install.receipt.asserted', {
    status: receipt.status, id: receipt.id, version: receipt.version,
    blobSha256: receipt.blobSha256, journalLines: journal.length,
  });
  uiStage('receipt', { id: receipt.id, version: receipt.version, status: receipt.status }, [
    'install receipt (tx m3-a001)',
    `package: ${receipt.id}@${receipt.version}`,
    `status:  ${receipt.status}`,
    `blob:    ${receipt.blobSha256.slice(0, 16)}...`,
    'fetched over the real gateway httpFetch, served by the loopback carrier',
  ]);
  return receipt;
};

/** Phase 2: dsh-badge (requires `notify`) — the negotiation POSITIVE leg:
 * the device's honest nine-primitive descriptor offers notify, so the same
 * package the CLI rejects installs cleanly on-device. */
const badgePhase = async () => {
  log.debug('badge phase begin');
  const badgeBytes = buildBadgeTgz();
  emit('install.badge.built', { bytes: badgeBytes.length });
  await servePackage('dsh-badge-0.1.0.tar', badgeBytes);
  const trust = {
    blobSha256: sha256Hex(badgeBytes),
    manifestSha256: sha256Hex(BADGE_MANIFEST_BYTES),
  };
  badgeResult = await fetchInstall('dsh-badge-0.1.0.tar', badgeBytes, trust, 'm3-a002', true);
  const receipt = JSON.parse(toText((await fsRead('app', badgeResult.receiptPath)).bytes));
  demand(receipt.status === 'committed' && receipt.id === 'dsh-badge'
    && receipt.version === '0.1.0', 'badge receipt drifted');
  emit('install.badge.receipt.asserted', {
    status: receipt.status, id: receipt.id, version: receipt.version,
    treeSha256: receipt.treeSha256,
  });
};

/** Phase 3: the negotiation NEGATIVE leg — dsh-negsub requires `subprocess`,
 * which this host does not offer; rejected BEFORE unpack, nothing staged,
 * the journal untouched, the installed tree intact. */
const negsubPhase = async () => {
  log.debug('negsub phase begin');
  const manifestBytes = toBytes(`${JSON.stringify(NEGSUB_MANIFEST, null, 2)}\n`);
  const bytes = tarWrite([
    { path: 'manifest.json', bytes: manifestBytes },
    { path: 'bundle/index.js', bytes: toBytes(NEGSUB_SOURCE) },
  ]);
  emit('install.negfixture.built', { bytes: bytes.length });
  await servePackage('dsh-negsub-0.1.0.tar', bytes);
  const trust = { blobSha256: sha256Hex(bytes), manifestSha256: sha256Hex(manifestBytes) };
  const rejected = await fetchInstall('dsh-negsub-0.1.0.tar', bytes, trust, 'm3-a003', false);
  demand(rejected === null, 'an under-privileged package must be rejected');
  try {
    await fsRead('app', 'plugins/.staging-m3-a003/manifest.json');
    demand(false, 'a capability-rejected package must not stage');
  } catch (err) {
    demand(err.code === 'io', `expected io error, got ${err.code}`);
  }
  demand((await readJournal()).length === 4, 'a rejected install must not touch the journal');
  const still = (await fsRead('app', `${notesResult.pkgDir}/manifest.json`)).bytes;
  demand(sha256Hex(still) === notesResult.integrity.manifestSha256,
    'rejection touched the installed tree');
  emit('install.tree.intact', { verified: true });
};

/** Phase 4: crash-simulated pending receipts replayed at "startup" (§4) —
 * the verifiable staged tree completes, the interrupted one rolls back. */
const replayPhase = async () => {
  log.debug('replay phase begin');
  const files = {
    'manifest.json': NOTES_MANIFEST_BYTES,
    'bundle/index.js': toBytes(NOTES_PLUGIN_SOURCE),
  };
  const common = { manifest: notesResult.manifest, files, blobBytes: null };
  await simulateCrash({ txId: 'm3-a004', ...common, blobBytes: buildNotesTgz() });
  emit('crash.simulated', { txId: 'm3-a004', mode: 'staged-verifies', files: 2 });
  await simulateCrash({ txId: 'm3-a005', ...common, blobBytes: buildNotesTgz(), omit: ['bundle/index.js'] });
  emit('crash.simulated', { txId: 'm3-a005', mode: 'staging-incomplete', files: 1 });
  const summary = await replayPendingReceipts({
    on: (name, fields) => emit(`replay.${name}`, fields),
  });
  demand(summary.committed === 1 && summary.rolledBack === 1, 'replay summary drifted');
  const replayed = JSON.parse(toText((await fsRead(
    'app', 'plugins/dsh-notes@0.1.0/integrity.json')).bytes));
  demand(sha256Hex(NOTES_MANIFEST_BYTES) === replayed.manifestSha256,
    'replayed tree drifted');
  const journal = await readJournal();
  const lastFor = (txId) => journal.filter((e) => e.txId === txId).pop();
  demand(lastFor('m3-a004').receipt.status === 'committed',
    'replayed transaction must end committed');
  demand(lastFor('m3-a005').receipt.status === 'rolled-back',
    'interrupted transaction must roll back');
  emit('replay.receipt.asserted', {
    txId: 'm3-a004', status: 'committed', journalLines: journal.length,
  });
  const still = (await fsRead('app', `${notesResult.pkgDir}/manifest.json`)).bytes;
  demand(sha256Hex(still) === notesResult.integrity.manifestSha256,
    'rollback touched the installed tree');
  emit('replay.tree.intact', { verified: true });
};

/** Phase 5: load the INSTALLED entry through the ESM loader and exercise the
 * notes service over dsh-fs (UI stage `notes`). */
const loadPhase = async (registry) => {
  log.debug('load phase begin', { moduleId: notesResult.moduleId });
  globalThis.__dshModuleDefine(notesResult.moduleId, toText(notesResult.entrySource));
  const notesModule = await import(notesResult.moduleId);
  registry.install({ manifest: notesResult.manifest, module: notesModule });
  emit('installed.loaded', { id: notesResult.manifest.id, moduleId: notesResult.moduleId });
  const notes = registry.service('notes');
  const wrote = await notes.write('app', 'notes/first.txt', NOTE_TEXT);
  demand(wrote.written === NOTE_TEXT.length, 'note write byte count drifted');
  emit('notes.write.ok', { path: 'm3-install/notes/first.txt', written: wrote.written });
  const got = await notes.read('app', 'notes/first.txt');
  demand(got.text === NOTE_TEXT, 'note roundtrip drifted');
  emit('notes.read.ok', { text: got.text });
  uiStage('notes', { text: got.text, acknowledged: true }, [
    'installed entry loaded via __dshModuleDefine',
    `notes.write ok (${wrote.written} bytes)`,
    `notes.read: "${got.text}"`,
    'acknowledged by the host UI',
  ]);
};

/** Phase 6: the config layer resolves the session stack (base → hostFace →
 * profile → overlay) and the slot gate enforces the resolved allow-set. */
const configPhase = () => {
  log.debug('config phase begin');
  const { config, trace } = resolveConfig([
    { name: 'base', patch: { webClient: 'dsh-web-client', slots: { allow: ['notes.toolbar', 'debug.console'] } } },
    { name: 'hostFace', patch: {} }, // the android launch passes no client argument
    { name: 'profile', patch: { webClient: 'dsh-web-client-mini', slots: { allow: ['notes.toolbar'] } } },
    { name: 'overlay', patch: {} },
  ]);
  for (const { layer, keys } of trace) emit('config.layer', { layer, keys });
  demand(config.webClient === 'dsh-web-client-mini', 'profile did not select the mini client');
  emit('config.resolved', {
    webClient: config.webClient, slots: config.slots.allow, format: 'cordis.patch.json',
  });
  demand(slotAllowed(config, 'notes.toolbar'), 'configured slot refused');
  emit('config.slot.allowed', { id: 'notes.toolbar' });
  demand(!slotAllowed(config, 'debug.console'), 'profile override did not trim the slot set');
  emit('config.slot.denied', { id: 'debug.console', allow: config.slots.allow });
  emit('config.applied', { webClient: config.webClient, slot: 'notes.toolbar', admitted: true });
};

const main = async () => {
  log.debug('main begin');
  const registry = createRegistry();
  await notesPhase(registry);
  await badgePhase();
  await negsubPhase();
  await replayPhase();
  await loadPhase(registry);
  configPhase();
  emit('install.completed', { status: 'pass', committed: 2, rejected: 1, rolledBack: 1 });
  globalThis.__dshComplete(true, 'ok');
};

if (!globalThis.__dshGatewayNegotiate('gateway@1')) {
  fail('gateway negotiation failed');
} else {
  emit('gateway.negotiated', { version: 'gateway@1' });
  const desc = JSON.parse(globalThis.__dshGatewayDescriptor());
  emit('descriptor.declared', {
    available: desc.available.length, unavailable: desc.unavailable.length,
  });
  // The carrier port arrives as a gateway event after eval + first pump —
  // the driver parks here until the host announces the loopback endpoint.
  let started = false;
  onEvent((ev) => {
    if (started || ev?.event !== 'carrier.ready') return;
    started = true;
    carrierPort = ev.port ?? 0;
    log.debug('carrier ready', { port: carrierPort });
    main().catch((err) => fail(`uncaught: ${err?.message ?? err}`));
  });
}
