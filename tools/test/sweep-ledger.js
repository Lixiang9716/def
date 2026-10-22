// dsh:logging-exempt (dev tool: its stdout is the progress line)
/** sweep-ledger.js — the differential ledger face, split from sweep.mjs
 * when the file crossed the line budget (2026-10-22). See the ledger
 * commentary at loadLedger. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SweepFailure } from './sweep.mjs';

/** The differential ledger (test/upstream-suite/differential-ledger.json,
 * committed): stem -> {class, note} for every row whose NO is a DOCUMENTED
 * finding — d-contract (the qjs host answers a Node-only capability
 * unavailable by design; the node leg is the honest reference), c-delta
 * (a real behavioral difference with its mechanism named), both-red (the
 * row struggles on both legs; signatures documented). The sweep keeps the
 * honest NO per row; the ledger only ACCOUNTS for the surface in the
 * totals, so an unexplained disagreement is visible the moment it appears. */
export const loadLedger = (root) => {
  const path = join(root, 'test/upstream-suite/differential-ledger.json');
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('the ledger must be a JSON object keyed by spec stem');
    }
    return parsed;
  } catch (error) {
    throw new SweepFailure(1, `sweep: differential-ledger.json is malformed: ${error.message}`);
  }
};

/** Split the NO rows against the ledger: documented (with per-class counts),
 * unexplained (open surface), and stale (ledger rows that no longer
 * disagree — the ledger must follow the tree, rule 5). */
export const classifyDisagreements = (rows, ledger) => {
  const no = rows.filter((r) => r.agree === 'NO');
  const documented = [];
  const unexplained = [];
  const classes = { 'd-contract': [], 'c-delta': [], 'both-red': [] };
  for (const row of no) {
    const entry = ledger[row.stem];
    if (entry && classes[entry.class] !== undefined) {
      classes[entry.class].push(row.stem);
      documented.push(row.stem);
    } else {
      unexplained.push(row.stem);
    }
  }
  const noSet = new Set(no.map((r) => r.stem));
  const stale = Object.keys(ledger).filter((stem) => !noSet.has(stem));
  return { documented, unexplained, stale, classes };
};


/** The totals block — the bash sweep's exact four segments (the second
 * carrying its three-line parenthetical note, verbatim); with a
 * classification, the accounting lines follow the disagreement count and
 * name every unexplained and stale row (rule 5: the open surface is never
 * a bare number). */
export const renderTotals = (totals, reportPath, classification) => {
  let text =
    `specs: ${totals.specs}\n` +
    `qjs specs with a green summary: ${totals.qjsGreen} (see the note for the\n` +
    '  three-way classification: green / partial / module-gap —\n' +
    '  module-gap rows carry no summary by construction)\n' +
    `failed-count disagreements (qjs vs node): ${totals.disagreements}\n`;
  if (classification) {
    const c = classification.classes;
    text +=
      `  documented by the differential ledger: ${classification.documented.length}` +
      ` (d-contract ${c['d-contract'].length}, c-delta ${c['c-delta'].length},` +
      ` both-red ${c['both-red'].length})\n` +
      `  unexplained: ${classification.unexplained.length}\n`;
    for (const stem of classification.unexplained) text += `    UNEXPLAINED: ${stem}\n`;
    for (const stem of classification.stale) text += `    STALE LEDGER ROW (no longer disagreeing): ${stem}\n`;
  }
  return text + `report: ${reportPath}\n`;
};

