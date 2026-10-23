// dsh:logging-exempt (read-only store face: it answers from the gateway-fs
// file its wire twin web-write-llm.js serves — nothing here logs)
/**
 * upstream/credentials-store.js — the `credentials` service the vendored
 * dsh-llm-pi-ai reads FIRST when resolving a route's apiKeyEnv ref
 * (`ctx.get('credentials')` before process.env — pi-ai lib/index.js:2641-2648)
 * and credentialStoreFrom's record face (:2070-2099). The backend IS the wire
 * store: the flat `{ref: value}` JSON document the settings-models handlers
 * write through the gateway fs (web-write-llm.js STORE_PATH — the app-scope
 * `credentials.json`), so a stored ref shadows the staged route value.
 * @deepseek-ai/dsh-credentials is outside the device closure, so the service
 * extends cordis' Service and keeps only the faces pi-ai calls.
 */
import { decodeUtf8 } from 'node:buffer';
import { Service } from '@deepseek-ai/cordis';
import { fsRead } from '../gateway.js';

// Mirrors (same wire vocabulary as web-write-llm.js STORE_PATH / REF_PATTERN).
const STORE_PATH = 'credentials.json';
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** web-write-llm.js readStore's face: an absent file is an empty store; a
 * file that fails to parse fails loud naming the store (rule 5) — a real
 * Error, since this face is consumed in-process, not serialized by the wire. */
const readStore = async () => {
  let raw;
  try {
    raw = (await fsRead('app', STORE_PATH)).bytes;
  } catch {
    return {};
  }
  try {
    const store = JSON.parse(decodeUtf8(raw));
    if (store === null || typeof store !== 'object' || Array.isArray(store)) {
      throw new Error('the store is not a JSON object');
    }
    return store;
  } catch (error) {
    throw new Error(`the credential store ${STORE_PATH} is unreadable: ${error.message}`);
  }
};

/** `resolve`: a stored ref answers `{value}` (pi-ai reads `resolve(ref)?.value`),
 * an absent file or unknown ref answers undefined (pi-ai falls to process
 * env), and an out-of-grammar ref fails loud naming it (rule 5 — the write
 * face refuses such refs, so one arriving here is a broken caller, never an
 * empty answer). readRecord/listRecords are credentialStoreFrom's
 * nothing-stored fallbacks: a flat ref file holds no records, and the
 * vendored reader treats both answers as "not stored"
 * (toPiCredential(undefined) → undefined, pi-ai lib/index.js:2013-2014). */
export class CredentialsStore extends Service {
  constructor(ctx) {
    super(ctx, 'credentials');
  }

  async resolve(ref) {
    if (typeof ref !== 'string' || !REF_PATTERN.test(ref)) {
      throw new Error(`credentials resolve ref must match ${REF_PATTERN}, got ${JSON.stringify(ref)}`);
    }
    const value = (await readStore())[ref];
    return value === undefined ? undefined : { value };
  }

  async readRecord() {
    return undefined;
  }

  async listRecords() {
    return [];
  }
}
