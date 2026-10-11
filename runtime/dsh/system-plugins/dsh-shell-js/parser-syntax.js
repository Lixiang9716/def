/**
 * parser-syntax.js — the hand-written bash-subset parser of dsh-shell-js
 * (the 2026-10-11 swap that replaced the vendored bash-parser@0.5.0; split
 * out of parser.js for the code-size gate's file budgets, the same move
 * exec.js made out of index.js). parser.js owns the route + vendor seam and
 * re-exports this module's two faces (`parseCommandLine`, `ShellParseError`),
 * so the executor's import (exec.js) is untouched.
 *
 * A recursive-descent parser over a whitespace tokenizer. It accepts exactly
 * the §4.3 whitelist dialect:
 *
 *   - tokenizer: single/double quotes, backslash escapes, `#` comments,
 *     whitespace word splitting, newline as a command separator;
 *   - `$VAR` / `${VAR}` simple expansion (raw-face `loc` convention kept —
 *     the executor's quote machine, exec.js `expandWord`, indexes it);
 *   - `|` pipelines, `&&`/`||` (left-folded, bash association), `;` and
 *     newline sequences, `>`/`>>`/`2>`/`2>>` redirects, `FOO=bar` prefix
 *     assignments, `*`/`?`/`[…]` glob characters passed through in word
 *     position (expansion is the executor's, via minimatch).
 *
 * Everything OUTSIDE the dialect is refused BY NAME at parse time
 * (ShellParseError → exit 2, stderr naming the construct): `$(…)`,
 * `$((…))`, backticks, heredocs `<<`, here-strings `<<<`, `<`/`>&`/`<&`/
 * `>|`/`<>` redirects, `&>`/`&`, `!` negation, subshells `( … )`, groups
 * `{ … }`, if/while/for/case/function, parameter-expansion operators
 * (`${FOO:-x}`, `${#x}`, special parameters `$@ $? $$ …`), ANSI-C `$'…'`.
 * Error classification is self-defined (no more message-text matching):
 * `ShellParseError.syntax` is true only for unclosed quotes / `${`.
 *
 * The supported-dialect AST is byte-identical to bash-parser's (74-case
 * differential against the vendored parser at swap time), so the executor
 * contract (exec.js) is untouched. Where bash-parser crashed or failed on
 * VALID bash, bash semantics win: a lone `$` is the literal character,
 * `{`/`}` are plain word characters outside command position. The fold
 * table for quote removal is bash-parser's exact one (double quotes
 * unescape only `\ " '`; the raw face of expansion-bearing words keeps the
 * source verbatim) — every executor-observable output is byte-identical to
 * the previous parser, verified by walking exec.js's quote machine over
 * both parsers' words.
 */

import { createLogger } from 'logger.js';

const log = createLogger('dsh.shell.js.syntax');

/** Parse failure of a command line. `syntax` is TRUE only for an unclosed
 * quote or an unclosed `${` (the executor renders that as
 * "(unclosed quote)"); every other failure — including the by-name dialect
 * refusals — is a plain grammar/semantic failure. */
export class ShellParseError extends Error {
  constructor(message, syntax) {
    log.debug('shell parse error', { syntax: syntax === true });
    super(message);
    this.name = 'ShellParseError';
    this.syntax = syntax === true;
  }
}

/** The unsupported-redirect suffix shared by the redirect refusals. */
const SUPPORTED_REDIRECTS = '(supported: > >> 2> 2>>)';

const OPERATOR_CHARS = new Set(['|', '&', ';', '(', ')', '<', '>']);
const WORD_BREAK = new Set([' ', '\t', '\n', ...OPERATOR_CHARS]);
const RESERVED = new Set([
  'if', 'then', 'elif', 'else', 'fi', 'for', 'while', 'until',
  'do', 'done', 'case', 'esac', 'select', 'function', 'time',
]);
const SPECIAL_PARAM = new Set(['?', '@', '*', '#', '-', '!', '$']);
const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_]/;

class Scanner {
  constructor(text) {
    log.debug('scan', { chars: text.length });
    this.text = text; this.at = 0;
  }
  peek(offset = 0) { return this.text[this.at + offset] ?? ''; }
  take() { return this.text[this.at++] ?? ''; }
  done() { return this.at >= this.text.length; }
}

const refuse = (message, syntax = false) => {
  log.debug('parse refuse', { message });
  throw new ShellParseError(message, syntax);
};

