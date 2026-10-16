// test-hardening row 13 — provider cassette replay: RECORDED wire shapes
// (not generative — that is row 12's fastcheck face) replayed through the
// REAL streamChat seam. Each cassette in cassettes/*.json pins one provider
// contract quirk byte-faithfully — the chunk boundaries are the recording —
// and asserts the full folded result plus the model-event count.
//
// Provenance honesty: every cassette's `provenance` field says where its
// shape comes from (a documented provider contract, an observed proxy
// behavior, or a recorded cut class). None claims bytes we did not see.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { streamChat } from '../../../runtime/dsh/llm.js';

const CASSETTES = join(dirname(fileURLToPath(import.meta.url)), 'cassettes');
const cassettes = readdirSync(CASSETTES)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(CASSETTES, f), 'utf8')));

const transportFor = (chunks) =>
  async () => ({
    status: 200,
    headers: {},
    abort: () => {},
    body: (async function* () {
      for (const c of chunks) yield Buffer.from(c, 'utf8');
    })(),
  });

const replay = async (cassette) => {
  const events = [];
  const res = await streamChat({
    fetchImpl: transportFor(cassette.chunks),
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'k',
    model: 'requested-model',
    messages: [{ role: 'user', content: 'hi' }],
    on: (event, fields) => events.push([event, fields]),
  });
  return { res, events };
};

describe('provider cassette replay (row 13): recorded wire shapes through the real streamChat', () => {
  for (const cassette of cassettes) {
    it(`${cassette.name}: ${cassette.quirk}`, { timeout: 30000 }, async () => {
      const { res, events } = await replay(cassette);
      expect(res.text).toBe(cassette.expect.text);
      expect(res.reasoning).toBe(cassette.expect.reasoning);
      expect(res.deltas).toBe(cassette.expect.deltas);
      expect(res.reasoningDeltas).toBe(cassette.expect.reasoningDeltas);
      expect(res.finishReason).toBe(cassette.expect.finishReason);
      expect(res.served).toBe(cassette.expect.served);
      const modelEvents = events.filter(([e]) => e === 'model');
      expect(modelEvents).toHaveLength(cassette.expect.modelEvents);
      // the delta/reasoning transcripts are ordered and non-empty exactly as
      // the counters say (structure, not just totals); each kind carries its
      // own 0-based index series
      const deltas = events.filter(([e]) => e === 'delta');
      const reasonings = events.filter(([e]) => e === 'reasoning');
      expect(deltas).toHaveLength(cassette.expect.deltas);
      expect(reasonings).toHaveLength(cassette.expect.reasoningDeltas);
      for (const [i, [, f]] of deltas.entries()) expect(f.index).toBe(i);
      for (const [i, [, f]] of reasonings.entries()) expect(f.index).toBe(i);
    });
  }

  it('the cassette roster stays honest: every fixture carries provenance and an expectation', () => {
    expect(cassettes.length).toBeGreaterThanOrEqual(8);
    for (const c of cassettes) {
      expect(c.name).toBeTruthy();
      expect(c.provenance).toBeTruthy();
      expect(c.quirk).toBeTruthy();
      expect(Array.isArray(c.chunks) && c.chunks.length > 0).toBe(true);
      expect(c.expect).toBeTruthy();
    }
  });
});
