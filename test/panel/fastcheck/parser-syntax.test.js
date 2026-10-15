// Property suite for runtime/dsh/system-plugins/dsh-shell-js/parser-syntax.js
// (test-hardening row 7). The module header states the contracts the
// properties pin:
//
//   - total over arbitrary strings: any input either parses (Script or the
//     null no-op) or is refused AS A ShellParseError — never a crash;
//   - the `syntax` flag is TRUE only for an unclosed quote / unclosed `${`
//     (exec.js renders that class as "(unclosed quote)"), FALSE for every
//     by-name dialect refusal;
//   - pure function: same input, same AST;
//   - the §4.3 whitelist: plain words, quoting that folds away, the five
//     command separators/continuations, trailing-newline no-op.
//
// Every property runs ≥200 cases (numRuns 300 here; the path/semver suites
// run more on their cheaper predicates).
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseCommandLine, ShellParseError } from '../../../runtime/dsh/system-plugins/dsh-shell-js/parser-syntax.js';

// Arbitrary string with a bias toward shell-meaningful characters — the
// pure-chaos arm is fc.string() itself; the structured arms concatenate
// tokens the tokenizer branches on (operators, quotes, `$` forms, blanks).
const SHELL_TOKENS = [
' ', '\t', '\n', '|', '||', '&&', ';', ';;', '>', '>>', '<', '<<', '<<<',
'>&', '<&', '>|', '<>', '&', '&>', '(', ')', "'", '"', '\\', '`', '$',
'$$', '$?', '$@', '$1', '${', '${VAR}', '$VAR', "$'", '#', '!', '{', '}',
'if', 'then', 'fi', 'for', 'while', 'case', 'function', 'time', 'echo',
'ls', 'x', '_', 'a=b', '2>', '0', '9', '*', '?', '[a-z]', '~',
];
const shellishArb = fc.oneof(
fc.string({ maxLength: 48 }),
fc.array(fc.constantFrom(...SHELL_TOKENS), { maxLength: 16 }).map((parts) => parts.join('')),
);

/** The command words of an AST node, left-to-right (Script → Pipeline →
 * LogicalExpression → Command). */
const collectCommandWords = (node) => {
if (node === null) return [];
if (node.type === 'Script') return node.commands.flatMap(collectCommandWords);
if (node.type === 'Pipeline') return node.commands.flatMap(collectCommandWords);
if (node.type === 'LogicalExpression') {
  return [...collectCommandWords(node.left), ...collectCommandWords(node.right)];
}
expect(node.type).toBe('Command');
const words = [];
if (node.name !== undefined) words.push(node.name);
for (const part of [...(node.prefix ?? []), ...(node.suffix ?? [])]) {
  if (part.type === 'Word') words.push(part);
}
return words;
};

const parseResult = (source) => {
try {
  return { ok: true, ast: parseCommandLine(source) };
} catch (error) {
  return { ok: false, error };
}
};

// Property callbacks live at module level: inside describe > it > fc.assert
// > fc.property the arrow bodies would breach the code-size ruler's indent
// budget (level 5), and the assertions read better named anyway.

/** P1: parse is total — null, Script, or a typed refusal. */
const assertTotality = (source) => {
  const result = parseResult(source);
  if (result.ok) {
    if (result.ast !== null) {
      expect(result.ast.type).toBe('Script');
      expect(Array.isArray(result.ast.commands)).toBe(true);
    }
  } else {
    expect(result.error).toBeInstanceOf(ShellParseError);
    expect(typeof result.error.syntax).toBe('boolean');
  }
};

const SEPARATOR_CMDS = ['echo', 'ls', 'grep'];

/** P5: the five command joins keep both commands, in order, under the
 * documented wrapper shapes (the top face is always a Script). */
const assertSeparatorJoin = (left, right, sep) => {
  const source = sep === '\n' ? `${left}\n${right}` : `${left} ${sep} ${right}`;
  const ast = parseCommandLine(source);
  const words = collectCommandWords(ast).map((w) => w.text);
  expect(words).toEqual([left, right]);
  expect(ast.type).toBe('Script');
  if (sep === ';' || sep === '\n') {
    expect(ast.commands).toHaveLength(2);
    return;
  }
  expect(ast.commands).toHaveLength(1);
  if (sep === '|') expect(ast.commands[0].type).toBe('Pipeline');
  if (sep === '&&' || sep === '||') {
    expect(ast.commands[0].type).toBe('LogicalExpression');
    expect(ast.commands[0].op).toBe(sep === '&&' ? 'and' : 'or');
  }
};

