// dsh:logging-exempt (boot module; logging happens through the mounted logger)
/**
 * harmony-session-persist-restart.js — the HarmonyOS entry of the restart
 * family: the shared self-staging core (web-live/session-persist-restart-
 * core.js) with this host's scenario id + session identity. The full log
 * budget applies (the capture file carries whole lines — no logcat-style
 * cap), so `runtime.booted` carries the complete entry list.
 */
import { runSessionPersistRestart } from 'web-live/session-persist-restart-core.js';

runSessionPersistRestart({
  scenario: 'harmony.session-persist.restart',
  sessionId: 's-harmony-persist-0001',
  logTag: 'harmony.persist',
  bootedEntries: 'list',
}).catch((error) => globalThis.__dshComplete(false,
  `harmony.session-persist.restart boot: ${error?.message ?? error}`));
