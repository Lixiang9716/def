import { describe, it, expect, beforeEach } from 'vitest';
import { installPackage, InstallRejected, validateManifest } from 'install-pipeline.js';
import { tarWrite, tarRead } from 'tar-mini.js';
import { sha256Hex } from 'sha256.js';
import { workspace } from 'gateway.js';

// Install-pipeline path-traversal pins (test-hardening row 18): the package
// is hostile-until-verified data, and its tar entry paths are the classic
// zip-slip vector. The defense is layered and this suite proves each layer
// with a live attack, not by trusting the code:
//
//   1. tar-mini's member guard — runtime/dsh/tar-mini.js:44-49 rejects
//      absolute paths, `..` and empty segments at READ time, and the type
//      gate at tar-mini.js:99-102 accepts regular files only, which kills
//      symlink (typeflag 2), hardlink (1), GNU longname (L) and pax
//      path-override (x) members — the longname/pax tricks being the classic
//      way to smuggle `..` past a 100-byte name field.
//   2. the manifest guard — runtime/dsh/install-pipeline.js:69 (REL_PATH)
//      via :101/:104 keeps manifest.entry inside bundle/. tightened this
//      change: the old class anchored at position 0 only, so interior `..`
//      validated clean (see the regression pin below).
//   3. the gateway boundary — hosts/ios/App/Source/Gateway/FSPrimitives.swift
//      (safeRelative rejects `..`/`.`/absolute) and hosts/android/app/src/
//      main/cpp/dsh_gateway_smoke.c:176 reject any escaped path at the fs
//      primitive itself; the panel shim models the primitive honestly as
//      literal (scope, path) keys, so an escape would SHOW UP here as a
//      workspace key outside the package tree.
//
// Containment invariant asserted after every attempt: the only writes that
// may exist are the content-addressed blob (lands before the trust decision
// by design — install-pipeline.js:197-199), the staging tree, the promoted
// package tree and — only on success — the receipt. Nothing outside
// `plugins/.staging-<tx>/` or `plugins/<id>@<ver>/`, nothing in receipts/
// for a rejected install, and (journal mode) no journal line: a hostile
// package aborts BEFORE the §4 pending marker is ever written.

const BLOCK = 512;
const TX = 'tx-pin-18';
const ID = 'dsh-demo';
const VER = '1.0.0';
const enc = (text) => new TextEncoder().encode(text);

const manifest = (entry = 'main.js') => ({
  schemaVersion: 1, id: ID, version: VER, type: 'service',
  entry, capabilities: { required: [] },
});

const goodPackage = (entry, extraMembers = []) => tarWrite([
  { path: 'manifest.json', bytes: enc(JSON.stringify(manifest(entry))) },
  { path: 'bundle/main.js', bytes: enc('export const dsh = 1;') },
  ...extraMembers,
]);

/** A ustar member header with ATTACKER-controlled typeflag/linkname/size —
 * the bytes a hostile tarball carries, which tar-mini's own writer refuses
 * to produce. Checksum per the format (the chksum field itself sums as
 * spaces), mirroring tar-mini.js:70-72. */
const rawHeader = ({ path, type = '0', linkname = '', size = 0, prefix = '' }) => {
  const head = new Uint8Array(BLOCK);
  const put = (at, text) => {
    for (let i = 0; i < text.length; i++) head[at + i] = text.charCodeAt(i);
  };
  put(0, path);
  put(100, '0000644\0');            // mode
  put(108, '0000000\0');            // uid
  put(116, '0000000\0');            // gid
  put(124, size.toString(8).padStart(11, '0') + '\0');
  put(136, '00000000000\0');        // mtime 0
  put(148, '        ');             // chksum placeholder (spaces)
  head[156] = type.charCodeAt(0);
  put(157, linkname);
  put(257, 'ustar\0');
  put(263, '00');
  put(345, prefix);                 // ustar prefix field
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i < 148 || i >= 156 ? head[i] : 32;
  put(148, sum.toString(8).padStart(6, '0') + '\0 ');
  return head;
};

