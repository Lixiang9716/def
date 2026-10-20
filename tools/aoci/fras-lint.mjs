// dsh:logging-exempt (tool: its stdout is the verdict)
/**
 * fras-lint.mjs — pre-submission local lint for AOCI entry batches. Runs the
 * same limits the machine enforces so a candidate batch can be judged before
 * it reaches aoci_update_entry — whose repair loop is the slow way to learn
 * the same thing.
 *
 * Authority for every limit below: the machine contract, FRAS v2 (aoci.txt
 * `#Format-Version: cognition-volumes/v1`, code volume `format=object-fras-v2`).
 * When the machine changes a limit, change it here in the same change — this
 * file must stay isomorphic to the contract, never looser.
 *
 * Input: entries shaped [{path, source_sha256, candidate_id, new_entry}, ...]
 * — the aoci_maintain candidate batch verbatim. Reads --file <entries.json>
 * or, by default, stdin.
 *
 * Output: findings JSON [{candidate_index, path, field, rule_code, expected,
 * actual, message}] on stdout. Exit 1 when any finding exists, 0 when clean,
 * 2 when the input itself is unreadable or not a batch (a usage error, not a
 * compliance verdict).
 *
 * usage: node tools/aoci/fras-lint.mjs [--file <entries.json>]
 */
import { readFileSync } from 'node:fs';

// FRAS v2 limits. A rune is a Unicode code point — [...str].length, never
// .length, whose UTF-16 units undercount astral characters.
const LIMITS = {
  F_RUNES: 160,
  R_RUNES: 360,
  R_ITEMS: 8, // R items are split on ", "
  A_RUNES: 400,
  A_ITEMS: 6, // A items are split on ", "
  // S budget by the tag's C rank. Keys are C ranks, values are rune caps.
  S_BY_C: { 9: 600, 8: 600, 7: 200, 6: 200, 5: 200, 4: 200, 3: 50, 2: 50, 1: 50 },
};
const TAG_RE = /^[A-Z0-9]{4,5}$/;
const FIELDS = ['F', 'R', 'A', 'S'];
const ITEM_LIMITS = { R: LIMITS.R_ITEMS, A: LIMITS.A_ITEMS };
const RUNE_LIMITS = { F: LIMITS.F_RUNES, R: LIMITS.R_RUNES, A: LIMITS.A_RUNES };

const args = process.argv.slice(2);
let file;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file') {
    if (i + 1 >= args.length) {
      console.error('fras-lint: --file needs a path argument');
      process.exit(2);
    }
    file = args[++i];
  } else {
    console.error(`fras-lint: unknown argument '${args[i]}'`);
    console.error('usage: node tools/aoci/fras-lint.mjs [--file <entries.json>]');
    process.exit(2);
  }
}

let raw;
try {
  raw = readFileSync(file ?? 0, 'utf8');
} catch (err) {
  console.error(`fras-lint: cannot read ${file ?? 'stdin'}: ${err.message}`);
  process.exit(2);
}
let entries;
try {
  entries = JSON.parse(raw);
} catch (err) {
  console.error(`fras-lint: input is not JSON: ${err.message}`);
  process.exit(2);
}
if (!Array.isArray(entries)) {
  console.error('fras-lint: input must be an array of entries [{path, new_entry, ...}]');
  process.exit(2);
}

const runes = (s) => [...s].length;
const findings = [];
const add = (candidate_index, path, field, rule_code, expected, actual, message) =>
  findings.push({ candidate_index, path, field, rule_code, expected, actual, message });

// The C rank rides inside the tag: every FRAS v2 tag observed so far
// (FV4T, FV2T, EG8S) carries the rank as its single digit; on a
// hypothetical multi-digit tag the C position (index 2) wins.
const cRankOf = (tag) => {
  if (/\d/.test(tag[2] ?? '')) return Number(tag[2]);
  const digits = tag.match(/\d/g) ?? [];
  return digits.length === 1 ? Number(digits[0]) : null;
};

const checkField = (candidate_index, path, tag, field, content) => {
  const runeCap = RUNE_LIMITS[field];
  if (runeCap !== undefined) {
    const n = runes(content);
    if (n > runeCap) {
      add(candidate_index, path, field, 'runes-over', `${field} ≤ ${runeCap} runes`,
        `${n} runes`, `${field} is ${n} runes, over the ${runeCap}-rune FRAS v2 limit`);
    }
  }
  const itemCap = ITEM_LIMITS[field];
  if (itemCap !== undefined) {
    const items = content.split(', ');
    if (items.length > itemCap) {
      add(candidate_index, path, field, 'items-over', `${field} ≤ ${itemCap} items`,
        `${items.length} items`, `${field} has ${items.length} items, over the ${itemCap}-item limit`);
    }
  }
  if (field !== 'S') return;
  const rank = TAG_RE.test(tag) ? cRankOf(tag) : null;
  const sCap = rank !== null ? LIMITS.S_BY_C[rank] : undefined;
  if (sCap === undefined) {
    add(candidate_index, path, field, 's-limit-c-rank', 'a C rank in 1..9 inside the tag',
      rank === null ? tag : `C rank ${rank}`, 'cannot resolve an S budget without the tag\'s C rank');
    return;
  }
  const n = runes(content);
  if (n > sCap) {
    add(candidate_index, path, field, 'runes-over', `S ≤ ${sCap} runes (C rank ${rank})`,
      `${n} runes`, `S is ${n} runes, over the ${sCap}-rune budget for C rank ${rank}`);
  }
};

const checkSegments = (candidate_index, path, tag, segments) => {
  if (segments.length !== FIELDS.length) {
    add(candidate_index, path, 'new_entry', 'segment-count',
      '4 segments joined by " | " (F, R, A, S)', `${segments.length} segments`,
      'an entry carries exactly the F/R/A/S segments, " | "-separated, in order');
    return;
  }
  segments.forEach((segment, i) => {
    const field = FIELDS[i];
    if (!segment.startsWith(`${field}:`)) {
      add(candidate_index, path, field, 'segment-prefix', `${field}:…`, segment.slice(0, 40),
        `segment ${i + 1} does not open with the '${field}:' prefix`);
      return;
    }
    checkField(candidate_index, path, tag, field, segment.slice(field.length + 1));
  });
};

const checkEntry = (entry, candidate_index) => {
  const path = typeof entry.path === 'string' ? entry.path : '';
  if (typeof entry.new_entry !== 'string' || entry.new_entry === '') {
    add(candidate_index, path, 'new_entry', 'entry-shape', 'a non-empty new_entry string',
      JSON.stringify(entry.new_entry ?? null), 'entry carries no lintable new_entry');
    return;
  }
  const head = entry.new_entry.match(/^(\S+?)\[([^\]]*)\]: (.*)$/);
  if (!head) {
    add(candidate_index, path, 'new_entry', 'line-shape', '<path>[<tag>]: F:… | R:… | A:… | S:…',
      entry.new_entry.slice(0, 60), 'entry line does not open as <path>[<tag>]: body');
    return;
  }
  const tag = head[2];
  if (!TAG_RE.test(tag)) {
    add(candidate_index, path, 'tag', 'tag-format', '[A-Z0-9]{4,5}', tag,
      `tag '${tag}' is not [A-Z0-9]{4,5}`);
  }
  checkSegments(candidate_index, path, tag, head[3].split(' | '));
};

entries.forEach(checkEntry);

console.log(JSON.stringify(findings, null, 2));
console.error(`fras-lint: ${entries.length} entries, ${findings.length} findings`);
process.exit(findings.length > 0 ? 1 : 0);
