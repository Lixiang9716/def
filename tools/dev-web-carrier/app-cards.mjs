// dsh:logging-exempt (node-side driver: console IS the product)
/**
 * app-cards.mjs — the seat-side bridge of the native CardPlayerSurface
 * contract: mounted plugins post card.present/state/complete frames on the
 * bus; the device hosts render them natively, and THIS module forwards them
 * to web pages subscribed through the mux endpoint `app/cards` (latest
 * state replayed on subscribe, so a mid-tick subscriber sees the live card
 * immediately). The frames are the device contract verbatim — no reshaping.
 */
export const createCardPlane = (sendTo) => {
  const subscribers = new Set(); // streamId
  const latest = new Map(); // card id → last frame

  const forward = (msg) => {
    if (msg.type === 'card.present') latest.set(msg.card.id, msg);
    else if (msg.type === 'card.state') {
      const cur = latest.get(msg.id);
      if (cur) latest.set(msg.id, { ...cur, state: msg.state });
    } else if (msg.type === 'card.complete') {
      const cur = latest.get(msg.id);
      if (cur) latest.set(msg.id, { ...cur, complete: msg.message });
    }
    for (const streamId of subscribers) sendTo(streamId, msg);
  };

  /** Seat-side stream endpoint: replay the live cards, then stream. */
  const subscribe = (streamId) => {
    for (const frame of latest.values()) sendTo(streamId, frame);
    subscribers.add(streamId);
  };

  const prune = (streamId) => subscribers.delete(streamId);

  return { forward, subscribe, prune };
};
