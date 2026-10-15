// dsh:logging-exempt (test file: assertions ARE the product)
/**
 * publisher-token.test.mjs — the mock v1 publisher-token validator's own
 * net (tools/publisher-token.mjs, design doc: doc/marketplace-publisher-auth.md).
 *
 * Falsify-then-restore: this suite was written and run FIRST against a
 * deliberately rule-less stub (always `{ ok: true }`) — it went RED — and
 * only then against the real validator, which restored it to GREEN. The
 * counterexamples below are that falsification's permanent record: each
 * rule names the violation it catches, so a future edit that drops a rule
 * reopens a named failure instead of a silent pass (rules.md rule 6).
 *
 * Offline by construction: tokens are minted in-process with an HMAC
 * signer over a test secret; no network, no IdP, no publish API. Nothing
 * calls the validator (v1 groundwork only) — but the suite itself runs
 * continuously as a CI step (tools/test/run-tools-tests.sh in the gates
 * workflow), so a validator regression turns CI red (PR #285 review).
 */
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  encodePublisherToken,
  hmacSigner,
  hmacVerifier,
  MAX_TTL_SECONDS,
  validatePublisherToken,
} from './publisher-token.mjs';

const SECRET = 'test-secret-never-a-real-credential';
const NOW = 1_800_000_000; // fixed instant: purity — no Date.now() in assertions
const verifier = hmacVerifier(SECRET);

/** A valid sample publisher token: every claim inside the rules. */
function sampleToken(overrides = {}, sign = hmacSigner(SECRET)) {
  const claims = {
    iss: 'https://idp.dsh.example',
    sub: 'publisher:acme',
    aud: 'dsh-marketplace-publish',
    scope: 'publish',
    iat: NOW - 60,
    exp: NOW + 3_600,
    jti: 'tok-sample-1',
    ...overrides,
  };
  return encodePublisherToken(claims, sign);
}

describe('validatePublisherToken — happy path', () => {
  it('accepts a well-formed, in-window, correctly signed token', () => {
    const r = validatePublisherToken(sampleToken(), { now: NOW, verifySignature: verifier });
    expect(r.ok).toBe(true);
    expect(r.claims.sub).toBe('publisher:acme');
    expect(r.claims.scope).toBe('publish');
  });
});

describe('validatePublisherToken — time rules (each rejects its named violation)', () => {
  it('rejects an expired token', () => {
    const t = sampleToken({ exp: NOW - 1 });
    const r = validatePublisherToken(t, { now: NOW, verifySignature: verifier });
    expect(r).toEqual({ ok: false, reason: 'token expired' });
  });
  it('rejects a token issued in the future', () => {
    const t = sampleToken({ iat: NOW + 120 });
    const r = validatePublisherToken(t, { now: NOW, verifySignature: verifier });
    expect(r).toEqual({ ok: false, reason: 'issued in the future' });
  });
  it('rejects a lifetime over the short-lived ceiling', () => {
    const t = sampleToken({ iat: NOW - 60, exp: NOW - 60 + MAX_TTL_SECONDS + 1 });
    const r = validatePublisherToken(t, { now: NOW, verifySignature: verifier });
    expect(r).toEqual({ ok: false, reason: 'lifetime exceeds short-lived ceiling' });
  });
});

describe('validatePublisherToken — audience and scope rules', () => {
  it('rejects a token bound to another audience', () => {
    const t = sampleToken({ aud: 'some-other-service' });
    const r = validatePublisherToken(t, { now: NOW, verifySignature: verifier });
    expect(r).toEqual({ ok: false, reason: 'audience mismatch' });
  });
  it('rejects a token without the publish scope', () => {
    const t = sampleToken({ scope: 'read' });
    const r = validatePublisherToken(t, { now: NOW, verifySignature: verifier });
    expect(r).toEqual({ ok: false, reason: 'scope does not include publish' });
  });
  it('honors an explicit audience option', () => {
    const t = sampleToken({ aud: 'staging-publish' });
    const r = validatePublisherToken(t, {
      now: NOW,
      audience: 'staging-publish',
      verifySignature: verifier,
    });
    expect(r.ok).toBe(true);
  });
});

