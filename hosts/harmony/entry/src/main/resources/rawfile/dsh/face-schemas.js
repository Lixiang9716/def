// dsh:logging-exempt (pure function module — face payload schemas take no
// policy decisions; the mount layer in render-intent.js logs the
// degradations these validators return)
/**
 * face-schemas.js — the `face.*@1` family's pure validation core (R3,
 * T-0290): every validator is a pure (payload, degradations) → payload
 * function — no posts, no throws, no logger. The DRAFT contract
 * (contract/proposals/2026-11-12-native-face-schemas.md) these shapes
 * implement:
 *
 *   - face.card@1 (card.present/state/complete/dismiss bus frames): id
 *     REQUIRED (a missing id is refused, not silently dropped — §5.4's
 *     honesty fix), kind a closed set (unknown → info, §5.1), actions the
 *     v1-add `[{id, label}]`, schemaVersion optional (absent = legacy =
 *     today's exact shape; future versions render legacy + one warn, §5.2).
 *   - face.question@1 (question.request): options normalize to canonical
 *     `{id, label}` (a bare string stays accepted as both) — answers
 *     identify options by id, never by echoed display label.
 *   - face.approval@1 / face.picker@1 / face.notify@1: the REQUEST payload
 *     validators above the irreducible primitives (§6 — the frozen results
 *     never pass through here). `detail` is approval's canonical detail
 *     field; NO `message` alias is blessed (warned + dropped). Picker/notify
 *     drift (unserved mode, missing title) warns and still forwards — the
 *     primitives' own fail-loud refusals are the authority (§5.5).
 *   - toolViewFace: the #764 render-intent vocabulary
 *     (presentCall/presentResult views — vendored presentation.d.ts,
 *     referenced never redefined) mapped onto face.card@1 payloads; alien
 *     shapes degrade to null (presenters degrade, never throw).
 */
export const FACE_VERSION = 1;

/** face.card@1's closed kind set — unknown kinds degrade to `info`. */
const CARD_KINDS = ['info', 'timer'];
/** face.picker@1's served mode set (the frozen §4 prose says two; the
 * family declaration records what every host serves — doc truth). */
const PICKER_MODES = ['file', 'directory', 'media'];

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmptyString = (v) => typeof v === 'string' && v.length > 0;

/** Version gate (§5.2): absent = legacy; ≤ FACE_VERSION passes; above
 * renders legacy + one warn; a non-integer is a bad payload → refused. */
const checkVersion = (msg, degradations) => {
  const raw = msg.schemaVersion;
  if (raw === undefined) return true;
  if (!Number.isInteger(raw) || raw < 1) {
    degradations.push({ rule: 'schema-invalid', frame: msg.type,
      field: 'schemaVersion', value: String(raw) });
    return false;
  }
  if (raw > FACE_VERSION) {
    degradations.push({ rule: 'schema-future', frame: msg.type,
      known: FACE_VERSION, spoke: raw });
  }
  return true;
};

const stringField = (holder, field, frame, degradations) => {
  const value = holder[field];
  if (value === undefined || typeof value === 'string') return value;
  degradations.push({ rule: 'field-type', frame, field, wanted: 'string' });
  return undefined;
};

/** face.card@1 `card.present` — see the module header. Unknown fields pass
 * through untouched (the documented tolerance). */
export const validateCardPresent = (msg, degradations) => {
  const card = msg.card;
  if (!isPlainObject(card)) {
    degradations.push({ rule: 'missing-field', frame: 'card.present', field: 'card' });
    return null;
  }
  if (!nonEmptyString(card.id)) {
    degradations.push({ rule: 'missing-field', frame: 'card.present', field: 'card.id' });
    return null;
  }
  const out = { ...card };
  if (out.kind !== undefined && !CARD_KINDS.includes(out.kind)) {
    degradations.push({ rule: 'kind-unknown', frame: 'card.present',
      kind: String(out.kind), rendered: 'info' });
    out.kind = 'info';
  }
  for (const field of ['title', 'subtitle', 'label']) {
    const value = stringField(out, field, 'card.present', degradations);
    if (value === undefined) delete out[field];
  }
  if (out.durationMs !== undefined && typeof out.durationMs !== 'number') {
    degradations.push({ rule: 'field-type', frame: 'card.present',
      field: 'card.durationMs', wanted: 'number' });
    delete out.durationMs;
  }
  validateCardActions(out, degradations);
  return { ...msg, card: out };
};

