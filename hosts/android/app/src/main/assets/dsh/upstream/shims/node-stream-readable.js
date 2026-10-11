// dsh:logging-exempt (host shim: no side effects to log)
/**
 * shims/node-stream-readable.js — the READABLE BASE of the node:stream shim
 * (MiniStream, PassThrough, Readable), split out of node-stream.js at the
 * session-persistence cycle fix (2026-10-11). The family had one evaluation
 * order its cycle could not survive: the vendored session-persistence-jsonl
 * graph imports bare 'node:stream' FIRST (the bare map row is its own module
 * instance — the dual-instance note in fs.js applies here too), so
 * node-stream-writable's back-import of node-stream.js re-entered the file
 * as a SECOND instance whose own import of node-stream-duplex evaluated
 * `class Duplex extends SinkEvents` while the writable half was still
 * mid-evaluation — "SinkEvents is not initialized" (measured: the jsonl
 * link probe). This module imports NOTHING from the family, so the sink and
 * duplex halves terminate their imports without re-entering an evaluator.
 * node-stream.js keeps every specifier surface (bare row + bundle path +
 * the relative spell) as the aggregator; the classes here are the single
 * shared identity every spelling re-exports.
 */

export class MiniStream {
  #listeners = new Map();
  #ended = false;
  #chunks = [];
  #waiters = [];
  #error = undefined;
  #flowing = false;
  on(event, fn) {
    this.#push(event, fn);
    if (event === 'data' && !this.#flowing) this.#startFlowing();
    return this;
  }
  once(event, fn) {
    const wrapped = (value) => { this.#drop(event, wrapped); fn(value); };
    this.#push(event, wrapped);
    if (event === 'data' && !this.#flowing) this.#startFlowing();
    return this;
  }
  off(event, fn) { this.#drop(event, fn); return this; }
  removeListener(event, fn) { return this.off(event, fn); }
  /** node's flowing-mode switches; a resumed stream with no 'data' listener
   * discards (the ssh peers resume their output taps before collecting). */
  resume() {
    this.#flowing = true;
    this.#flushQueued();
    return this;
  }
  pause() { this.#flowing = false; return this; }
  #startFlowing() {
    this.#flowing = true;
    this.#flushQueued();
    if (this.#ended) this.emit('end');
  }
  #flushQueued() {
    if (this.#ended) { this.emit('end'); return; }
    const queued = this.#chunks.splice(0);
    const dataListeners = this.#listeners.get('data')?.length ?? 0;
    if (dataListeners === 0) return; // resumed with no tap: node discards
    for (const chunk of queued) this.emit('data', chunk);
  }
  #push(event, fn) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, []);
    this.#listeners.get(event).push(fn);
  }
  #drop(event, fn) {
    const list = this.#listeners.get(event) ?? [];
    const at = list.indexOf(fn);
    if (at >= 0) list.splice(at, 1);
  }
  listenerCount(event) { return this.#listeners.get(event)?.length ?? 0; }
  emit(event, value) {
    for (const fn of [...(this.#listeners.get(event) ?? [])]) fn(value);
    return this.#listeners.has(event);
  }
  push(chunk) {
    // Flowing chunks go straight to 'data' listeners; the queue keeps a copy
    // for the iterator face (nothing in the corpus consumes both on one
    // stream — node would route exclusively, we over-deliver rather than
    // ever stall a consumer).
    if (this.#flowing && (this.#listeners.get('data')?.length ?? 0) > 0) {
      this.emit('data', chunk);
    }
    this.#chunks.push(chunk);
    this.#wake();
  }
  /** end([chunk][, callback]) — node's readable.end pushes the FINAL chunk
   * before ending (ptc-runtime's drainOutput test ends a PassThrough with
   * 'last output'; the old body dropped the argument so the data listener
   * saw nothing). */
  end(chunk, ...rest) {
    if (typeof chunk === 'function') { rest.unshift(chunk); chunk = undefined; }
    if (chunk !== undefined && chunk !== null) this.push(chunk);
    this.#ended = true;
    if (this.#flowing) this.emit('end');
    const callback = typeof rest[0] === 'function' ? rest[0] : undefined;
    if (callback !== undefined) queueMicrotask(callback);
    this.#wake();
  }
  fail(error) { this.#error = error; this.#wake(); }
  /** Wake waiting iterator readers ONE MICROTASK LATE (W5-S): node resolves
   * a pending read on a nextTick AFTER the writer's own continuations — the
   * writer's post-write chain (the framed-RPC `send().finally` that retires
   * the served request) settles before the reader's continuation runs. A
   * synchronous wake let the READER's next tick win that race (measured:
   * ssh management-capacity's release flow — the client's follow-up request
   * frame arrived before the server retired the previous active entry, and
   * the capacity check wrongly closed the connection). */
  #wake() {
    const waiters = this.#waiters.splice(0);
    if (waiters.length === 0) return;
    queueMicrotask(() => { for (const w of waiters) w(); });
  }
  #next() {
    if (this.#chunks.length > 0) return Promise.resolve({ value: this.#chunks.shift(), done: false });
    if (this.#destroyed && this.#error === undefined && !this.#ended) return Promise.resolve({ value: undefined, done: true });
    if (this.#error !== undefined) return Promise.reject(this.#error);
    if (this.#ended) return Promise.resolve({ value: undefined, done: true });
    // Wake re-evaluates the state; the promise ALWAYS settles with an
    // iterator result (a bare undefined would break the async-iterator
    // protocol quickjs enforces).
    return new Promise((resolve, reject) => {
      this.#waiters.push(() => {
        try { resolve(this.#next()); } catch (error) { reject(error); }
      });
    });
  }
  read() { return this.#chunks.length > 0 ? this.#chunks.shift() : null; }
  [Symbol.asyncIterator]() {
    // return/throw present: a `for await` that breaks (or a consumer's
    // throw) calls them, and quickjs rejects an iterator that lacks them.
    return {
      next: () => this.#next(),
      return: (value) => {
        this.#waiters.splice(0);
        return Promise.resolve({ value, done: true });
      },
      throw: (error) => Promise.reject(error),
    };
  }
  then(resolve, reject) {
    return this.#drain().then(resolve, reject);
  }
  async #drain() {
    const out = [];
    for (;;) {
      const { value, done } = await this.#next();
      if (done) return out;
      out.push(value);
    }
  }
  /** PassThrough write: chunks route through immediately; a trailing
   * completion fires from a microtask (node's receipt timing) — the framed
   * RPC writers hang their send promises on it. */
  write(chunk, ...rest) {
    this.push(chunk);
    const callback = typeof rest[rest.length - 1] === 'function' ? rest[rest.length - 1] : undefined;
    if (callback) queueMicrotask(callback);
    return true;
  }
  /** node's pipe: source flowing → destination.write; source 'end' ends the
   * destination unless `{end: false}`; destination backpressure pauses the
   * source until 'drain' (the subprocess-ssh transport wiring pipes its
   * stdin/stdout/control legs through). Returns the destination. */
  pipe(destination, options = {}) {
    this.on('data', (chunk) => {
      const wantsMore = destination.write(chunk);
      if (!wantsMore && typeof this.pause === 'function') {
        this.pause();
        destination.once?.('drain', () => this.resume());
      }
    });
    this.once('end', () => {
      if (options.end !== false) destination.end?.();
    });
    return destination;
  }
  #destroyed = false;
  /** node's destroy(error): 'error' only when an error was passed, then
   * 'close' — the ssh peers wire output.on('error'/'close') to connection
   * loss, so the events (not just the iterator state) must move. A CLEAN
   * destroy terminates the iterator face WITHOUT marking a graceful end:
   * node keeps readableEnded false on a destroyed-never-ended stream (the
   * ptc-runtime bounds test drains a destroyed stream and expects false),
   * and #next returns done for a destroyed queue so for-await still
   * finishes. */
  destroy(error) {
    if (this.#destroyed) return this;
    this.#destroyed = true;
    if (error !== undefined && error !== null) {
      this.emit('error', error);
      this.fail(error);
    }
    this.#wake();
    this.emit('close');
    return this;
  }
  get destroyed() { return this.#destroyed; }
  /** node's terminal-state getters: drainOutput re-drains an already-ended
   * stream and short-circuits on readableEnded — without the getter the
   * second call arms a fresh 1s timer and resolves false (measured
   * 2026-09-28, ptc-runtime output-stream). */
  get readableEnded() { return this.#ended; }
  get writableEnded() { return this.#ended; }
  close() { this.end(); }
}
export class PassThrough extends MiniStream {}
export class Readable extends MiniStream {
  static from(iterable) {
    const stream = new Readable();
    (async () => {
      try {
        for await (const chunk of iterable) stream.push(chunk);
        stream.end();
      } catch (error) {
        stream.fail(error);
      }
    })();
    return stream;
  }
}
