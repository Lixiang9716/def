// dsh:logging-exempt (state model: the only logs are the face.card@1
// degrade ladder's structured warns — the honesty voice the ladder
// requires, hilog being the host's unified channel)

import { hilog } from '@kit.PerformanceAnalysisKit';

const TAG: string = 'dsh.cardface';

/**
 * CardFace — the state model of the native card face on Harmony (the ArkTS
 * sibling of hosts/ios CardPlayerSurface.swift and hosts/android
 * CardSurface.kt, #452's PiP shape): a plugin speaks bus lines (`card.present`
 * / `card.state` / `card.dismiss` / `card.complete`) and the page renders the
 * projected face through the @State bindings Index.ets binds. PiP posture:
 * the card anchors TOP under the safe area — never over the bottom-docked
 * composer — and is locally closable (the ✕); drag comes free with the
 * position offsets the page holds. Dismissal authority stays the plugin's
 * per the contract: a locally closed card ignores later state records and
 * the next card.present re-shows it.
 *
 * Timer cards tick locally between authoritative card.state patches (a 250
 * ms interval re-renders the countdown from the anchor — the page owns the
 * timer through the visible flag's @Watch).
 *
 * face.card@1 (R3 batch 3, the iOS/Android posture): this model is now a
 * GENERIC renderer of the declarative payload — `schemaVersion` is read (a
 * future version renders legacy + one structured warn), the declarative
 * `card.actions: [{id, label}]` project into the page's button row (a tap
 * posts a `card.action` event), a missing id is REFUSED with a warn instead
 * of silently dropped, an unknown kind degrades to `info` with a warn, and
 * the user's acts return to the runtime as `card.action` events over
 * [actionSink] (the same host→runtime event channel the primitives' emitters
 * use — D8, never polling). The close is terminal-once per presented card
 * (`close` beats a pending button) and OBSERVABLE, never authoritative — the
 * local ✕ posts the event and clears the projection; the next card.present
 * re-shows.
 */

/** One projected declarative action (the page's button row). */
export class CardActionRow {
  public id: string;
  public label: string;

  constructor(id: string, label: string) {
    this.id = id;
    this.label = label;
  }
}

export class CardFace {
  /** The projected face (volatile across threads: the /api/state seam
   * reads it from a connection thread while the bus hops onto main). */
  private static face: Record<string, Object> = CardFace.blank();

  private static blank(): Record<string, Object> {
    return CardFace.projected(true, false, '');
  }

  /** One projected {card: …} record built key-by-key (ArkTS forbids
   * untyped object literals and spreads). */
  private static projected(attached: boolean, visible: boolean,
    id: string): Record<string, Object> {
    const card: Record<string, Object> = { 'attached': attached, 'visible': visible };
    if (id.length > 0) {
      card['id'] = id;
    }
    const out: Record<string, Object> = { 'card': card };
    return out;
  }

  /** The presented card (empty when none). */
  private static card: Record<string, Object> = {};
  /** The projected declarative actions of the presented card. */
  private static actions: Array<CardActionRow> = [];
  /** Milliseconds left, anchored at [anchorAt]. */
  private static remainingMs: number = 0;
  private static anchorAt: number = 0;
  /** face.card@1 the payload declared (0 = legacy — today's exact shape). */
  private static cardSchemaVersion: number = 0;
  /** One terminal action per presented card (`close` beats a pending
   * button — the v1 order guarantee); re-armed by every present. */
  private static actionTerminal: boolean = false;

  /** The host→runtime action delivery — the SAME event channel the
   * primitives' emitters use (deliverEvent / deliverRuntimeEvent). The
   * serving/drive seat wires it; absent (a seat without a live runtime)
   * makes actions local-only. */
  static actionSink: ((eventJson: string) => void) | undefined = undefined;

  /** One bus card.* record (main thread). */
  static handle(type: string, msg: Record<string, Object>): void {
    if (type === 'card.present') {
      // face.card@1 degradation ladder (never crash, never silent): a
      // future schemaVersion renders legacy (unknown fields ignored) with
      // one structured warn; a missing id is refused AND warned — the
      // honesty fix for the silent drop the census measured here.
      CardFace.cardSchemaVersion = Number(msg['schemaVersion'] ?? 0);
      if (CardFace.cardSchemaVersion > 1) {
        hilog.warn(0x0000, TAG, 'card-degrade schema-%{public}d', CardFace.cardSchemaVersion);
      }
      const hasCard = msg['card'] !== undefined && msg['card'] !== null;
      if (!hasCard) {
        hilog.warn(0x0000, TAG, 'card-degrade missing-card');
        return;
      }
      const record = msg['card'] as Record<string, Object>;
      const id = String(record['id'] ?? '');
      if (id.length === 0) {
        hilog.warn(0x0000, TAG, 'card-degrade missing-id');
        return;
      }
      let kind = String(record['kind'] ?? 'info');
      if (kind !== 'info' && kind !== 'timer') {
        hilog.warn(0x0000, TAG, 'card-degrade kind-%{public}s', kind);
        kind = 'info';
      }
      record['kind'] = kind; // the degraded kind is what renders (snapshot truth)
      CardFace.parseActions(record);
      CardFace.card = record;
      CardFace.remainingMs = Number(record['durationMs'] ?? 0);
      CardFace.anchorAt = Date.now();
      CardFace.actionTerminal = false;
    } else if (type === 'card.state') {
      if (!CardFace.visible()) {
        return;
      }
      const patch = msg['state'] as Record<string, Object> ?? {};
      const remaining = Number(patch['remainingMs'] ?? NaN);
      if (!Number.isNaN(remaining)) {
        CardFace.remainingMs = remaining;
        CardFace.anchorAt = Date.now();
      }
      const label = String(patch['label'] ?? '');
      if (label.length > 0) {
        CardFace.card['label'] = label;
      }
    } else if (type === 'card.complete') {
      if (!CardFace.visible()) {
        return;
      }
      CardFace.card['completeMessage'] = String(msg['message'] ?? '完成');
      // The complete message REPLACES the stale tick label on the face (the
      // Android sibling's complete(): subtitle becomes the message) — the
      // page's binding prefers the label, so the stale one must retire.
      CardFace.card['label'] = '';
    }
    CardFace.project();
  }