/** The v1-add declarative actions: `[{id, label}]` render as buttons on
 * capable hosts; malformed entries drop with one warn per entry. */
const validateCardActions = (card, degradations) => {
  if (card.actions === undefined) return;
  if (!Array.isArray(card.actions)) {
    degradations.push({ rule: 'field-type', frame: 'card.present',
      field: 'card.actions', wanted: 'array' });
    delete card.actions;
    return;
  }
  const clean = [];
  for (const action of card.actions) {
    if (isPlainObject(action) && nonEmptyString(action.id)
        && typeof action.label === 'string') {
      clean.push({ id: action.id, label: action.label });
    } else {
      degradations.push({ rule: 'action-dropped', frame: 'card.present',
        action: JSON.stringify(action)?.slice(0, 60) ?? String(action) });
    }
  }
  if (clean.length === 0) delete card.actions;
  else card.actions = clean;
};

/** `card.state`: id + a state object keeping at least one valid field. */
export const validateCardState = (msg, degradations) => {
  if (!nonEmptyString(msg.id)) {
    degradations.push({ rule: 'missing-field', frame: 'card.state', field: 'id' });
    return null;
  }
  if (!isPlainObject(msg.state)) {
    degradations.push({ rule: 'missing-field', frame: 'card.state', field: 'state' });
    return null;
  }
  const out = { ...msg.state };
  let kept = 0;
  if (out.remainingMs !== undefined) {
    if (typeof out.remainingMs === 'number') kept += 1;
    else {
      degradations.push({ rule: 'field-type', frame: 'card.state',
        field: 'state.remainingMs', wanted: 'number' });
      delete out.remainingMs;
    }
  }
  const label = stringField(out, 'label', 'card.state', degradations);
  if (label === undefined) delete out.label;
  else kept += 1;
  if (kept === 0) {
    degradations.push({ rule: 'state-empty', frame: 'card.state', id: msg.id });
    return null;
  }
  return { ...msg, state: out };
};

/** `card.complete`: id + optional string message. */
export const validateCardComplete = (msg, degradations) => {
  if (!nonEmptyString(msg.id)) {
    degradations.push({ rule: 'missing-field', frame: 'card.complete', field: 'id' });
    return null;
  }
  const message = stringField(msg, 'message', 'card.complete', degradations);
  if (message !== undefined || msg.message === undefined) return msg;
  const out = { ...msg };
  delete out.message;
  return out;
};

/** One face.question@1 option → canonical `{id, label}` (a bare string is
 * accepted as both); alien shapes drop with one warn. */
const normalizeOption = (option, index, degradations) => {
  if (typeof option === 'string') return { id: option, label: option };
  if (isPlainObject(option)
      && (nonEmptyString(option.id) || nonEmptyString(option.label))) {
    const id = nonEmptyString(option.id) ? option.id : option.label;
    const label = nonEmptyString(option.label) ? option.label : option.id;
    return { id, label };
  }
  degradations.push({ rule: 'option-dropped', frame: 'question.request',
    index, option: JSON.stringify(option)?.slice(0, 60) ?? String(option) });
  return null;
};

/** One question's options → the canonical array (or dropped wholesale when
 * the field mistypes). */
const normalizeOptions = (question, index, degradations) => {
  if (question.options === undefined) return;
  if (!Array.isArray(question.options)) {
    degradations.push({ rule: 'field-type', frame: 'question.request',
      field: `questions[${index}].options`, wanted: 'array' });
    delete question.options;
    return;
  }
  question.options = question.options
    .map((option, at) => normalizeOption(option, at, degradations))
    .filter((option) => option !== null);
};

