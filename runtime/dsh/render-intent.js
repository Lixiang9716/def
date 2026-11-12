/**
 * render-intent.js — the platform-neutral face DISPATCH layer (R3, T-0290):
 * the ONE seam every native render payload crosses between a producer
 * (a plugin's card posts, the question bridge's ask, a tool presenter's
 * #764 view, a gateway caller's approval/picker/notify request) and the
 * bus rows the hosts already consume (`globalThis.__dshBusPost` — iOS
 * SessionServe.runtimeBusPosted, Android's bus sink, harmony's carrier).
 *
 *   face type → schemaVersion → payload validation → bus row.
 * The validation itself is pure (face-schemas.js — the `face.*@1` family);
 * this layer owns the crossings: the post, the ONE structured degrade warn
 * per rule (`face.degrade`, warn survives release L4 — never a crash,
 * never a silent drop), and the ACTION INBOX (D8): hosts deliver their
 * user-action frames (`card.action`, `question.answer`) as events and
 * producers subscribe (`onAction` / `awaitAction`) — never polling, never
 * shared surface state. At most one terminal action per card id (`close`
 * beats a pending `button`); frames arrive sequenced by occurrence.
 *
 * The irreducible boundary (proposal §6): presentApproval/presentPicker/
 * notify results stay byte-for-byte frozen. This layer validates and
 * forwards the REQUEST payloads only (approvalPayload/pickerPayload/
 * notifyPayload); the primitives' own fail-loud refusals are untouched.
 */
import { createLogger } from './logger.js';
import {
  FACE_VERSION, validateIntent, toolViewFace,
} from './face-schemas.js';

export { FACE_VERSION } from './face-schemas.js';
export {
  validateIntent, approvalPayload, pickerPayload, notifyPayload, toolViewFace,
} from './face-schemas.js';

const log = createLogger('dsh.render-intent');

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One structured degrade warn — the ladder's honest voice. `rule` names
 * the ladder step; every other field is evidence. Never throws (the sink
 * is optional-chained; the logger itself cannot throw). */
const degrade = (rule, fields = {}) => {
  log.warn('face.degrade', { rule, ...fields });
};

/** The `close`-is-terminal rule: one terminal card action per id (a close
 * beats a pending button — the v1 order guarantee). */
const cardActionEvent = (msg, closedCards) => {
  log.debug('card action frame', { id: msg?.id ?? null, action: msg?.action ?? null });
  const id = typeof msg.id === 'string' ? msg.id : '';
  const action = typeof msg.action === 'string' ? msg.action : '';
  if (id === '' || !['close', 'drag-end', 'button'].includes(action)) {
    degrade('action-invalid', { frame: 'card.action', id, action });
    return null;
  }
  if (action === 'close') {
    if (closedCards.has(id)) {
      degrade('action-terminal-repeat', { frame: 'card.action', id, action });
      return null;
    }
    closedCards.add(id);
  }
  return { type: 'card.action', id, action,
    actionId: typeof msg.actionId === 'string' ? msg.actionId : undefined,
    at: typeof msg.at === 'number' ? msg.at : Date.now() };
};

/** One host→runtime action frame → the inbox's event shape (null = the
 * frame fed nothing: invalid, or not an action face). */
const actionEventOf = (msg, closedCards) => {
  log.debug('deliver action', { type: msg?.type ?? null });
  if (!isPlainObject(msg)) return null;
  if (msg.type === 'card.action') return cardActionEvent(msg, closedCards);
  if (msg.type === 'question.answer') {
    const outcome = msg.outcome === 'cancelled' ? 'cancelled' : 'answered';
    return { type: 'question.answer', id: typeof msg.id === 'string' ? msg.id : '',
      outcome, answers: Array.isArray(msg.answers) ? msg.answers : [] };
  }
  return null;
};

/** Fan one event out to its type's subscribers, in occurrence order; a
 * throwing handler degrades (never takes the sequence down with it). */
const emitTo = (subscribers, event) => {
  log.debug('action event', { type: event.type, id: event.id ?? null });
  for (const sub of [...subscribers]) {
    if (sub.type !== event.type) continue;
    try {
      sub.fn(event);
    } catch (error) {
      degrade('handler-threw', { type: event.type,
        error: String(error).slice(0, 80) });
    }
  }
};

/** The subscription registry: subscribe/unsubscribe around one array. */
const makeSubscribers = (subscribers) => (type, fn) => {
  log.debug('on action', { type });
  const sub = { type, fn };
  subscribers.push(sub);
  return () => {
    const at = subscribers.indexOf(sub);
    if (at >= 0) subscribers.splice(at, 1);
  };
};

/** Validated dispatch to the seat's sink: the one crossing every bus face
 * frame makes (refused frames never post; every degradation warns once). */
const makeDispatch = (sink) => (intent) => {
  log.debug('dispatch', { type: intent?.type ?? null });
  const { ok, intent: validated, degradations } = validateIntent(intent);
  for (const d of degradations) degrade(d.rule, d);
  if (!ok) return { posted: false, degradations };
  sink(validated);
  return { posted: true, degradations };
};

/** installBus wiring: action frames feed the inbox handler first, every
 * other line flows to the previous handler untouched. */
const chainBus = (handleLine) => {
  log.debug('chain bus handler', {});
  const previous = globalThis.__dshBusOnMessage;
  globalThis.__dshBusOnMessage = (line) => {
    let msg = null;
    try {
      msg = JSON.parse(line);
    } catch { msg = null; }
    const isAction = isPlainObject(msg)
      && (msg.type === 'card.action' || msg.type === 'question.answer');
    if (isAction) {
      handleLine(line);
      return;
    }
    if (typeof previous === 'function') previous(line);
  };
};

