/**
 * Transport SEAM for the vendored @deepseek-ai/dsh-llm package (M2 real LLM
 * client machinery). The package is verbatim upstream (vendor/dsh/
 * llm@0.1.6-alpha.2, PROVENANCE.md there); quickjs-ng provides neither fetch
 * nor a cordis runtime, so THIS module is the seam layer that mounts it:
 *
 * - `OpenAiCompatAdapter` — an upstream `LlmAdapter` subclass speaking the
 *   harness StreamChunk vocabulary, whose HTTP transport is the gateway
 *   `httpFetch` primitive: POST {baseUrl}/chat/completions with stream:true,
 *   SSE frames parsed incrementally from the response body's AsyncIterable
 *   (CRLF tolerated, `:` keep-alive comments ignored, data lines buffered
 *   across chunk boundaries, `[DONE]` terminator), token deltas as
 *   text-delta chunks, finish_reason/usage surfaced, abort wired to
 *   response.abort(), and non-200 / premature-EOF mapped onto the upstream
 *   LlmError taxonomy (AUTH / RATE_LIMIT / SERVER / TRANSPORT / ABORTED).
 *   Provider endpoint and credentials are HOST CONFIGURATION (constructor
 *   argument) — nothing here names a real provider.
 * - `createSpikeCtx` — the minimal cordis Context surface `LlmRuntime` and
 *   the `Service` base class use (reflect.provide / effect / events.dispatch
 *   / logger / waterfall / get). The spike has no full cordis fiber
 *   scheduler; the same shim-seam discipline as util-crypto's
 *   `crypto.getRandomValues`.
 * - `createAbortSignal` — a duck-typed AbortSignal (upstream only reads
 *   `.aborted` and dsh-timeout only notifies through signals).
 * - `structuredCloneShim` — quickjs-ng has no structuredClone; the scenario
 *   installs it BEFORE importing the vendored package (its message helpers
 *   deep-clone through it).
 *
 * Event-driven end to end: the adapter consumes the httpFetch byte stream
 * (fed by host http.body/http.end/http.error events), no polling anywhere.
 */
import { createLogger } from './logger.js';
import { GatewayError, httpFetch } from './gateway.js';
import { LlmAdapter, LlmError, attributionHeaders } from 'vendor/dsh/llm@0.1.6-alpha.2/lib/index.js';

const log = createLogger('dsh.llm.seam');

/** UTF-8 encode a JS string into bytes (the gateway moves bytes, not text). */
const utf8Encode = (text) => {
  const out = [];
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xC0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return new Uint8Array(out);
};

/** Decode one complete UTF-8 byte line (no trailing newline) to a string. */
const utf8DecodeLine = (bytes) => {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b0 = bytes[i];
    let cp = b0;
    let width = 1;
    if (b0 >= 0xF0) { cp = b0 & 7; width = 4; }
    else if (b0 >= 0xE0) { cp = b0 & 15; width = 3; }
    else if (b0 >= 0xC0) { cp = b0 & 31; width = 2; }
    for (let k = 1; k < width && i + k < bytes.length; k++) {
      cp = (cp << 6) | (bytes[i + k] & 63);
    }
    out += String.fromCodePoint(cp);
    i += width;
  }
  return out;
};

const CHUNK_EXIT_CODES = {
  cancelled: 'ABORTED',
  timeout: 'TIMEOUT',
  network: 'TRANSPORT',
  invalid: 'TRANSPORT',
  io: 'TRANSPORT',
  denied: 'TRANSPORT',
  unavailable: 'TRANSPORT',
};

/** Map a gateway/transport failure onto the upstream LlmError taxonomy. */
const transportError = (err, detail) => {
  if (err instanceof LlmError) return err;
  const code = err instanceof GatewayError
    ? (CHUNK_EXIT_CODES[err.code] ?? 'TRANSPORT')
    : 'TRANSPORT';
  const message = detail ? `${detail}: ${err.message}` : err.message;
  return new LlmError(message, code, { cause: err });
};

/** Status → upstream code; 5xx is SERVER, credential failures are AUTH. */
const statusToCode = (status) => {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 429) return 'RATE_LIMIT';
  if (status >= 500) return 'SERVER';
  return 'TRANSPORT';
};

const FINISH_KINDS = { stop: { kind: 'stop' }, length: { kind: 'max-tokens' } };