/** Spaces/tabs; a `#` at a word start comments out the rest of the line. */
const skipBlank = (s) => {
  log.debug('skip blank', { at: s.at });
  for (;;) {
    const c = s.peek();
    if (c === ' ' || c === '\t') { s.at += 1; continue; }
    if (c === '#') { while (!s.done() && s.peek() !== '\n') s.at += 1; continue; }
    return;
  }
};

/** Newlines separate commands; `&&`/`|` continue across them (bash). */
const skipNewlines = (s) => {
  log.debug('skip newlines', { at: s.at });
  while (s.peek() === '\n') { s.at += 1; skipBlank(s); }
};

/** One word's two-faced text: `raw` is the SOURCE-VERBATIM face (the
 * executor's quote machine indexes expansions against it); `folded` is the
 * quote-removed data (a word without expansions carries it alone). */
const recordExpansion = (w, start, parameter) => {
  log.debug('expansion', { parameter });
  (w.expansions ??= []).push({
    loc: { start, end: w.raw.length - 1 },
    parameter,
    type: 'ParameterExpansion',
  });
};

const scanSingleQuote = (s, w) => {
  log.debug('single quote', { at: s.at });
  w.quoted = true;
  w.raw += s.take(); // the opening quote stays in the raw face
  for (;;) {
    if (s.done()) refuse('unclosed single quote', true);
    const c = s.take();
    w.raw += c;
    if (c === "'") return;
    w.folded += c;
  }
};

const scanDoubleQuote = (s, w) => {
  log.debug('double quote', { at: s.at });
  w.quoted = true;
  w.raw += s.take(); // opening quote
  for (;;) {
    const c = s.peek();
    if (c === '') refuse('unclosed double quote', true);
    if (c === '"') { w.raw += s.take(); return; }
    if (c === '$') { parseDollar(s, w); continue; }
    if (c === '`') refuse('command substitution $(…)/backticks is not implemented');
    if (c === '\\') {
      // Raw face is source-verbatim (the executor's quote machine was
      // probe-verified against it); the fold unescapes only \ " '.
      s.at += 1; // consume the backslash peeked above
      const n = s.take();
      w.raw += `\\${n}`;
      if (n === '"' || n === '\\' || n === "'") w.folded += n;
      else if (n !== '\n') w.folded += `\\${n}`;
      continue;
    }
    w.raw += s.take();
    w.folded += c;
  }
};

const scanBackslash = (s, w) => {
  log.debug('backslash escape', { at: s.at });
  w.quoted = true;
  s.take();
  if (s.done()) return; // a trailing escape contributes nothing folded
  const n = s.take();
  w.raw += `\\${n}`; // verbatim raw face
  if (n !== '\n') w.folded += n; // unquoted: the escape folds ANY char
};