/** The bounded await: resolves the next matching event, or null when the
 * deadline passes (absence is an answer, never a hang; D8's no-blocking
 * discipline keeps the deadline producer-side). */
const awaitEvent = (onAction, type, timeoutMs, match) => {
  log.debug('await action', { type, timeoutMs });
  return new Promise((resolve) => {
    let done = false;
    const off = onAction(type, (event) => {
      if (done || (match !== null && !match(event))) return;
      done = true;
      off();
      clearTimeout(timer);
      resolve(event);
    });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      off();
      resolve(null);
    }, timeoutMs);
  });
};

/** The tool-view presenter (#764 vocabulary → face.card@1): mints the
 * card id, maps call views to card.present and result views to
 * card.complete, degrades alien shapes to a refusal + one warn. */
const makeToolPresenter = (dispatch) => {
  let toolSeq = 0;
  return (view) => {
    log.debug('present tool view', { card: view?.card ?? null });
    const face = toolViewFace(view);
    if (face === null) {
      if (view !== undefined && view !== null) {
        degrade('view-alien', { frame: 'tool.view',
          shape: JSON.stringify(view)?.slice(0, 60) ?? String(view) });
      }
      return { posted: false, degradations: [] };
    }
    const id = `tool-${Date.now()}-${++toolSeq}`;
    const outcome = face.frame === 'card.present'
      ? dispatch({ type: 'card.present', schemaVersion: FACE_VERSION,
        card: { id, ...face.card } })
      : dispatch({ type: 'card.complete', schemaVersion: FACE_VERSION,
        id, message: face.message });
    return { ...outcome, id };
  };
};

/** The bus entry hosts deliver through (installBus wires this as
 * `__dshBusOnMessage`): action frames feed the inbox first — a
 * `question.answer` ALSO resolves the question bridge's parked ask —
 * everything else flows to the previous handler untouched. */
const makeBusHandler = (deliver) => (line) => {
  log.debug('bus line', {});
  let msg = null;
  try {
    msg = JSON.parse(line);
  } catch {
    degrade('bus-line-unparsable', { head: String(line).slice(0, 60) });
    return;
  }
  const isAction = isPlainObject(msg)
    && (msg.type === 'card.action' || msg.type === 'question.answer');
  if (!isAction) return;
  deliver(msg);
  if (msg.type === 'question.answer') {
    globalThis.__dshQuestionAnswer?.(
      typeof msg.id === 'string' ? msg.id : '',
      Array.isArray(msg.answers) ? msg.answers : [],
      msg.outcome === 'cancelled' ? 'cancelled' : 'answered');
  }
};

/**
 * Mount the dispatch layer. `post` defaults to the bus (`__dshBusPost`,
 * JSON-stringified — the channel hosts already consume);
 * `installBus: true` chains `globalThis.__dshBusOnMessage` so host-delivered
 * action frames reach the inbox (card-player-style seats; the composer seat
 * keeps its own dispatch and settles through the question bridge). A second
 * mount REPLACES the global (the newest seat owns the layer) — mounts are
 * per-seat, at boot, before any delivery.
 */
export const mountRenderIntent = ({ post, installBus = false } = {}) => {
  log.debug('mount render intent', { installBus });
  const sink = post ?? ((msg) => {
    globalThis.__dshBusPost?.(JSON.stringify(msg));
  });
  const subscribers = [];
  const closedCards = new Set();
  const deliver = (msg) => {
    const event = actionEventOf(msg, closedCards);
    if (event === null) return false;
    emitTo(subscribers, event);
    return true;
  };
  const onAction = makeSubscribers(subscribers);
  const dispatch = makeDispatch(sink);

  const api = {
    FACE_VERSION,
    dispatch,
    /** face.card@1 producers: present/state/complete/dismiss, schemaVersion
     * defaulted to the family version this layer speaks. */
    presentCard: (card) =>
      dispatch({ type: 'card.present', schemaVersion: FACE_VERSION, card }),
    cardState: (id, state) =>
      dispatch({ type: 'card.state', schemaVersion: FACE_VERSION, id, state }),
    cardComplete: (id, message) =>
      dispatch({ type: 'card.complete', schemaVersion: FACE_VERSION, id, message }),
    cardDismiss: (id) =>
      dispatch({ type: 'card.dismiss', schemaVersion: FACE_VERSION, id }),
    /** face.question@1: the ask (options normalized to {id, label}). */
    presentQuestion: (request) =>
      dispatch({ type: 'question.request', schemaVersion: FACE_VERSION, ...request }),
    presentToolView: makeToolPresenter(dispatch),
    deliverAction: deliver,
    onAction,
    awaitAction: (type, timeoutMs = 4000, match = null) =>
      awaitEvent(onAction, type, timeoutMs, match),
    handleBusLine: makeBusHandler(deliver),
  };

  if (installBus) chainBus(api.handleBusLine);

  globalThis.__dshRenderIntent = api;
  return api;
};

/** The producers' entry: the seat's mounted layer, lazily default-mounted
 * on the bus (a plugin template or the question bridge on a seat that
 * never mounted explicitly still crosses the ONE seam). */
export const renderIntent = () =>
  globalThis.__dshRenderIntent ?? mountRenderIntent();
