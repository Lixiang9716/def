// dsh:logging-exempt (boot module; logging happens through the mounted logger)
/**
 * android-session-persist-restart.js — the Android entry of the restart
 * family: the shared self-staging core (web-live/session-persist-restart-
 * core.js) with this host's scenario id + session identity. One Android
 * transport fact (the session-live sibling's): logcat truncates lines at
 * ~4KB, so `runtime.booted` emits `entryCount` instead of the 58-id list.
 */
import { runSessionPersistRestart } from 'web-live/session-persist-restart-core.js';

runSessionPersistRestart({
  scenario: 'android.session-persist.restart',
  sessionId: 's-android-persist-0001',
  logTag: 'android.persist',
  bootedEntries: 'count',
}).catch((error) => globalThis.__dshComplete(false,
  `android.session-persist.restart boot: ${error?.message ?? error}`));
