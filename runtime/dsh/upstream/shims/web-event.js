// dsh:logging-exempt (host shim: no side effects to log)
/**
 * shims/web-event.js — the DOM event primitives the vendored closure's
 * web-adjacent faces use as BARE GLOBALS (quickjs defines none):
 *   - EventTarget — the extendable base class: eventsource@3.0.7's
 *     EventSource, the inspector hosts, and the MCP client faces all
 *     `class X extends EventTarget` at module-definition time, so the class
 *     itself (not an instance factory) must exist before those modules load.
 *   - Event / CustomEvent / MessageEvent / ErrorEvent / CloseEvent — the
 *     constructors those faces dispatch (`new Event("open")`,
 *     `new MessageEvent(name, {data, origin, lastEventId})`,
 *     `new ErrorEvent("error", {code, message})`).
 * Delivery is synchronous and single-phase (no capture/bubble — the
 * consumers attach directly on the target); once-listeners detach after one
 * fire; a listener added during dispatch does not run for the in-flight
 * event (the DOM iteration guarantee the snapshot gives).
 * Deliberately NOT implemented: signal options, passive listeners, event
 * phases/propagation paths, AbortSignal's EventTarget base (the shims'
 * AbortSignal predates this module and stays the ?= loser).
 *
 * Two installers call installWebEvent (below): the suite harness
 * (shims/globals.js) and the PRODUCT boot (upstream/web-shims.js). The
 * product-side evidence is the MCP client row: @modelcontextprotocol/
 * client@2.0.0/dist/index.mjs:4 statically imports `eventsource`, whose
 * dist/index.js evaluates `class ErrorEvent extends Event` (line 2) and
 * `class EventSource extends EventTarget` (line 64) at module-definition
 * time and dispatches `new Event("open")` (86) / `new MessageEvent(...)`
 * (101) at run time — so the globals must exist before the SDK's dynamic
 * import links (upstream/mcp-http-transport.js), not merely before a spec.
 */
const capture = (options) => (typeof options === 'boolean' ? options : options?.capture === true);

export class Event {
  constructor(type, options = {}) {
    if (type === undefined) {
      throw new TypeError("Failed to construct 'Event': 1 argument required, but only 0 present");
    }
    this.type = String(type);
    this.bubbles = options?.bubbles === true;
    this.cancelable = options?.cancelable === true;
    this.composed = options?.composed === true;
    this.timeStamp = Date.now();
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    this.isTrusted = false;
    this.NONE = 0;
    this.eventPhase = 0;
  }
  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }
  stopPropagation() { /* single-phase: nothing to stop */ }
  stopImmediatePropagation() {
    // Marks the snapshot walk to stop after the current listener.
    this._stopImmediate = true;
  }
  composedPath() { return this.target ? [this.target] : []; }
}

export class CustomEvent extends Event {
  constructor(type, options = {}) {
    super(type, options);
    this.detail = options?.detail === undefined ? null : options.detail;
  }
}

export class MessageEvent extends Event {
  constructor(type, options = {}) {
    super(type, options);
    this.data = options?.data === undefined ? null : options.data;
    this.origin = options?.origin ?? '';
    this.lastEventId = options?.lastEventId ?? '';
    this.source = options?.source ?? null;
    this.ports = options?.ports ?? [];
  }
}

export class ErrorEvent extends Event {
  constructor(type, options = {}) {
    super(type, options);
    // `code` is not DOM-standard but eventsource@3.0.7 hands {code, message}
    // and its failConnection consumers read it back off the event.
    this.code = options?.code;
    this.message = options?.message ?? '';
    this.filename = options?.filename ?? '';
    this.lineno = options?.lineno ?? 0;
    this.colno = options?.colno ?? 0;
    this.error = options?.error ?? undefined;
  }
}

export class CloseEvent extends Event {
  constructor(type, options = {}) {
    super(type, options);
    this.wasClean = options?.wasClean === true;
    this.code = options?.code ?? 0;
    this.reason = options?.reason ?? '';
  }
}

export class EventTarget {
  constructor() {
    // Own symbol-keyed store: subclasses (EventSource & co) declare their
    // own fields; a hidden-symbol map avoids colliding with them.
    this.__dshEventListeners = new Map();
  }

  addEventListener(type, listener, options = {}) {
    if (typeof listener !== 'function' && typeof listener?.handleEvent !== 'function') return;
    const list = this.__dshEventListeners.get(type) ?? [];
    const entry = { listener, once: options?.once === true };
    // Duplicate registrations for the same listener+capture are no-ops (DOM).
    const duplicate = list.some((e) => e.listener === listener && e.capture === capture(options));
    if (!duplicate) list.push({ ...entry, capture: capture(options) });
    this.__dshEventListeners.set(type, list);
  }

  removeEventListener(type, listener, options = {}) {
    const list = this.__dshEventListeners.get(type);
    if (list === undefined) return;
    const at = list.findIndex((e) => e.listener === listener && e.capture === capture(options));
    if (at >= 0) list.splice(at, 1);
    if (list.length === 0) this.__dshEventListeners.delete(type);
  }

  dispatchEvent(event) {
    if (!(event instanceof Event)) {
      throw new TypeError("Failed to execute 'dispatchEvent': parameter 1 is not of type 'Event'");
    }
    const list = this.__dshEventListeners.get(event.type);
    event.target = event.target ?? this;
    event.currentTarget = this;
    if (list !== undefined) {
      const snapshot = list.slice();
      for (const entry of snapshot) {
        if (event._stopImmediate) break;
        if (entry.once) this.removeEventListener(event.type, entry.listener);
        if (typeof entry.listener === 'function') entry.listener.call(this, event);
        else entry.listener.handleEvent(event);
      }
    }
    // The on* handler property fires after the listeners (DOM order).
    const handler = this[`on${event.type}`];
    if (typeof handler === 'function' && !event._stopImmediate) handler.call(this, event);
    event.currentTarget = null;
    return !event.defaultPrevented;
  }
}

/** Install the event family as globals, only when absent (the web-shims.js
 * rule: a host that binds them natively keeps its own). One face for the six
 * classes — the family is one DOM contract, and the harness and the product
 * boot must agree on the same prototypes (`event instanceof Event` across
 * a dispatchEvent boundary). Returns the names installed. */
export const installWebEvent = () => {
  const installs = [
    ['Event', Event],
    ['EventTarget', EventTarget],
    ['CustomEvent', CustomEvent],
    ['MessageEvent', MessageEvent],
    ['ErrorEvent', ErrorEvent],
    ['CloseEvent', CloseEvent],
  ];
  const installed = [];
  for (const [name, value] of installs) {
    if (globalThis[name] === undefined) {
      globalThis[name] = value;
      installed.push(name);
    }
  }
  return installed;
};
