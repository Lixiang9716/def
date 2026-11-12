// dsh:logging-exempt (hilog here is drive/progress evidence only; the
// canonical records are the scenario's own stream through the phase sink)

import { hilog } from '@kit.PerformanceAnalysisKit';

const TAG: string = 'dsh.question';

/**
 * QuestionDialog.ets — the question face's MODEL half (the ArkTS sibling of
 * hosts/android QuestionDialog.kt and hosts/ios SessionQuestions.swift; the
 * dialog struct that renders it lives in Index.ets beside ApprovalDialog,
 * because a @CustomDialog opens from the page's own component context).
 *
 * The host receives `question.request` on the bus (question-bridge.js parks
 * the ask and posts the face through render-intent.js — face.question@1),
 * presents ONE native dialog per question — options as button rows, an
 * option-less ask as free text — and delivers the answer back over the bus
 * as `question.answer {id, answers, outcome}` (hostBusDeliver, the
 * deliverRuntime equivalent). The chained handler on the JS side resolves
 * the bridge's parked ask and the turn resumes.
 *
 * face.question@1 (data-protocols.md §11, R3 batch 3): options are the
 * canonical `{id, label}` objects (a bare string stays accepted — both
 * fields read from it) and answers identify options by **id**, never by
 * echoed display label (a relabeled option keeps its round-trip). The
 * longest-string label heuristic and the ≤3-button ceiling are retired —
 * every option renders as its own button row, so the renderer is not lossy
 * past three options. The 取消 button DELIVERS `question.answer` with
 * `outcome:"cancelled"` — the park-forever defect (取消 dismissed without
 * answering, so no answer ever settled the ask and the turn waited forever)
 * dies here; autoCancel is off for the same reason (an outside tap is
 * nothing, never a silent dismissal). An answered ask on a versioned request
 * answers with `outcome:"answered"`; legacy frames (no schemaVersion) stay
 * byte-shaped exactly as before (no outcome field).
 */

/** One normalized option (face.question@1: `{id, label}`; a bare-string
 * producer entry reads as both). */
export class QuestionOptionRow {
  public readonly id: string;
  public readonly label: string;

  constructor(id: string, label: string) {
    this.id = id;
    this.label = label;
  }
}

/** One parsed question: the dialog title/body plus the normalized options
 * (an empty options array = the free-text ask). */
export class QuestionRow {
  public readonly qid: string;
  public readonly header: string;
  public readonly body: string;
  public readonly options: Array<QuestionOptionRow>;

  constructor(qid: string, header: string, body: string,
    options: Array<QuestionOptionRow>) {
    this.qid = qid;
    this.header = header;
    this.body = body;
    this.options = options;
  }
}

/** One structured answer row (selected option ids, or the typed custom
 * text) — the v1 answer identifies options by id, never by label. */
export class QuestionAnswerRow {
  public readonly id: string;
  public readonly selected: Array<string> | null;
  public readonly custom: string | null;

  constructor(id: string, selected: Array<string> | null, custom: string | null) {
    this.id = id;
    this.selected = selected;
    this.custom = custom;
  }
}

/** The parsed `question.request` frame. id is required (the askId) — a
 * missing id is refused with a structured warn, never silently dropped
 * (data-protocols §11's degradation ladder #4). */
export class QuestionRequest {
  public readonly id: string;
  public readonly versioned: boolean;
  public readonly questions: Array<QuestionRow>;

  constructor(id: string, versioned: boolean, questions: Array<QuestionRow>) {
    this.id = id;
    this.versioned = versioned;
    this.questions = questions;
  }
}

/** One native dialog per question (Index presents; the chain and the settle
 * live in QuestionFace.run). onAnswer settles the row; onCancel settles the
 * whole ask cancelled — both terminal for the chain. */
export type QuestionPresenter =
  (question: QuestionRow, onAnswer: (row: QuestionAnswerRow) => void,
    onCancel: () => void) => void;

/** The bus face HostPhase hands every `question.request` line to, with the
 * deliver callback that carries the answer back over the bus (the Android
 * BindingHost → showQuestionDialog(activity, msg, ::deliverRuntime)
 * shape). */
export type QuestionBusFace = (requestJson: string,
  deliver: (answerJson: string) => void) => void;

/** The ready-made bus face over a per-question presenter: parse (a refused
 * frame presents nothing — the ladder's structured warn already fired) and
 * run the chain through it. */
export function questionBusFace(present: QuestionPresenter): QuestionBusFace {
  return (requestJson: string, deliver: (answerJson: string) => void): void => {
    const request = QuestionFace.parse(requestJson);
    if (request === null) {
      return;
    }
    QuestionFace.run(request, present, deliver);
  };
}

