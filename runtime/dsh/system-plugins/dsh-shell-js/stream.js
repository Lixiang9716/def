/**
 * stream.js — the shell's in-memory byte streams (pipelines without
 * processes).
 *
 * A pipeline `a | b` in this shell never creates a process or a thread
 * (AGENTS non-negotiable #2): both members are coroutines on the runtime's
 * single serial queue, and the pipe below is the only thing between them.
 * "Concurrent" therefore means *interleaved at await points*: the executor
 * launches every member of a pipeline at once, and each member advances only
 * when a stream operation resolves — the writer stalls in `write()` while
 * the window is full, the reader waits in `read()` while the window is empty
 * and the writer is open.
 *
 * Backpressure is PULL-type: nothing moves except when the downstream side
 * consumes. `write()` appends to a bounded in-flight window and returns a
 * pending promise once the window holds `PIPE_WINDOW_BYTES`; only a reader
 * pulling bytes (or closing the pipe) resolves it. The bound is on IN-FLIGHT
 * data between two stages, not on a run's total output — a capture sink
 * consumes eagerly, so the window it feeds never fills, and the run-level
 * `stdoutMaxBytes` of the executor request stays a carried, unenforced v1
 * field exactly as in the dsh-shell-wasm sibling.
 *
 * Failure semantics are loud (the house rule): a writer whose reader has
 * closed, or a reader whose writer aborted, rejects with `StreamError`
 * naming the pipe end — a broken pipeline must surface, never hang. On this
 * single-threaded runtime a hang would be unkillable, so every waiting side
 * is woken on close/abort/readerClose.
 */
import { createLogger } from 'logger.js';

const log = createLogger('dsh.shell.js.stream');

/** The bounded in-flight window between two pipeline stages (64KB). */
export const PIPE_WINDOW_BYTES = 64 * 1024;

/** The only error class these streams raise — always names the end that
 * failed, so a refusal reads as "which capability is missing", not "hang". */
export class StreamError extends Error {
  constructor(message) {
    log.debug('stream error', {});
    super(message);
    this.name = 'StreamError';
  }
}

/** One pending (resolve, reject) pair — the wake-up primitive. QuickJS has
 * no timers here and needs none: every wait is paired with an explicit
 * wake on the state transition that ends it. */