/** face.question@1 `question.request`: id REQUIRED; questions normalized. */
export const validateQuestionRequest = (msg, degradations) => {
  if (!nonEmptyString(msg.id)) {
    degradations.push({ rule: 'missing-field', frame: 'question.request', field: 'id' });
    return null;
  }
  const raw = Array.isArray(msg.questions) ? msg.questions : [];
  if (raw.length === 0) {
    degradations.push({ rule: 'missing-field', frame: 'question.request',
      field: 'questions' });
    return null;
  }
  const out = [];
  raw.forEach((question, index) => {
    if (!isPlainObject(question)) {
      degradations.push({ rule: 'question-dropped', frame: 'question.request', index });
      return;
    }
    const normalized = { ...question };
    normalizeOptions(normalized, index, degradations);
    out.push(normalized);
  });
  if (out.length === 0) {
    degradations.push({ rule: 'question-dropped', frame: 'question.request',
      field: 'questions', reason: 'no valid question objects' });
    return null;
  }
  return { ...msg, questions: out };
};

/** The bus-frame validators (one row per known face frame). */
const FRAME_VALIDATORS = {
  'card.present': validateCardPresent,
  'card.state': validateCardState,
  'card.complete': validateCardComplete,
  'card.dismiss': () => ({}),
  'question.request': validateQuestionRequest,
};

/**
 * Validate ONE render intent. Pure: returns `{ok, intent, degradations}`
 * — ok=false means the frame is refused (never rendered; the degradations
 * say why). Unknown face types refuse with the `face-unknown` rule (§5.1 —
 * nothing can render them; the caller's warn keeps the refusal honest).
 */
export const validateIntent = (intent) => {
  const degradations = [];
  if (!isPlainObject(intent) || typeof intent.type !== 'string') {
    degradations.push({ rule: 'face-unknown', frame: undefined });
    return { ok: false, intent: null, degradations };
  }
  const validator = FRAME_VALIDATORS[intent.type];
  if (validator === undefined) {
    degradations.push({ rule: 'face-unknown', frame: intent.type });
    return { ok: false, intent: null, degradations };
  }
  if (!checkVersion(intent, degradations)) {
    return { ok: false, intent: null, degradations };
  }
  const validated = validator(intent, degradations);
  if (validated === null) return { ok: false, intent: null, degradations };
  return { ok: true, intent: validated, degradations };
};

/** face.approval@1 request payload: `{schemaVersion?, title?, detail?,
 * allowRemember?}` — `detail` canonical, the `message` alias warned + killed. */
export const approvalPayload = (payload) => {
  const out = {};
  const degradations = [];
  if (isPlainObject(payload)) {
    if (payload.schemaVersion !== undefined) out.schemaVersion = payload.schemaVersion;
    if (typeof payload.title === 'string') out.title = payload.title;
    if (typeof payload.detail === 'string') out.detail = payload.detail;
    if (typeof payload.allowRemember === 'boolean') out.allowRemember = payload.allowRemember;
    if (payload.message !== undefined) {
      degradations.push({ rule: 'unblessed-alias', frame: 'face.approval',
        field: 'message', canonical: 'detail' });
    }
  }
  return { payload: out, degradations };
};

/** face.picker@1 request payload: `{schemaVersion?, mode?, suggestedName?}`.
 * An unserved mode still FORWARDS (the primitive's frozen `invalid`
 * refusal is the fail-loud answer, §5.5); the warn makes the drift visible. */
export const pickerPayload = (payload) => {
  const out = {};
  const degradations = [];
  if (isPlainObject(payload)) {
    if (payload.schemaVersion !== undefined) out.schemaVersion = payload.schemaVersion;
    if (typeof payload.mode === 'string') {
      if (!PICKER_MODES.includes(payload.mode)) {
        degradations.push({ rule: 'mode-unknown', frame: 'face.picker',
          mode: payload.mode, served: PICKER_MODES.join('|') });
      }
      out.mode = payload.mode;
    }
    if (typeof payload.suggestedName === 'string') out.suggestedName = payload.suggestedName;
  }
  return { payload: out, degradations };
};