describe('validatePublisherToken — signature rule', () => {
  it('rejects a token signed under another secret', () => {
    const t = sampleToken({}, hmacSigner('attacker-secret'));
    const r = validatePublisherToken(t, { now: NOW, verifySignature: verifier });
    expect(r).toEqual({ ok: false, reason: 'bad signature' });
  });
  it('rejects tampered claims that keep the original signature', () => {
    const t = sampleToken();
    const [, payload, sig] = t.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    claims.sub = 'publisher:evil';
    const forged = `dshpub-v1.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${sig}`;
    const r = validatePublisherToken(forged, { now: NOW, verifySignature: verifier });
    expect(r).toEqual({ ok: false, reason: 'bad signature' });
  });
});

describe('validatePublisherToken — malformed envelopes and claims (fail loud, rule 5)', () => {
  const run = (t) => validatePublisherToken(t, { now: NOW, verifySignature: verifier });

  it('rejects non-string input', () => {
    expect(run(undefined)).toEqual({ ok: false, reason: 'malformed: token is not a string' });
  });
  it('rejects a wrong prefix', () => {
    expect(run('bearer-v9.a.b')).toEqual({ ok: false, reason: 'malformed envelope' });
  });
  it('rejects the wrong part count', () => {
    expect(run('dshpub-v1.a')).toEqual({ ok: false, reason: 'malformed envelope' });
    expect(run('dshpub-v1.a.b.c')).toEqual({ ok: false, reason: 'malformed envelope' });
  });
  it('rejects claims that are not JSON', () => {
    const bad = Buffer.from('not json').toString('base64url');
    expect(run(`dshpub-v1.${bad}.sig`)).toEqual({ ok: false, reason: 'malformed claims payload' });
  });
  it('rejects missing or wrongly-typed required claims, each naming its claim', () => {
    // Minted with the real signer: the pilot (test/mutation/) caught the
    // first cut minting with the VERIFIER (whose non-string guard returns
    // false), so every row died at `bad signature` and never reached the
    // claim rules — the pins were vacuous. The reason is asserted per row
    // so a dropped rule reopens a named failure (rules.md rule 6).
    for (const [key, value, reason] of [
      ['iss', '', 'missing claim iss'],
      ['sub', 'acme', 'claim sub is not a publisher subject'], // wrong shape: must be publisher:<name>
      ['scope', '', 'missing claim scope'],
      ['jti', '', 'missing claim jti'],
      ['iat', 'yesterday', 'missing claim iat'],
      ['exp', null, 'missing claim exp'],
    ]) {
      const claims = {
        iss: 'https://idp.dsh.example',
        sub: 'publisher:acme',
        aud: 'dsh-marketplace-publish',
        scope: 'publish',
        iat: NOW - 60,
        exp: NOW + 60,
        jti: 'tok-1',
        [key]: value,
      };
      const t = encodePublisherToken(claims, hmacSigner(SECRET));
      expect(run(t)).toEqual({ ok: false, reason });
    }
  });
});