const deferred = () => {
  log.debug('deferred', {});
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The upstream end of one pipe. `write` accepts bytes or text; large
 * chunks are sliced to the window size so the in-flight bound is exact. */
export class PipeWriter {
  constructor() {
    log.debug('pipe writer created', {});
    this.chunks = [];            // in-flight window (array of Uint8Array)
    this.pendingBytes = 0;
    this.closed = false;
    this.readerClosed = false;
    this.waitingWriters = [];    // deferreds blocked on window space
    this.waitingReaders = [];    // deferreds blocked on data (owned with reader)
  }

  /** Append one chunk, awaiting while the window is full (pull-type
   * backpressure: only a reader's pull frees space). Rejects with
   * StreamError if the reader side has closed. */
  async write(chunk) {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
    log.debug('pipe write', { bytes: bytes.length, pending: this.pendingBytes });
    if (this.readerClosed) {
      throw new StreamError('write to a pipe whose reader has closed (broken pipe)');
    }
    if (this.closed) {
      throw new StreamError('write to a closed pipe');
    }
    let at = 0;
    while (at < bytes.length) {
      while (this.pendingBytes >= PIPE_WINDOW_BYTES && !this.readerClosed) {
        const waiter = deferred();
        this.waitingWriters.push(waiter);
        await waiter.promise;    // the reader pulls (or closes) — then we go on
        if (this.readerClosed) {
          throw new StreamError('write to a pipe whose reader has closed (broken pipe)');
        }
      }
      const take = Math.min(PIPE_WINDOW_BYTES - this.pendingBytes, bytes.length - at);
      const slice = bytes.subarray(at, at + take);
      this.chunks.push(slice);
      this.pendingBytes += take;
      at += take;
      this.wakeReaders();
    }
  }

  /** End of stream: the reader sees `done` after draining the window. */
  async close() {
    log.debug('pipe writer closed', {});
    this.closed = true;
    this.wakeReaders();
  }

  /** Abort the pipe (a stage failed): every waiting side rejects, so no
   * sibling coroutine is left parked on a dead pipe. */
  abort(reason) {
    log.debug('pipe writer aborted', { reason: `${reason}` });
    this.closed = true;
    this.aborted = reason;
    const readers = this.waitingReaders.splice(0);
    for (const w of readers) w.reject(new StreamError(`pipe aborted: ${reason}`));
    const writers = this.waitingWriters.splice(0);
    for (const w of writers) w.reject(new StreamError(`pipe aborted: ${reason}`));
  }

  /** The reader side gave up (it exited or failed): unblock and refuse any
   * further or pending write with the broken-pipe naming. */
  readerGone() {
    log.debug('reader gone', {});
    this.readerClosed = true;
    const writers = this.waitingWriters.splice(0);
    for (const w of writers) w.reject(new StreamError('write to a pipe whose reader has closed (broken pipe)'));
  }

  wakeReaders() {
    log.debug('wake readers', {});
    const readers = this.waitingReaders.splice(0);
    for (const w of readers) w.resolve();
  }
}

/** The downstream end of one pipe. `read` pulls one chunk at a time in the
 * order the writer appended them. */
export class PipeReader {
  constructor(writer) {
    log.debug('pipe reader created', {});
    this.writer = writer;
    this.done = false;
  }

  /** Pull the next chunk: `{ done: false, bytes }`, or `{ done: true }`
   * after the writer closed and the window drained. Rejects if the writer
   * aborted (a failed upstream stage). */
  async read() {
    log.debug('pipe read', { pending: this.writer.pendingBytes });
    for (;;) {
      if (this.writer.chunks.length > 0) {
        const bytes = this.writer.chunks.shift();
        this.writer.pendingBytes -= bytes.length;
        this.wakeWriters();
        return { done: false, bytes };
      }
      if (this.writer.closed) {
        this.done = true;
        return { done: true };
      }
      if (this.writer.aborted !== undefined) {
        throw new StreamError(`pipe aborted: ${this.writer.aborted}`);
      }
      const waiter = deferred();
      this.writer.waitingReaders.push(waiter);
      await waiter.promise;      // woken by write, close, or abort
    }
  }

  /** The consumer is gone (it exited early): the writer must not stall on a
   * full window forever — its writes refuse by name instead. */
  close() {
    log.debug('pipe reader closed', {});
    this.done = true;
    this.writer.readerGone();
  }

  wakeWriters() {
    log.debug('wake writers', {});
    const writers = this.writer.waitingWriters;
    const awake = writers.splice(0);
    for (const w of awake) w.resolve();
  }
}

/** One pipe: hand `writer` to the upstream stage, `reader` to the
 * downstream stage. */
export const createPipe = () => {
  log.debug('pipe created', {});
  const writer = new PipeWriter();
  const reader = new PipeReader(writer);
  return { writer, reader };
};

/** The terminal sink of a run (the run's captured stdout/stderr, or a
 * redirect target the executor owns). It consumes eagerly and never blocks:
 * nothing downstream of it exists, so there is no window to bound — the
 * run-level result size is the executor's v1-carried concern, not a stream
 * concern. */
export class CaptureWriter {
  constructor() {
    log.debug('capture sink created', {});
    this.parts = [];
    this.bytesLength = 0;
    this.closed = false;
  }

  async write(chunk) {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
    log.debug('capture write', { bytes: bytes.length });
    if (this.closed) throw new StreamError('write to a closed capture sink');
    this.parts.push(bytes);
    this.bytesLength += bytes.length;
  }

  async close() {
    log.debug('capture sink closed', { bytes: this.bytesLength });
    this.closed = true;
  }

  /** The whole captured stream as bytes (a single copy). */
  bytes() {
    log.debug('capture bytes', { length: this.bytesLength });
    const out = new Uint8Array(this.bytesLength);
    let at = 0;
    for (const part of this.parts) { out.set(part, at); at += part.length; }
    return out;
  }

  /** The whole captured stream as utf8 text. */
  text() {
    log.debug('capture text', {});
    return decoder.decode(this.bytes());
  }
}