/** One SSE event decoded from the wire: {done|finishReason|usage|delta}. */
const decodeSsePayload = (payload) => {
  if (payload === '[DONE]') return { done: true };
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (err) {
    throw transportError(err, 'malformed SSE data frame');
  }
  const choice = Array.isArray(parsed.choices) ? parsed.choices[0] : undefined;
  const out = {};
  const text = choice?.delta?.content;
  if (typeof text === 'string' && text.length > 0) out.delta = text;
  if (choice?.delta?.reasoning_content) out.reasoningDelta = choice.delta.reasoning_content;
  if (typeof choice?.finish_reason === 'string') out.finishReason = choice.finish_reason;
  if (parsed.usage) {
    out.usage = {
      inputTokens: parsed.usage.prompt_tokens ?? 0,
      outputTokens: parsed.usage.completion_tokens ?? 0,
      ...(parsed.usage.total_tokens !== undefined
        ? { totalTokens: parsed.usage.total_tokens }
        : { totalTokens: (parsed.usage.prompt_tokens ?? 0) + (parsed.usage.completion_tokens ?? 0) }),
    };
  }
  return out;
};

/** Harness content blocks → OpenAI wire text (text joined; tool results
 * become role:'tool' messages keyed by their call id). */
const blocksToText = (blocks) => blocks
  .filter((block) => block.type === 'text')
  .map((block) => block.text)
  .join('');

const toWireMessages = (messages) => messages.map((message) => {
  const blocks = Array.isArray(message.content) ? message.content : [];
  const toolResult = blocks.find((block) => block.type === 'tool-result');
  if (toolResult) {
    return {
      role: 'tool',
      tool_call_id: toolResult.toolCallId,
      content: blocksToText(toolResult.content ?? []),
    };
  }
  return { role: message.role, content: blocksToText(blocks) };
});

/** Minimal cordis Context for the vendored LlmRuntime (see module doc). */
export const createSpikeCtx = () => {
  const services = new Map();
  return {
    reflect: { provide: (name, service) => services.set(name, service) },
    get: (name) => services.get(name),
    /** cordis effect: run the setup section now, return the disposer that
     * completes the generator and unwinds its yielded cleanups. */
    effect: (fn) => {
      const cleanups = [];
      const gen = fn();
      const step = () => {
        for (;;) {
          const r = gen.next();
          if (r.done) return;
          cleanups.push(r.value);
        }
      };
      step();
      return () => {
        step();
        for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]();
      };
    },
    events: { dispatch: () => [] },
    logger: {
      warn: (message) => log.warn('cordis', { message: String(message) }),
      info: (message) => log.debug('cordis', { message: String(message) }),
    },
    waterfall: (_service, _name, _options, fallback) => fallback(),
  };
};

/** Duck-typed AbortSignal: upstream reads `.aborted`; adapters register
 * callbacks that fire synchronously when the caller aborts. */
export const createAbortSignal = () => {
  const listeners = [];
  const signal = {
    aborted: false,
    addEventListener: (fn) => listeners.push(fn),
    abort: () => {
      log.debug('abort signal fired');
      if (signal.aborted) return;
      signal.aborted = true;
      listeners.forEach((fn) => fn());
    },
  };
  return signal;
};

/** Buffer one httpFetch byte chunk onto `state`, returning complete lines. */
const takeLines = (state, bytes) => {
  for (const byte of bytes) {
    if (byte === 0x0A) {
      state.lines.push(state.partial);
      state.partial = [];
    } else {
      state.partial.push(byte);
    }
  }
  const lines = state.lines;
  state.lines = [];
  return lines.map(utf8DecodeLine);
};

/** Consume one SSE line into the event accumulator; true when an event
 * dispatched. Blank line dispatches, `:` comments ignored, `data:` fields
 * buffered (multiple data lines join with \n per the SSE spec). */
const consumeSseLine = (state, line) => {
  if (line.endsWith('\r')) line = line.slice(0, -1);
  if (line === '') {
    if (state.data.length === 0) return false;
    state.payload = state.data.join('\n');
    state.data = [];
    return true;
  }
  if (line.startsWith(':')) return false; // keep-alive comment
  if (line.startsWith('data:')) {
    const value = line.slice(5);
    state.data.push(value.startsWith(' ') ? value.slice(1) : value);
  }
  return false; // event:/id:/retry: fields are not part of this protocol
};