/** face.notify@1 request payload: title REQUIRED family-wide (the frozen
 * primitive refuses its absence loudly; the warn precedes it). */
export const notifyPayload = (payload) => {
  const out = {};
  const degradations = [];
  if (isPlainObject(payload)) {
    if (payload.schemaVersion !== undefined) out.schemaVersion = payload.schemaVersion;
    if (payload.title === undefined) {
      degradations.push({ rule: 'missing-field', frame: 'face.notify',
        field: 'title' });
    }
    if (typeof payload.title === 'string') out.title = payload.title;
    if (typeof payload.body === 'string') out.body = payload.body;
    if (typeof payload.threadId === 'string') out.threadId = payload.threadId;
    if (isPlainObject(payload.data)) out.data = payload.data;
  }
  return { payload: out, degradations };
};

const viewTitle = (view) =>
  (typeof view.title === 'string' && view.title.length > 0 ? view.title : '工具卡片');

/** The #764 call views → card.present payloads (terminal/diff/generic). */
const callViewFace = (view) => {
  const title = viewTitle(view);
  if (view.card === 'generic') return { frame: 'card.present', card: { kind: 'info', title } };
  if (view.card === 'terminal') {
    const card = { kind: 'info', title };
    if (typeof view.description === 'string') card.label = view.description;
    else if (typeof view.cwd === 'string') card.label = view.cwd;
    return { frame: 'card.present', card };
  }
  if (view.card === 'diff') {
    const count = Array.isArray(view.diffs) ? view.diffs.length : 0;
    return { frame: 'card.present', card: { kind: 'info', title, label: `${count} 个文件变更` } };
  }
  return null;
};

/** The #764 result views → card.complete payloads (the structured faces the
 * native card family has not declared yet degrade to the generic summary). */
const resultViewFace = (view) => {
  const title = viewTitle(view);
  if (view.card === 'generic') return { frame: 'card.complete', message: title };
  if (view.card === 'search') {
    const total = typeof view.total === 'number' ? view.total : 0;
    const truncated = view.truncated === true ? '（已截断）' : '';
    return { frame: 'card.complete', message: `${title} · ${total} 项${truncated}` };
  }
  if (view.card === 'read') {
    const lines = typeof view.totalLines === 'number' ? view.totalLines : '?';
    return { frame: 'card.complete', message: `${title} · ${lines} 行` };
  }
  if (view.card === 'web') {
    const status = view.statusCode !== undefined ? ` · HTTP ${view.statusCode}` : '';
    return { frame: 'card.complete', message: `${title}${status}` };
  }
  if (view.card === 'diff') {
    const count = Array.isArray(view.diffs) ? view.diffs.length : 0;
    return { frame: 'card.complete', message: `${title} · ${count} 个文件变更` };
  }
  if (view.card === 'terminal') {
    const exit = typeof view.exitCode === 'number' ? ` · exit ${view.exitCode}` : '';
    return { frame: 'card.complete', message: `${title}${exit}` };
  }
  return null;
};

/**
 * The #764 vocabulary → face.card@1 mapping (referenced, never redefined —
 * `presentation.d.ts`). A CALL view maps to a card.present payload; a
 * RESULT view maps to a card.complete payload; alien shapes degrade to
 * null (presenters degrade, never throw — the caller warns).
 */
export const toolViewFace = (view) => {
  if (!isPlainObject(view) || typeof view.card !== 'string') return null;
  const callFace = callViewFace(view);
  if (callFace !== null) return callFace;
  const resultFace = resultViewFace(view);
  if (resultFace !== null) return resultFace;
  return { frame: 'card.present', card: { kind: 'info', title: '未知渲染意图' } };
};
