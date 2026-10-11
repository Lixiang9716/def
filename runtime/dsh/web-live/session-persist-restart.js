// dsh:logging-exempt (boot module; logging happens through the mounted logger)
/**
 * session-persist-restart.js — the iOS entry of the restart family: the
 * shared self-staging core (web-live/session-persist-restart-core.js) with
 * this host's scenario id + session identity. The FULL log budget applies
 * (no logcat-style line cap on this host), so `runtime.booted` carries the
 * complete entry list — the b3 sibling's split, kept.
 */
import { runSessionPersistRestart } from 'web-live/session-persist-restart-core.js';

runSessionPersistRestart({
  scenario: 'session-persist.restart',
  sessionId: 's-ios-persist-0001',
  logTag: 'ios.persist',
  bootedEntries: 'list',
}).catch((error) => globalThis.__dshComplete(false,
  `session-persist.restart boot: ${error?.message ?? error}`));
