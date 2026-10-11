// dsh:logging-exempt (host shim: no side effects to log)
/**
 * node:stream — the subset the vendored spine consumes: Readable.from
 * (iterable source), pipeline (serial pump, callback and promise forms),
 * PassThrough (a buffered identity segment), Writable (the sink face the
 * ssh protocol specs drive: user `write` impl, highWaterMark backpressure,
 * 'drain', destroy), and Duplex (both faces: the options constructor the
 * ptc-runtime channel drives, plus `Duplex.from({readable, writable})`
 * pairing). Streams here are the one-shot-on-end shapes the node:zlib shim
 * exposes — the pipeline drains async iterators in order, which is exactly
 * how the corpus composes generation.js's rows -> zstd -> sink.
 *
 * This file is the AGGREGATOR: the readable base classes live in
 * node-stream-readable.js (imported by NOTHING else — the cycle fix,
 * 2026-10-11: the bare 'node:stream' row and the bundle-path spell are two
 * module instances, and the old writable→node-stream back-import made the
 * second instance's duplex import evaluate `extends SinkEvents` against a
 * mid-evaluation writable — the session-persistence-jsonl link's
 * "SinkEvents is not initialized"). Every face re-exported here resolves to
 * the same class object under every spelling.
 */
import { MiniStream, PassThrough, Readable } from 'upstream/shims/node-stream-readable.js';
export { MiniStream, PassThrough, Readable };

/** Shared listener plumbing for the Writable/Duplex sinks (the events.js
 * subset they need: on/once/off/emit/listenerCount — `events.once(stream,
 * 'drain')` rides the same face). */
// The writable half lives in node-stream-writable.js (the file crossed the
// size budget); re-exported here so bare 'node:stream' and every bundle-path
// import keep their shape. Writable/Duplex compose the readable faces above.
import { Writable, pipeline } from 'upstream/shims/node-stream-writable.js';
import { Duplex } from 'upstream/shims/node-stream-duplex.js';
export { Writable, Duplex, pipeline };
export const duplexPair = (options) => {
  const first = new PassThrough();
  const second = new PassThrough();
  const client = Duplex.from({ readable: first, writable: second });
  const server = Duplex.from({ readable: second, writable: first });
  return [client, server];
};

export default { Readable, PassThrough, Writable, Duplex, pipeline, duplexPair };