it('P1 totality: any string parses to null/Script or refuses as ShellParseError', () => {
  fc.assert(fc.property(shellishArb, assertTotality), { numRuns: 300 });
});

it('P2 purity: re-parsing the same string yields the identical result', () => {
  fc.assert(
    fc.property(shellishArb, (source) => {
      const first = parseResult(source);
      const second = parseResult(source);
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    }),
    { numRuns: 300 },
  );
});

it('P3 word-splitting: a line of plain tokens parses to exactly those words', () => {
  // Tokens from an alphabet with no operator/quote/expansion characters
  // and no reserved word — the whitelist accepts them verbatim.
  const WORDS = ['ls', 'echo', 'grep', 'find', 'x', 'zz', 'a1', 'b_2', 'cfg'];
  fc.assert(
    fc.property(fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 5 }), (tokens) => {
      const source = tokens.join(' ');
      const ast = parseCommandLine(source);
      expect(ast).not.toBeNull();
      const commands = ast.type === 'Script' ? ast.commands : [ast];
      expect(commands).toHaveLength(1);
      const command = commands[0];
      expect(command.type).toBe('Command');
      expect(command.name.text).toBe(tokens[0]);
      expect((command.suffix ?? []).map((w) => w.text)).toEqual(tokens.slice(1));
      for (const word of [command.name, ...(command.suffix ?? [])]) {
        expect(word).toEqual({ type: 'Word', text: word.text });
      }
    }),
    { numRuns: 300 },
  );
});

it('P4 quoting invariance: quoting a safe token never changes its folded text', () => {
  // Single/double quotes with no metacharacter inside fold to the bare
  // token (the raw face stays source-verbatim only when expansions exist).
  const SAFE = ['a', 'ab.txt', 'x_y', 'D1', 'longtoken', 'z9.z'];
  fc.assert(
    fc.property(fc.constantFrom(...SAFE), (token) => {
      const bare = parseCommandLine(token);
      const single = parseCommandLine(`'${token}'`);
      const double = parseCommandLine(`"${token}"`);
      for (const other of [single, double]) {
        expect(JSON.stringify(other)).toBe(JSON.stringify(bare));
      }
    }),
    { numRuns: 300 },
  );
});

it('P5 separators: the five command joins keep both commands, in order', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...SEPARATOR_CMDS),
      fc.constantFrom(...SEPARATOR_CMDS),
      fc.constantFrom(';', '\n', '|', '&&', '||'),
      assertSeparatorJoin,
    ),
    { numRuns: 300 },
  );
});

it('P6 the null face: blank lines and comments alone parse to null', () => {
  const linesArb = fc.array(
    fc.oneof(
      // blank padding: whitespace only — anything else at a word start is
      // a command word, not a blank
      fc.string({ minLength: 0, maxLength: 8 }).map((s) => s.replace(/[^ \t]/g, '')),
      fc.constantFrom('\t', '  ', ' \t '),
      // a comment runs to end of line (any content but the newline)
      fc.string({ minLength: 1, maxLength: 12 })
        .map((s) => s.replace(/[\n]/g, ''))
        .map((s) => `#${s}\n`),
    ),
    { maxLength: 8 },
  );
  fc.assert(
    fc.property(linesArb, (lines) => {
      expect(parseCommandLine(lines.join(''))).toBeNull();
    }),
    { numRuns: 300 },
  );
});