const padBlock = (bytes) => {
  const rest = bytes.length % BLOCK;
  const out = new Uint8Array(bytes.length + (rest === 0 ? 0 : BLOCK - rest));
  out.set(bytes);
  return out;
};

/** Assemble an archive from raw blocks + the two-block terminator. */
const rawTar = (blocks) => {
  const total = blocks.reduce((n, b) => n + b.length, 0) + BLOCK * 2;
  const out = new Uint8Array(total);
  let at = 0;
  for (const b of blocks) { out.set(b, at); at += b.length; }
  return out;
};

/** The manifest.json + bundle/main.js pair, without the terminator — the
 * benign preamble every hostile archive carries, so the ONLY reason a
 * rejection fires is the hostile member appended after it. */
const benignBlocks = () =>
  tarWrite([
    { path: 'manifest.json', bytes: enc(JSON.stringify(manifest())) },
    { path: 'bundle/main.js', bytes: enc('export const dsh = 1;') },
  ]).subarray(0, -BLOCK * 2);

/** Benign preamble + one hostile raw member + payload + terminator. */
const hostileArchive = (head, payload = enc('pwned')) =>
  rawTar([benignBlocks(), head, padBlock(payload), new Uint8Array(BLOCK * 2)]);

/** The traversal member header for a member path (type regular file). */
const traversalHeader = (path) => rawHeader({ path, size: 5 });

/** One install attempt over the REAL pipeline. Trust is computed honestly
 * from the bytes under test, so a rejection can only come from the guard
 * the assertion names — never from a trust mismatch. */
const attempt = async (bytes, { entry = 'main.js', journal = false } = {}) => {
  const manifestBytes = enc(JSON.stringify(manifest(entry)));
  const trust = { blobSha256: sha256Hex(bytes), manifestSha256: sha256Hex(manifestBytes) };
  try {
    const result = await installPackage({ id: ID, bytes, trust, txId: TX, journal });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, err };
  }
};

// The containment invariant. `ok` installs may additionally hold the receipt
// (the commit point itself); a rejected install may hold NOTHING but the
// content-addressed blob.
const containmentBreaches = ({ ok }) => [...workspace.keys()].filter((key) => {
  if (!key.startsWith('app/')) return true; // nothing may exist outside the app scope
  if (/^app\/cache\/blobs\/[0-9a-f]{64}$/.test(key)) return false; // pre-trust blob, by design
  if (key.startsWith(`app/plugins/.staging-${TX}/`)) return false;
  if (key.startsWith(`app/plugins/${ID}@${VER}/`)) return false;
  if (key === `app/receipts/${TX}.json`) return !ok; // only a committed install owns a receipt
  return true;
});

const pkgTreeKeys = () => [...workspace.keys()]
  .filter((k) => k.startsWith('app/plugins/') || k.startsWith('app/receipts/'));

/** Shared body for a hostile-package leg: assert the rejection names its
 * guard and nothing outside the blob landed. */
const expectRejectedAndContained = async (bytes, message, opts = {}) => {
  const { ok, err } = await attempt(bytes, opts);
  expect(ok).toBe(false);
  expect(err.message).toBe(message);
  expect(containmentBreaches({ ok: false })).toEqual([]);
  expect(pkgTreeKeys()).toEqual([]);
};

beforeEach(() => { workspace.clear(); });

describe('install path traversal: hostile tar members are rejected before any unpack', () => {
  // tarWrite REFUSES to build these (the writer shares the reader's guard),
  // so each case assembles the hostile member by hand.
  const runs = [
    ['../evil.js', 'tar: unsafe member path: ../evil.js'],
    ['bundle/../../evil.js', 'tar: unsafe member path: bundle/../../evil.js'],
    ['a/b/../../../evil.js', 'tar: unsafe member path: a/b/../../../evil.js'],
    ['/etc/evil.js', 'tar: unsafe member path: /etc/evil.js'],
    ['evil//x.js', 'tar: unsafe member path: evil//x.js'],
    ['..//evil.js', 'tar: unsafe member path: ..//evil.js'],
  ];

  for (const [path, message] of runs) {
    it(`member ${JSON.stringify(path)} is named and refused by the tar member guard`, async () => {
      await expectRejectedAndContained(hostileArchive(traversalHeader(path)), message);
    });
  }
});