export class QuestionFace {
  /** Parse one raw bus line into the ask (null = not a question.request, or
   * refused by the ladder — the caller presents nothing and the ask dies
   * with ONE warn, never a crash). */
  static parse(line: string): QuestionRequest | null {
    let msg: Record<string, Object> = {};
    try {
      msg = JSON.parse(line) as Record<string, Object>;
    } catch (e) {
      return null;
    }
    if (String(msg['type'] ?? '') !== 'question.request') {
      return null;
    }
    const id = msg['id'];
    if (typeof id !== 'string' || id.length === 0) {
      hilog.warn(0x0000, TAG, 'question-degrade missing-id');
      return null;
    }
    const rawQuestions = msg['questions'];
    if (!Array.isArray(rawQuestions)) {
      hilog.warn(0x0000, TAG, 'question-degrade missing-questions');
      return null;
    }
    const versioned = Number(msg['schemaVersion'] ?? 0) >= 1;
    const rows: Array<QuestionRow> = [];
    const arr = rawQuestions as Array<Object>;
    for (let i = 0; i < arr.length; i++) {
      const qid = QuestionFace.stringAt(arr[i], 'id', `q${i}`);
      const header = QuestionFace.stringAt(arr[i], 'header', 'def');
      const body = QuestionFace.stringAt(arr[i], 'question', '');
      const options = QuestionFace.parseOptions(QuestionFace.fieldOf(arr[i], 'options'));
      rows.push(new QuestionRow(qid, header, body, options));
    }
    return new QuestionRequest(id, versioned, rows);
  }

  /** The ask chain: one dialog per question (the presenter's), then the
   * settle. The settle is exactly-once per ask (the scripted cancel and a
   * human cancel must not double-deliver); cancel ABORTS the chain — the
   * parked turn settles with the answers gathered before it. */
  static run(request: QuestionRequest, present: QuestionPresenter,
    deliver: (answerJson: string) => void): void {
    const answers: Array<QuestionAnswerRow> = [];
    let settled = false;
    const settle = (outcome: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      const payload: Record<string, Object> = {
        'type': 'question.answer',
        'id': request.id,
        'answers': QuestionFace.answersJson(answers),
      };
      if (request.versioned) {
        payload['outcome'] = outcome;
      }
      hilog.info(0x0000, TAG, 'question settled rows=%{public}d outcome=%{public}s',
        answers.length, outcome);
      deliver(JSON.stringify(payload));
    };
    const cancelled = (): void => {
      settle('cancelled');
    };
    const askAt = (index: number): void => {
      if (index >= request.questions.length) {
        settle('answered');
        return;
      }
      const q = request.questions[index];
      hilog.info(0x0000, TAG, 'question presents %{public}s options=%{public}d',
        q.qid, q.options.length);
      present(q, (row: QuestionAnswerRow): void => {
        answers.push(row);
        askAt(index + 1);
      }, cancelled);
    };
    askAt(0);
  }

  /** face.question@1 option normalization — canonical `(id, label)` pairs
   * (the dispatch layer normalizes producer-side; this read tolerates the
   * legacy shapes a raw producer still posts): a bare string is accepted as
   * both; an object reads its `id`/`label` strings (either defaulting to
   * the other); alien shapes drop with one structured warn (the ask still
   * renders). The QuestionFace twin of QuestionDialog.kt's parseOptions. */
  private static parseOptions(raw: Object | undefined): Array<QuestionOptionRow> {
    const out: Array<QuestionOptionRow> = [];
    if (raw === undefined || raw === null) {
      return out;
    }
    if (!Array.isArray(raw)) {
      hilog.warn(0x0000, TAG, 'question-degrade option-dropped');
      return out;
    }
    const arr = raw as Array<Object>;
    for (const entry of arr) {
      if (typeof entry === 'string') {
        out.push(new QuestionOptionRow(entry, entry));
        continue;
      }
      if (entry === null || typeof entry !== 'object') {
        hilog.warn(0x0000, TAG, 'question-degrade option-dropped');
        continue;
      }
      const idV = (entry as Record<string, Object>)['id'];
      const labelV = (entry as Record<string, Object>)['label'];
      const idS = typeof idV === 'string' ? idV : '';
      const labelS = typeof labelV === 'string' ? labelV : '';
      if (typeof idV === 'string' && typeof labelV === 'string') {
        out.push(new QuestionOptionRow(idS, labelS));
      } else if (typeof labelV === 'string') {
        out.push(new QuestionOptionRow(labelS, labelS));
      } else if (typeof idV === 'string') {
        out.push(new QuestionOptionRow(idS, idS));
      } else {
        hilog.warn(0x0000, TAG, 'question-degrade option-dropped');
      }
    }
    return out;
  }

  private static fieldOf(entry: Object, key: string): Object | undefined {
    if (entry === null || typeof entry !== 'object') {
      return undefined;
    }
    return (entry as Record<string, Object>)[key];
  }

  private static stringAt(entry: Object, key: string, fallback: string): string {
    const v = QuestionFace.fieldOf(entry, key);
    return typeof v === 'string' ? v : fallback;
  }

  /** The answers array out of the rows (option ids / custom text; never the
   * echoed labels). */
  private static answersJson(rows: Array<QuestionAnswerRow>):
    Array<Record<string, Object>> {
    const out: Array<Record<string, Object>> = [];
    for (const r of rows) {
      const row: Record<string, Object> = { 'id': r.id };
      if (r.selected !== null) {
        row['selected'] = r.selected;
      }
      if (r.custom !== null) {
        row['custom'] = r.custom;
      }
      out.push(row);
    }
    return out;
  }
}