  /** The v1-add declarative actions: `[{id, label}]` project into the
   * page's button row; malformed entries drop with one warn (the card
   * renders). */
  private static parseActions(record: Record<string, Object>): void {
    CardFace.actions = [];
    const raw = record['actions'];
    if (raw === undefined) {
      return;
    }
    if (!Array.isArray(raw)) {
      hilog.warn(0x0000, TAG, 'card-degrade actions-type');
      return;
    }
    const arr = raw as Array<Record<string, Object>>;
    let dropped = 0;
    for (const entry of arr) {
      const actionId = entry['id'];
      const label = entry['label'];
      if (typeof actionId === 'string' && actionId.length > 0
        && typeof label === 'string') {
        CardFace.actions.push(new CardActionRow(actionId, label));
      } else {
        dropped += 1;
      }
    }
    if (dropped > 0) {
      hilog.warn(0x0000, TAG, 'card-degrade actions-dropped %{public}d', dropped);
    }
  }

  /** The projected rows for the page's button row (the full face the app
   * renders). */
  static actionRows(): Array<CardActionRow> {
    return CardFace.actions;
  }

  /** One user act on the presented card → one `card.action` event over the
   * sink: `{id, action: close | button, actionId?, at}` (harmony has no
   * card drag gesture, so no drag-end event — the events the chrome
   * supports post, the ones it lacks never invent themselves). The close is
   * terminal-once per presented card; buttons are not terminal. */
  private static postCardAction(action: string, actionId: string): void {
    if (action === 'close') {
      if (CardFace.actionTerminal) {
        return;
      }
      CardFace.actionTerminal = true;
    }
    if (CardFace.actionSink === undefined) {
      return;
    }
    const event: Record<string, Object> = {
      'type': 'card.action',
      'id': String(CardFace.card['id'] ?? ''),
      'action': action,
      'at': Date.now(),
    };
    if (actionId.length > 0) {
      event['actionId'] = actionId;
    }
    CardFace.actionSink(JSON.stringify(event));
  }

  /** The ✕'s close: OBSERVABLE (the card.action event rides out first) but
   * local — the projection blanks so the face hides and later
   * card.state/complete records fall on the visible() guard; the next
   * card.present re-shows. The plugin keeps its dismissal authority. */
  static closeByUser(): void {
    CardFace.postCardAction('close', '');
    CardFace.card = {};
    CardFace.actions = [];
    CardFace.project();
  }

  /** A declarative button tap: the actionId rides the event (answers
   * identify the action by id, never by echoed label). */
  static buttonAction(actionId: string): void {
    CardFace.postCardAction('button', actionId);
  }

  static dismiss(): void {
    CardFace.project();
  }

  /** Whether a card is live (the page's @Watch drives the local tick). */
  static visible(): boolean {
    const card = CardFace.face['card'] as Record<string, Object>;
    return card['visible'] === true;
  }

  /** The projected face for the GET /api/state seam (any thread). */
  static snapshot(): Record<string, Object> {
    const card = CardFace.face['card'] as Record<string, Object>;
    const visible = card['visible'] === true;
    const id = visible ? String(card['id'] ?? '') : '';
    return CardFace.projected(true, visible, id);
  }

  /** The FULL projected card for the page's own PiP bindings: the face the
   * app renders (title/kind/remainingText/label/completeMessage/actions).
   * snapshot() above stays the REDACTED /api/state seam — attached/visible/
   * id only, the state the outside world may see (the #455 seam contract);
   * the card's text is in-app face surface, not the seam's. */
  static faceCard(): Record<string, Object> {
    return CardFace.face['card'] as Record<string, Object>;
  }

  /** Re-projects the face from the model (called by the page's tick and
   * after every handled record). */
  static project(): void {
    const card: Record<string, Object> = {
      'attached': true,
      'visible': Object.keys(CardFace.card).length > 0,
    };
    if (Object.keys(CardFace.card).length > 0) {
      card['id'] = String(CardFace.card['id'] ?? '');
      card['title'] = String(CardFace.card['title'] ?? card['id']);
      card['kind'] = String(CardFace.card['kind'] ?? 'info');
      const remaining = CardFace.remainingMs - (Date.now() - CardFace.anchorAt);
      if (String(CardFace.card['kind']) === 'timer') {
        card['remainingText'] = CardFace.clock(Math.max(0, remaining));
      }
      const label = String(CardFace.card['label'] ?? '');
      if (label.length > 0) {
        card['label'] = label;
      }
      const complete = String(CardFace.card['completeMessage'] ?? '');
      if (complete.length > 0) {
        card['completeMessage'] = complete;
      }
      if (CardFace.actions.length > 0) {
        const rows: Array<CardActionRow> = [];
        for (const row of CardFace.actions) {
          rows.push(new CardActionRow(row.id, row.label));
        }
        card['actions'] = rows;
      }
    }
    CardFace.face = CardFace.wrap(card);
  }

  private static wrap(card: Record<string, Object>): Record<string, Object> {
    const out: Record<string, Object> = { 'card': card };
    return out;
  }

  private static clock(ms: number): string {
    const total = Math.floor(ms / 1000);
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }
}