/**
 * OpenAI-compatible chat-completions adapter over the gateway httpFetch
 * primitive — the transport shim the mission for M2's real LLM client.
 * `config`: { baseUrl (e.g. http://127.0.0.1:PORT/v1), apiKey?, headers? }.
 */
export class OpenAiCompatAdapter extends LlmAdapter {
  constructor(config) {
    super();
    this.config = config;
    this.attribution = attributionHeaders(); // upstream's own identity headers
  }

  providerInfo(provider) {
    return { id: provider, name: `OpenAI-compatible (${provider})` };
  }

  resolveModel(provider, model) {
    return Promise.resolve({ provider, id: model, name: model });
  }

  /** Stream one chat completion as harness StreamChunks. Adapter failures
   * throw; the upstream runtime converts them to terminal finish chunks. */
  async *stream(options) {
    log.debug('llm stream', { provider: options.provider, model: options.model });
    const res = await this.dispatch(options);
    if (options.signal?.addEventListener) {
      options.signal.addEventListener(() => res.abort());
    }
    if (res.status !== 200) {
      await this.drainErrorBody(res);
      const detail = this.lastErrorDetail ?? '';
      throw new LlmError(
        `${res.status} from ${this.config.baseUrl}/chat/completions${detail ? `: ${detail}` : ''}`,
        statusToCode(res.status),
        { status: res.status },
      );
    }
    yield* this.parseSseStream(res, options);
  }

  async dispatch(options) {
    const headers = {
      'content-type': 'application/json',
      ...this.attribution,
      ...this.config.headers,
      ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
    };
    const wire = {
      model: options.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: toWireMessages(options.messages ?? []),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      ...(options.stop !== undefined ? { stop: options.stop } : {}),
    };
    log.debug('httpFetch chat/completions', { headers: Object.keys(headers) });
    try {
      return await httpFetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: utf8Encode(JSON.stringify(wire)),
      });
    } catch (err) {
      throw transportError(err, 'httpFetch failed');
    }
  }

  /** Best-effort read of a short non-SSE error body for the diagnostics. */
  async drainErrorBody(res) {
    const chunks = [];
    let total = 0;
    try {
      for await (const chunk of res.body) {
        chunks.push(utf8DecodeLine([...chunk]));
        total += chunk.length;
        if (total > 4096) break;
      }
    } catch (_readFailure) {
      /* the status code is the primary fact; a body that will not read is noise */
    }
    this.lastErrorDetail = chunks.join('').trim().slice(0, 512);
    log.debug('error body drained', { status: res.status, bytes: total });
  }

  /** Parse the SSE byte stream into harness chunks. Throws LlmError ABORTED
   * when the caller's signal fired, TRANSPORT on premature EOF. */
  async *parseSseStream(res, options) {
    const state = { lines: [], partial: [], data: [], payload: null };
    let finishReason;
    let usage;
    let done = false;
    try {
      for await (const bytes of res.body) {
        for (const line of takeLines(state, bytes)) {
          if (!consumeSseLine(state, line)) continue;
          const ev = decodeSsePayload(state.payload);
          if (ev.done) { done = true; break; }
          if (ev.delta !== undefined) yield { type: 'text-delta', index: 0, text: ev.delta };
          if (ev.reasoningDelta !== undefined) yield { type: 'reasoning-delta', index: 1, text: ev.reasoningDelta };
          if (ev.usage !== undefined) {
            usage = ev.usage;
            yield { type: 'usage', usage: ev.usage };
          }
          if (ev.finishReason !== undefined) finishReason = ev.finishReason;
        }
        if (done) break;
      }
    } catch (err) {
      throw transportError(err, 'stream failed');
    }
    if (!done) {
      throw new LlmError('stream closed before the [DONE] terminator', 'TRANSPORT');
    }
    log.debug('sse stream finished', { finishReason, usage: !!usage });
    yield {
      type: 'finish',
      reason: options.signal?.aborted
        ? { kind: 'aborted', failure: { message: 'aborted by the caller', code: 'ABORTED' } }
        : FINISH_KINDS[finishReason] ?? { kind: 'stop' },
    };
  }
}

/** The vendored package's own identity header value (deepseek-harness/x). */
export const llmAttributionHeaders = () => attributionHeaders();