describe('install path traversal: non-regular member types are refused by the type gate', () => {
  const typeGateCase = (head, message) => async () => {
    await expectRejectedAndContained(hostileArchive(head), message);
  };

  it('a symlink member (typeflag 2, link to /etc/passwd) is refused',
    typeGateCase(
      rawHeader({ path: 'bundle/link', type: '2', linkname: '../../../../etc/passwd' }),
      'tar: unsupported member type: 2',
    ));

  it('a hardlink member (typeflag 1) is refused',
    typeGateCase(
      rawHeader({ path: 'bundle/link', type: '1', linkname: '../../../../etc/passwd' }),
      'tar: unsupported member type: 1',
    ));

  it('a GNU longname member (typeflag L) carrying a traversal path is refused', async () => {
    // The classic longname bypass: GNU tar stores the real path in a
    // type-L member's payload. The type gate kills the member before its
    // payload could ever become a path.
    const longPath = enc('../../../../pwned/evil.js');
    const head = rawHeader({ path: '././@LongLink', type: 'L', size: longPath.length });
    await expectRejectedAndContained(hostileArchive(head, longPath),
      'tar: unsupported member type: L');
  });

  it('a pax extended header (typeflag x) overriding path= is refused', async () => {
    // pax's path= record is the OTHER classic `..` smuggler; same fate.
    const record = enc('path=../../../pwned/evil.js\n');
    const head = rawHeader({ path: 'PaxHeader', type: 'x', size: record.length });
    await expectRejectedAndContained(hostileArchive(head, record),
      'tar: unsupported member type: x');
  });
});

describe('install path traversal: header-field tricks fail closed', () => {
  it('a ustar prefix-field member forges nothing: the entry check fails', async () => {
    // ustar splits long names across prefix(345) + name(0). tar-mini reads
    // ONLY the name field (tar-mini.js:104), so prefix="bundle" +
    // name="main.js" parses as "main.js" — it can never satisfy the
    // bundle/main.js entry lookup.
    const m = enc(JSON.stringify(manifest()));
    const bytes = rawTar([
      rawHeader({ path: 'manifest.json', size: m.length }),
      padBlock(m),
      rawHeader({ path: 'main.js', prefix: 'bundle', size: 19 }),
      padBlock(enc('export const dsh = 1;')),
      new Uint8Array(BLOCK * 2),
    ]);
    const { ok, err } = await attempt(bytes);
    expect(ok).toBe(false);
    expect(err).toBeInstanceOf(InstallRejected);
    expect(err.code).toBe('package');
    expect(err.message).toBe('entry missing from package: bundle/main.js');
    expect(containmentBreaches({ ok: false })).toEqual([]);
    expect(pkgTreeKeys()).toEqual([]);
  });

  it('a NUL-padded name field truncates, never extends: evil\\0../../x reads as evil', () => {
    // The parser stops at the first NUL in the name field (tar-mini.js:104),
    // so padding can only SHORTEN the parsed path — a trailing `../` after
    // the NUL is inert bytes.
    const head = rawHeader({ path: 'evil', size: 5 });
    head.set(enc('\0../../x'), 4); // 'evil' + NUL + traversal padding
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i < 148 || i >= 156 ? head[i] : 32;
    head.set(enc(sum.toString(8).padStart(6, '0') + '\0 '), 148);
    const members = tarRead(rawTar([head, padBlock(enc('pwned')), new Uint8Array(BLOCK * 2)]));
    expect(members).toHaveLength(1);
    expect(members[0].path).toBe('evil');
  });
});