describe('validatePublisherToken — the sub shape and payload guards (rule C1/C2 inputs)', () => {
  const run = (t) => validatePublisherToken(t, { now: NOW, verifySignature: verifier });

  it('rejects a claims payload whose sub names no publisher', () => {
    const t = sampleToken({ sub: 'user:someone' });
    expect(run(t)).toEqual({ ok: false, reason: 'claim sub is not a publisher subject' });
  });
  it('rejects a sub that merely contains a publisher subject (both anchors hold)', () => {
    // Without ^ a trailing `publisher:acme` would pass; without $ any
    // suffix would. Each anchor gets its own violator.
    expect(run(sampleToken({ sub: 'xpublisher:acme' })))
      .toEqual({ ok: false, reason: 'claim sub is not a publisher subject' });
    expect(run(sampleToken({ sub: 'publisher:acme/evil' })))
      .toEqual({ ok: false, reason: 'claim sub is not a publisher subject' });
  });
  it('rejects a claims payload that is JSON but not an object', () => {
    // The F2 shape guard: null, an array, and a bare string are each
    // refused as malformed payloads — never flowed into the claim rules
    // (a null claims would throw inside claimDefect).
    for (const raw of ['null', '[1,2]', '"str"']) {
      const bad = Buffer.from(raw).toString('base64url');
      expect(run(`dshpub-v1.${bad}.sig`)).toEqual({ ok: false, reason: 'malformed claims payload' });
    }
  });
  it('rejects a non-finite numeric claim (JSON exponents overflow to Infinity)', () => {
    // JSON.parse('1e400') is Infinity — typeof number, not finite. The
    // wire can carry it (hand-rolled payload; JSON.stringify would emit
    // null, so the raw token is spliced in past the sentinel), so the
    // finite guard is pinned on both time claims.
    const payloadWithRaw = (key) => {
      const text = JSON.stringify({
        iss: 'https://idp.dsh.example',
        sub: 'publisher:acme',
        aud: 'dsh-marketplace-publish',
        scope: 'publish',
        jti: 'tok-1',
        iat: NOW - 60,
        exp: NOW + 60,
        [key]: '@@RAW@@',
      }).replace('"@@RAW@@"', '1e400');
      expect(JSON.parse(text)[key]).toBe(Infinity); // the overflow is real
      return Buffer.from(text).toString('base64url');
    };
    expect(run(`dshpub-v1.${payloadWithRaw('iat')}.sig`))
      .toEqual({ ok: false, reason: 'missing claim iat' });
    expect(run(`dshpub-v1.${payloadWithRaw('exp')}.sig`))
      .toEqual({ ok: false, reason: 'missing claim exp' });
  });
});

describe('validatePublisherToken — the time boundaries (the rules are inclusive/exclusive on purpose)', () => {
  const run = (t, opts = {}) => validatePublisherToken(t, { now: NOW, verifySignature: verifier, ...opts });

  it('accepts iat === now (iat <= now is the rule)', () => {
    const r = run(sampleToken({ iat: NOW }));
    expect(r.ok).toBe(true);
  });
  it('rejects exp === now (exp > now is the rule: expiry at the instant)', () => {
    const t = sampleToken({ exp: NOW });
    expect(run(t)).toEqual({ ok: false, reason: 'token expired' });
  });
  it('accepts a lifetime of exactly MAX_TTL_SECONDS (the ceiling is inclusive)', () => {
    const t = sampleToken({ iat: NOW, exp: NOW + MAX_TTL_SECONDS });
    expect(run(t).ok).toBe(true);
  });
});

describe('validatePublisherToken — the verifier seam contract', () => {
  it('refuses to run without a verifier instead of throwing', () => {
    const r = validatePublisherToken(sampleToken(), { now: NOW });
    expect(r).toEqual({ ok: false, reason: 'no signature verifier supplied' });
  });
  it('hmacVerifier returns a strict boolean false for non-string signatures', () => {
    const payload = Buffer.from('{}').toString('base64url');
    expect(hmacVerifier(SECRET)(payload, undefined)).toBe(false);
    expect(hmacVerifier(SECRET)(payload, 123)).toBe(false);
  });
  it('never throws on attacker bytes: a wrong-length signature is a rejection', () => {
    // The length pre-check exists so timingSafeEqual (equal lengths only)
    // never sees a short signature — a validator that throws on attacker
    // bytes is its own vuln (validator docstring).
    const t = `${sampleToken().split('.').slice(0, 2).join('.')}.shortsig`;
    const r = validatePublisherToken(t, { now: NOW, verifySignature: verifier });
    expect(r).toEqual({ ok: false, reason: 'bad signature' });
    expect(hmacVerifier(SECRET)('e30', 'short')).toBe(false);
  });
});
