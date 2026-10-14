// dsh:logging-exempt (boot module; logging happens through the mounted logger)
/**
 * android-session-persist-midturn.js — the Android entry of the MID-TURN
 * KILL leg: the shared core (web-live/session-persist-midturn-core.js) with
 * this host's scenario id + session identity. Transport facts inherited from
 * the restart sibling: no page, no read-surface probe (the web.plugins
 * delivery stays buffered), and the runner's force-stop is launch 1's exit.
 */
import { runSessionPersistMidturn } from 'web-live/session-persist-midturn-core.js';

runSessionPersistMidturn({
  scenario: 'android.session-persist.midturn',
  sessionId: 's-android-persist-midturn-0001',
  logTag: 'android.midturn',
}).catch((error) => globalThis.__dshComplete(false,
  `android.session-persist.midturn boot: ${error?.message ?? error}`));