describe('install path traversal: encoding and separator variants cannot decode to `..`', () => {
  it('%2e%2e and backslash spellings stay literal names — no decoder in the chain', () => {
    const members = tarRead(tarWrite([
      { path: '%2e%2e/evil.js', bytes: enc('x') },
      { path: '..%2Fevil.js', bytes: enc('x') },
      { path: '..\\..\\evil.js', bytes: enc('x') },
      { path: '.. ;/evil.js', bytes: enc('x') },
    ]));
    // Every name survived byte-for-byte: nothing decoded %2e or treated
    // backslash as a separator, so none of these can resolve outside the
    // staging tree (the hosts split on '/' alone).
    expect(members.map((m) => m.path)).toEqual([
      '%2e%2e/evil.js', '..%2Fevil.js', '..\\..\\evil.js', '.. ;/evil.js',
    ]);
    for (const m of members) {
      expect(m.path.split('/').some((seg) => seg === '..' || seg === '' || seg === '.')).toBe(false);
    }
  });

  it('a backslash-named member installs INSIDE the package tree, never outside it', async () => {
    // The full-pipeline proof for the separator variant: the file is a
    // literal name inside bundle/ — on this POSIX path algebra it lands in
    // the promoted tree, and the containment invariant holds.
    const bytes = goodPackage('main.js', [{ path: 'bundle/..\\..\\evil.js', bytes: enc('x') }]);
    const { ok, err } = await attempt(bytes);
    expect(ok).toBe(true);
    if (!ok) throw err; // sharpen the failure message if this ever flips
    expect(containmentBreaches({ ok: true })).toEqual([]);
    const dumped = [...workspace.keys()].filter((k) => k.includes('evil')).sort();
    expect(dumped).toEqual([
      `app/plugins/.staging-${TX}/bundle/..\\..\\evil.js`,
      `app/plugins/${ID}@${VER}/bundle/..\\..\\evil.js`,
    ]);
  });
});

describe('install path traversal: the manifest guard keeps the entry inside bundle/', () => {
  it('validateManifest refuses interior `..` segments — the guard stands alone', () => {
    // Regression pin for the REL_PATH tightening: the old class anchored its
    // lookahead at position 0 only, so an interior-`..` entry validated clean
    // and survived into `bundle/${entry}` path construction (fail-closed only
    // because the tar member guard refuses such members — the layer must not
    // HAVE to borrow that).
    expect(validateManifest(manifest('bundle/../../main.js')))
      .toBe('service manifests need an entry path');
    expect(validateManifest(manifest('a/../main.js')))
      .toBe('service manifests need an entry path');
    // Benign spellings stay valid: plain, dot-interior, and a literal name
    // that merely CONTAINS two dots.
    expect(validateManifest(manifest('main.js'))).toBeNull();
    expect(validateManifest(manifest('./main.js'))).toBeNull();
    expect(validateManifest(manifest('a..b/main.js'))).toBeNull();
  });

  const entryRuns = [
    ['../main.js', 'service manifests need an entry path'],
    ['bundle/../../main.js', 'service manifests need an entry path'],
    ['/etc/main.js', 'service manifests need an entry path'],
  ];

  for (const [entry, problem] of entryRuns) {
    it(`manifest entry ${JSON.stringify(entry)} is refused by the REL_PATH guard`, async () => {
      const { ok, err } = await attempt(goodPackage(entry), { entry });
      expect(ok).toBe(false);
      expect(err).toBeInstanceOf(InstallRejected);
      expect(err.code).toBe('manifest');
      expect(err.message).toBe(`manifest invalid: ${problem}`);
      expect(containmentBreaches({ ok: false })).toEqual([]);
      expect(pkgTreeKeys()).toEqual([]);
    });
  }

  it('a hostile package aborts BEFORE the §4 pending journal marker', async () => {
    // journal mode: the pending marker is written only after the package
    // opens (install-pipeline.js:356-359). A traversal member throws inside
    // openPackage — strictly before journalPending — so the journal never
    // gains a line and no rolled-back marker is owed.
    const bytes = hostileArchive(traversalHeader('../evil.js'));
    const { ok } = await attempt(bytes, { journal: true });
    expect(ok).toBe(false);
    expect(workspace.get('app/receipts/journal.jsonl')).toBeUndefined();
    expect(pkgTreeKeys()).toEqual([]);
  });
});