const parseBracedParameter = (s, w, start) => {
  log.debug('braced parameter', { at: s.at });
  w.raw += s.take(); // '{'
  let body = '';
  for (;;) {
    const c = s.peek();
    if (c === '' || c === '\n') refuse('unclosed ${', true);
    if (c === '}') { w.raw += s.take(); break; }
    body += c;
    w.raw += s.take();
  }
  if (!/^[A-Za-z0-9_]+$/.test(body)) {
    if (SPECIAL_PARAM.has(body[0]) || /[0-9]/.test(body[0])) {
      refuse(`special parameter \${${body}} is not implemented`
        + ' (only the simple $VAR / ${VAR} form is)');
    }
    const operator = (body.match(/^[A-Za-z0-9_]*([:+#%?^,=-]+)/) ?? [])[1] ?? body;
    refuse(`parameter expansion operator '${operator}' is not implemented`
      + ' (only the simple $VAR / ${VAR} form is)');
  }
  recordExpansion(w, start, body);
};

/** `$` in an unquoted span or a double quote: the simple $VAR / ${VAR}
 * forms record an expansion; EVERY other `$` construct is refused by name;
 * a lone `$` is the literal character (bash semantics — bash-parser
 * crashed on it). */
const parseDollar = (s, w) => {
  log.debug('dollar', { at: s.at });
  w.namePhase = false;
  const start = w.raw.length;
  w.raw += s.take(); // '$'
  const c = s.peek();
  if (c === '(') {
    if (s.peek(1) === '(') refuse('arithmetic expansion $((…)) is not implemented');
    refuse('command substitution $(…)/backticks is not implemented');
  }
  if (c === '{') return parseBracedParameter(s, w, start);
  if (c === "'") refuse("ANSI-C quoting $'…' is not implemented");
  if (NAME_START.test(c)) {
    let name = '';
    while (NAME_CHAR.test(s.peek())) { name += s.peek(); w.raw += s.take(); }
    recordExpansion(w, start, name);
    return;
  }
  if (/[0-9]/.test(c) || SPECIAL_PARAM.has(c)) {
    refuse(`special parameter $${c} is not implemented`
      + ' (only the simple $VAR / ${VAR} form is)');
  }
  w.folded += '$';
};

const scanWordToken = (s) => {
  log.debug('word', { at: s.at });
  const w = {
    raw: '', folded: '', expansions: null,
    quoted: false, assignable: false, namePhase: true, name: '',
  };
  for (;;) {
    const c = s.peek();
    if (c === '' || WORD_BREAK.has(c)) break;
    if (c === "'") { scanSingleQuote(s, w); continue; }
    if (c === '"') { scanDoubleQuote(s, w); continue; }
    if (c === '\\') { scanBackslash(s, w); continue; }
    if (c === '$') { parseDollar(s, w); continue; }
    if (c === '`') refuse('command substitution $(…)/backticks is not implemented');
    s.at += 1;
    if (w.namePhase) {
      if (NAME_CHAR.test(c)) { w.name += c; w.raw += c; w.folded += c; continue; }
      if (c === '=' && NAME_START.test(w.name)) {
        w.assignable = true;
        w.namePhase = false;
        w.raw += c; w.folded += c;
        continue;
      }
      w.namePhase = false;
    }
    w.raw += c;
    w.folded += c;
  }
  return w;
};

/** The AST word faces: expansion-bearing words carry the RAW text (the
 * executor's quote machine needs the syntax quotes); plain words carry the
 * folded text (bash-parser contract exactly). */
const wordNode = (w) => (w.expansions !== null
  ? { text: w.raw, expansion: w.expansions, type: 'Word' }
  : { text: w.folded, type: 'Word' });

const assignmentNode = (w) => (w.expansions !== null
  ? { text: w.raw, expansion: w.expansions, type: 'AssignmentWord' }
  : { text: w.folded, type: 'AssignmentWord' });

const wordStarts = (s) => {
  log.debug('word starts', { at: s.at });
  const c = s.peek();
  return c !== '' && c !== '#' && !WORD_BREAK.has(c);
};

const redirectStarts = (s) => {
  log.debug('redirect starts', { at: s.at });
  const c = s.peek();
  if (c === '<' || c === '>') return true;
  return /[0-9]/.test(c) && (s.peek(1) === '<' || s.peek(1) === '>');
};

// ---------------------------------------------------------------------------
// The grammar: redirect → command → pipeline → and-or → script.
// ---------------------------------------------------------------------------

const parseRedirect = (s) => {
  log.debug('redirect', { at: s.at });
  let numberIo = null;
  if (/[0-9]/.test(s.peek()) && (s.peek(1) === '<' || s.peek(1) === '>')) {
    numberIo = { text: s.take(), type: 'io_number' };
  }
  const opChar = s.take();
  const next = s.peek();
  let op;
  if (opChar === '>') {
    if (next === '>') { s.at += 1; op = { text: '>>', type: 'dgreat' }; }
    else if (next === '|') refuse('the >| clobber redirect is not implemented ' + SUPPORTED_REDIRECTS);
    else if (next === '&') refuse('the >& fd-duplication redirect is not implemented ' + SUPPORTED_REDIRECTS);
    else op = { text: '>', type: 'great' };
  } else if (next === '<') {
    if (s.peek(1) === '<') refuse('the <<< here-string is not implemented');
    refuse('heredocs << are not implemented');
  } else if (next === '&') {
    refuse('the <& fd-duplication redirect is not implemented ' + SUPPORTED_REDIRECTS);
  } else if (next === '>') {
    refuse('the <> open redirect is not implemented ' + SUPPORTED_REDIRECTS);
  } else {
    refuse('input redirect < is not implemented ' + SUPPORTED_REDIRECTS);
  }
  skipBlank(s);
  if (!wordStarts(s)) refuse(`redirect ${op.text} is missing its target`);
  const file = scanWordToken(s);
  const redirect = { type: 'Redirect', op, file: wordNode(file) };
  if (numberIo !== null) redirect.numberIo = numberIo;
  return redirect;
};

/** Reserved words and the punctuation constructs, by name (the house rule:
 * exit 2 naming what is missing — the executor's §4.2 refusals, moved to
 * the parse where they belong now that the parser owns the dialect). */
const commandPositionRefusal = (w) => {
  log.debug('command word', { text: w.folded });
  if (w.folded === '!') refuse('command negation (!) is not implemented');
  if (w.folded === '{') refuse('command groups { … } are not implemented');
  if (w.folded === '}') refuse("unexpected '}'");
  if (RESERVED.has(w.folded)) {
    refuse(`the '${w.folded}' construct is not implemented by this shell `
      + '(pipelines, &&/||, sequences, redirects and assignments are)');
  }
};

const parseCommand = (s) => {
  log.debug('command', { at: s.at });
  skipBlank(s);
  if (s.peek() === '(') refuse('subshells ( … ) are not implemented');
  if (s.peek() === ')') refuse("unexpected ')'");
  const prefix = [];
  const suffix = [];
  let name = null;
  let stoppedAt = '';
  for (;;) {
    skipBlank(s);
    if (redirectStarts(s)) {
      (name === null ? prefix : suffix).push(parseRedirect(s));
      continue;
    }
    if (!wordStarts(s)) { stoppedAt = s.peek(); break; }
    const w = scanWordToken(s);
    if (name === null) {
      // `assignable` already means "unquoted NAME= prefix" — quoting after
      // the '=' (a quoted value) does not un-assign (bash semantics).
      if (w.assignable) { prefix.push(assignmentNode(w)); continue; }
      if (w.expansions === null && !w.quoted) commandPositionRefusal(w);
      name = wordNode(w);
      skipBlank(s);
      if (s.peek() === '(') refuse('function definitions are not implemented');
    } else {
      suffix.push(wordNode(w));
    }
  }
  if (name === null && prefix.length === 0) {
    if (stoppedAt === '') refuse('unexpected end of line — a command is missing');
    refuse(`unexpected '${stoppedAt}'`);
  }
  const command = { type: 'Command' };
  if (name !== null) command.name = name;
  if (prefix.length > 0) command.prefix = prefix;
  if (suffix.length > 0) command.suffix = suffix;
  return command;
};

const parsePipeline = (s) => {
  log.debug('pipeline', { at: s.at });
  const commands = [parseCommand(s)];
  for (;;) {
    skipBlank(s);
    if (s.peek() !== '|' || s.peek(1) === '|') break;
    s.at += 1;
    skipNewlines(s);
    commands.push(parseCommand(s));
  }
  return commands.length === 1 ? commands[0] : { type: 'Pipeline', commands };
};

const parseAndOr = (s) => {
  log.debug('and-or', { at: s.at });
  let left = parsePipeline(s);
  for (;;) {
    skipBlank(s);
    const c = s.peek();
    if ((c !== '&' && c !== '|') || s.peek(1) !== c) break;
    const op = c === '&' ? 'and' : 'or';
    s.at += 2;
    skipNewlines(s);
    left = { type: 'LogicalExpression', op, left, right: parsePipeline(s) };
  }
  return left;
};

/** Parse one command line into the AST the executor evaluates (`{ type:
 * 'Script', commands }`, the bash-parser shape exactly). Throws
 * ShellParseError on syntax failure or a by-name dialect refusal; returns
 * null for an empty or comment-only line (the no-op shell convention). */
export const parseCommandLine = (source) => {
  log.debug('parse', { chars: String(source ?? '').length });
  const s = new Scanner(String(source ?? ''));
  const commands = [];
  for (;;) {
    skipBlank(s);
    skipNewlines(s);
    if (s.peek() === ';') {
      if (s.peek(1) === ';') refuse("unexpected ';;'");
      s.at += 1;
      continue;
    }
    if (s.done()) break;
    commands.push(parseAndOr(s));
    skipBlank(s);
    const c = s.peek();
    if (c === '\n' || c === ';') {
      if (c === ';' && s.peek(1) === ';') refuse("unexpected ';;'");
      s.at += 1;
      continue;
    }
    if (c === '&') {
      if (s.peek(1) === '>') refuse("the '&>' redirect is not implemented " + SUPPORTED_REDIRECTS);
      refuse('background jobs (&) are not implemented — commands run to completion');
    }
    if (c === ')') refuse("unexpected ')'");
    if (!s.done()) refuse(`unexpected '${c}'`);
  }
  if (commands.length === 0) return null;
  return { type: 'Script', commands };
};
