// dsh:logging-exempt (dev tool: its stdout is the report)
/** sweep-ledger.test.mjs — the ledger face's tests, split from
 * sweep.test.mjs with the face (2026-10-22). */
import { expect, it } from 'vitest';
import { classifyDisagreements, renderTotals } from './sweep-ledger.js';

it('classifyDisagreements splits the NO rows against the ledger and names stale rows', () => {
  const rows = [
    { stem: 'd-row', qjs: '{"failed":4}', node: '{"failed":0}', agree: 'NO' },
    { stem: 'c-row', qjs: '{"failed":1}', node: '{"failed":0}', agree: 'NO' },
    { stem: 'open-row', qjs: '{"failed":1}', node: '{"failed":0}', agree: 'NO' },
    { stem: 'fixed-row', qjs: '{"failed":0}', node: '{"failed":0}', agree: 'yes' },
  ];
  const ledger = {
    'd-row': { class: 'd-contract', note: 'worker_threads unavailable by design' },
    'c-row': { class: 'c-delta', note: 'real proxy routing' },
    'fixed-row': { class: 'c-delta', note: 'stale — the row flipped green' },
  };
  const classification = classifyDisagreements(rows, ledger);
  expect(classification.documented).toEqual(['d-row', 'c-row']);
  expect(classification.unexplained).toEqual(['open-row']);
  expect(classification.stale).toEqual(['fixed-row']);
  expect(classification.classes['d-contract']).toEqual(['d-row']);
  expect(classification.classes['c-delta']).toEqual(['c-row']);
  expect(classification.classes['both-red']).toEqual([]);
});

it('renderTotals renders the accounting lines with per-class counts', () => {
  const classification = {
    documented: ['d-row', 'c-row'],
    unexplained: ['open-row'],
    stale: ['fixed-row'],
    classes: { 'd-contract': ['d-row'], 'c-delta': ['c-row'], 'both-red': [] },
  };
  const text = renderTotals({ specs: 4, qjsGreen: 1, disagreements: 3 }, 'tmp/r.tsv', classification);
  expect(text).toBe(
    [
      'specs: 4',
      'qjs specs with a green summary: 1 (see the note for the',
      '  three-way classification: green / partial / module-gap —',
      '  module-gap rows carry no summary by construction)',
      'failed-count disagreements (qjs vs node): 3',
      '  documented by the differential ledger: 2 (d-contract 1, c-delta 1, both-red 0)',
      '  unexplained: 1',
      '    UNEXPLAINED: open-row',
      '    STALE LEDGER ROW (no longer disagreeing): fixed-row',
      'report: tmp/r.tsv',
      '',
    ].join('\n'),
  );
});