it('P7 syntax flag TRUE is exactly the unclosed-quote / unclosed-${ class', () => {
  const bodyArb = fc.string({ minLength: 0, maxLength: 16 });
  fc.assert(
    fc.property(
      bodyArb.filter((b) => !b.includes("'")),
      (body) => {
        const result = parseResult(`'q${body}`);
        expect(result.ok).toBe(false);
        expect(result.error.syntax).toBe(true);
      },
    ),
    { numRuns: 200 },
  );
  fc.assert(
    fc.property(
      bodyArb.filter((b) => !/["$`]/.test(b)),
      (body) => {
        const result = parseResult(`"q${body}`);
        expect(result.ok).toBe(false);
        expect(result.error.syntax).toBe(true);
      },
    ),
    { numRuns: 200 },
  );
  fc.assert(
    fc.property(
      bodyArb.filter((b) => !/[}\n]/.test(b)),
      (body) => {
        const result = parseResult(`\${V${body}`);
        expect(result.ok).toBe(false);
        expect(result.error.syntax).toBe(true);
      },
    ),
    { numRuns: 200 },
  );
});

it('P8 by-name refusals always throw ShellParseError with syntax FALSE', () => {
  // Each payload is refused BY NAME wherever it sits: at command position
  // (reserved words, punctuation constructs, background, `;;`) or inside a
  // word (command substitution, ANSI-C quoting, special parameters,
  // parameter-expansion operators). Pads are the only faces that are
  // skipped before a command starts: blanks, newlines, whole comments.
  const PAYLOADS = [
    '$(', '$(x', '$((', '`x`', '<<x', '<<<x', '<x', '>&x', '<&x', '>|x', '<>x',
    '&>x', '&', '!', '{', '}', '(', ')', ';;',
    'if', 'then', 'elif', 'else', 'fi', 'for', 'while', 'until', 'do', 'done',
    'case', 'esac', 'select', 'function', 'time',
    'echo $(x)', 'echo `x`', 'echo ${V:-x}', 'echo ${#V}', 'echo ${}', 'echo $@',
    'echo $?', 'echo $$', 'echo $1', "echo $'x'",
  ];
  const padArb = fc.array(
    fc.oneof(
      fc.constantFrom(' ', '\t', '\n'),
      fc.string({ minLength: 1, maxLength: 6 }).map((s) => `#${s.replace(/[\n]/g, '')}\n`),
    ),
    { maxLength: 4 },
  );
  fc.assert(
    fc.property(padArb, fc.constantFrom(...PAYLOADS), (pads, payload) => {
      const result = parseResult(`${pads.join('')}${payload}`);
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(ShellParseError);
      expect(result.error.syntax).toBe(false);
    }),
    { numRuns: 300 },
  );
});

it('P9 a trailing newline never flips the verdict: same AST, same throwness, same syntax flag', () => {
  // Scoped to the documented faces: acceptance, AST shape, and the syntax
  // flag are newline-stable. The refusal MESSAGE is not a documented
  // contract face and is NOT newline-stable for incomplete pipelines —
  // 'a | \n' refuses "unexpected '\n'" where 'a |' refuses "unexpected
  // end of line" (skipNewlines is blocked by the blank before it eats the
  // newline; observed 2026-10-16, cosmetic, reported alongside the other
  // findings).
  fc.assert(
    fc.property(shellishArb, (source) => {
      const base = parseResult(source);
      const withNewline = parseResult(`${source}\n`);
      expect(withNewline.ok).toBe(base.ok);
      if (!base.ok) {
        expect(withNewline.error).toBeInstanceOf(ShellParseError);
        expect(withNewline.error.syntax).toBe(base.error.syntax);
      } else {
        expect(JSON.stringify(withNewline.ast)).toBe(JSON.stringify(base.ast));
      }
    }),
    { numRuns: 300 },
  );
});

it('P10 expansion loc brackets the expansion spelling inside the raw face', () => {
  // ${VAR} / $VAR record an expansion whose loc indexes the RAW word text
  // (exec.js's quote machine contract): text.slice(loc.start, loc.end+1)
  // is exactly the expansion's own spelling — '$NAME' or '${NAME}' — and
  // start always points at '$'. The raw face stays source-verbatim
  // (syntax quotes and wrappers included).
  fc.assert(
    fc.property(
      fc.constantFrom('VAR', 'A', 'x_1', 'Path'),
      // Wrap pairs are metacharacter-safe, space-free, and their SECOND
      // element never starts a NAME character ([A-Za-z0-9_]) — an unbraced
      // $VAR absorbs trailing name characters into its parameter, which is
      // bash semantics, not this suite's subject.
      fc.constantFrom(
        ['', ''],
        ['pre', '.'],
        ['"', '"'],
        ['-', '.'],
      ),
      fc.constantFrom(true, false),
      (name, [before, after], braced) => {
        const expansion = braced ? `\${${name}}` : `$${name}`;
        const source = `echo ${before}${expansion}${after}`;
        const ast = parseCommandLine(source);
        const word = ast.commands[0].suffix[0];
        expect(word.type).toBe('Word');
        expect(Array.isArray(word.expansion)).toBe(true);
        expect(word.expansion).toHaveLength(1);
        expect(word.expansion[0].parameter).toBe(name);
        expect(word.expansion[0].type).toBe('ParameterExpansion');
        const { loc } = word.expansion[0];
        expect(word.text[loc.start]).toBe('$');
        expect(word.text.slice(loc.start, loc.end + 1)).toBe(expansion);
        expect(word.text).toBe(`${before}${expansion}${after}`);
      },
    ),
    { numRuns: 200 },
  );
});
