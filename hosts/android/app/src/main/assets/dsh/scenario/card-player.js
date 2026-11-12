/**
 * Scenario `card.player` — PR-1 of the create-approve-hotmount-native
 * loop: a plugin's card speaks bus lines (`card.present` / `card.state` /
 * `card.complete`) and the host's NATIVE CardPlayerSurface renders them in
 * the app's own chrome — the plugin manifests in the app, NOT as an HTML
 * page (the owner's explicit product bar).
 *
 * The ticks deliberately ride the gateway timer seam (contract v1.4.0 §5):
 * one-shot `timerSchedule` arms in a re-arm loop — NO setInterval (the
 * contract is one-shot by design) — so this leg doubles as the iOS timer
 * primitive's first functional proof: a denied arm would fail the run loud
 * (the shim's arm/failed warn), and a fire that never lands would hang the
 * loop and miss the deadline.
 *
 * R3 (face.card@1 pilot): the posts cross the face dispatch layer
 * (render-intent.js — schemaVersion:1 declared, declarative `actions` on
 * the present, validation at the seam) and the leg listens for the
 * `card.action` round-trip (D8: the host's user action returns as an event
 * over the SAME inbox the question answer uses). The iOS drive fires the
 * scripted button (`-dsh-script-card-action button:<id>`) after complete;
 * hosts without action surfaces (the deferred batches) produce no event —
 * the leg completes either way, so the one scenario serves every seat.
 */
import { createLogger } from '../logger.js';
import { scenarioModule } from '../transport-tokens.mjs';
import { mountRenderIntent } from 'render-intent.js';
import 'upstream/shims/timers.js';

const SCENARIO = 'card.player';
const log = createLogger(scenarioModule);
const emit = (event, fields = {}) => log.info('e2e', { scenario: SCENARIO, event, ...fields });
const fail = (reason) => {
  log.debug('scenario failed', { reason });
  emit('scenario.failed', { reason });
  globalThis.__dshComplete(false, reason);
};

const FOCUS_MS = 25 * 60 * 1000;
const TICKS = 5;
const ACTION_WINDOW_MS = 2200; // covers the iOS scripted tap at complete+1s
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

emit('card.player.begin', {});
if (!globalThis.__dshGatewayNegotiate('gateway@1')) {
  fail('gateway negotiation failed');
} else {
  emit('card.seat.ready', { gateway: 'gateway@1' });

  // The face dispatch layer with the action inbox on the bus chain: the
  // host's card.action deliveries arrive as events (never polled).
  const faces = mountRenderIntent({ installBus: true });
  let actionEvent = null;
  const offAction = faces.onAction('card.action', (event) => {
    if (event.id === 'pomodoro-demo' && actionEvent === null) actionEvent = event;
  });

  faces.presentCard({
    id: 'pomodoro-demo', kind: 'timer', title: '番茄时钟 · 专注',
    subtitle: '25 分钟专注回合', durationMs: FOCUS_MS,
    actions: [{ id: 'snooze', label: '稍后再看' }],
  });
  emit('card.present.posted', { id: 'pomodoro-demo', durationMs: FOCUS_MS });

  for (let tick = 1; tick <= TICKS; tick++) {
    await sleep(1000); // the re-arm loop: one-shot arms, §5 fires resolve
    const remainingMs = FOCUS_MS - tick * 1000;
    faces.cardState('pomodoro-demo', {
      remainingMs, label: `专注中 · 剩 ${Math.ceil(remainingMs / 1000)} 秒`,
    });
    emit('card.state.posted', { tick, remainingMs });
  }

  await sleep(800);
  faces.cardComplete('pomodoro-demo', '本回合完成 · 休息 5 分钟');
  emit('card.complete.posted', { id: 'pomodoro-demo' });
  // The action round-trip window: the pilot host's scripted button fires
  // ~1s after complete (before the 2.5s auto-dismiss); a deferred host
  // stays silent and the leg still settles (absence is an answer).
  await sleep(ACTION_WINDOW_MS);
  offAction();
  if (actionEvent !== null) {
    emit('card.action.received', { id: actionEvent.id, action: actionEvent.action,
      actionId: actionEvent.actionId ?? null });
  }
  emit('card.player.done', { ticks: TICKS });
  emit('scenario.complete', { status: 'pass' });
  globalThis.__dshComplete(true, 'card.player settled');
}
