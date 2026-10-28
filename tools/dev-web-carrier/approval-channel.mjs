// dsh:logging-exempt (node-side driver: console IS the product)
/**
 * approval-channel.mjs — the in-band approval transport (split from
 * real-seat.mjs at the code-size gate): the seat's presentApproval arm
 * parks an ask here, the ask fans out to the app/cards subscribers, and
 * the approval/decide endpoint completes the parked promise with the
 * page's answer.
 */
const subscribers = new Set();
const pending = new Map();
let seq = 0;

let emit = null;

/** Wire the fan-out (real-seat hands its subscriber-send). */
export const wireApprovalEmit = (send) => { emit = send; };

export const subscribeApproval = (streamId) => subscribers.add(streamId);
export const pruneApproval = (streamId) => subscribers.delete(streamId);

/** Park one approval ask and fan the frame out; resolves on the page's
 * decision. The caller owns any timeout posture. */
export const parkApproval = (ask) => new Promise((resolve) => {
  const id = `approval-${++seq}-${Date.now()}`;
  pending.set(id, resolve);
  emit?.({ type: 'approval.request', id, ...ask });
});

/** The approval/decide endpoint's resolver: completes the parked arm.
 * False = no pending ask under that id. */
export const decideApproval = (id, approved) => {
  const resolve = pending.get(id);
  if (resolve === undefined) return false;
  pending.delete(id);
  resolve({ approved: approved === true });
  return true;
};
