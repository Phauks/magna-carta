import { expressionFailed, expressionSucceeded, type ExpressionOutcome } from "./errors.ts";
import { EXPRESSION_LIMITS } from "./limits.ts";

// The lexer. It receives ALREADY-DECODED text from the XML layer and never decodes again: double
// decoding is its own bug class, and the one place it would bite is a template containing the literal
// text `&lt;`.
//
// THE SINGLE MOST IMPORTANT LEXICAL RULE: `matter.number` is ONE token. The dot is part of the
// identifier's lexical form, not an operator. There is no member-access production anywhere in the
// grammar, so an expression has no way to walk from one value to another — which is why
// `__proto__.constructor` is uninteresting here rather than dangerous. It is one atom, looked up in a
// Map, found absent, and reported as an unknown merge field.
//
// Boolean operators are WORDS. `&&` and `||` are typed into Word as literal ampersands and stored
// XML-escaped; word operators sidestep an entire category of authoring confusion and read better in a
// document a paralegal maintains. `<` and `>` stay symbols because a comparison reads badly without
// them.

export type TokenKind =
  | "name" // a merge key or loop reference: exactly one atom, dots included
  | "identifier" // a bare lowercase word: a helper name, and nothing else
  | "keyword" // and · or · not · in · true · false · date
  | "text"
  | "integer"
  | "decimal"
  | "operator"
  | "openParenthesis"
  | "closeParenthesis"
  | "comma"
  | "end";

export interface Token {
  readonly kind: TokenKind;
  // The token's source text for a keyword, operator, name, or identifier; the decoded contents for a
  // text literal; the digits for a number.
  readonly text: string;
  readonly offset: number;
  // Set on `integer` and `decimal` only: the exact (significand, scale) pair the literal denotes. A
  // decimal is NEVER a float — holding one as a float is how a money engine starts lying.
  readonly significand?: number;
  readonly scale?: number;
}

export const KEYWORDS: ReadonlySet<string> = new Set([
  "and",
  "or",
  "not",
  "in",
  "true",
  "false",
  "date",
]);

const COMPARISON_OPERATORS: readonly string[] = ["==", "!=", "<=", ">=", "<", ">"];

// A name is matched as one atom and then resolved by EXACT MATCH against the dictionary and the
// enclosing loop scope. One to two dots: `matter.number`, `custom.retainerCap`, `exhibits.letter`.
const NAME_PATTERN = /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+){1,2}$/;
const HELPER_NAME_PATTERN = /^[a-z][A-Za-z0-9]*$/;

// An aggregate's argument is one atom that names a field of a collection — `matter.parties.role`. The
// split is LEXICAL and happens here, beside the rule that made the dots part of the name, so neither the
// checker nor the evaluator grows a notion of member access: this returns two strings, each of which is
// then looked up by exact match. The last dot separates them, because a collection key carries a dot of
// its own and an item field does not.
export function splitListFieldPath(
  name: string,
): { readonly collectionKey: string; readonly fieldName: string } | undefined {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === name.length - 1) return undefined;
  const collectionKey = name.slice(0, lastDot);
  if (!collectionKey.includes(".")) return undefined;
  return { collectionKey, fieldName: name.slice(lastDot + 1) };
}
// Deliberately looser than either: a word is consumed greedily so a hostile atom is reported ONCE, at
// its start, rather than lexed into a plausible prefix plus a pile of confusing garbage.
const WORD_PATTERN = /[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z0-9_$]*)*/y;

const DIGITS_PATTERN = /[0-9]+(?:\.[0-9]+)?/y;

function isWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r";
}

// The characters that exist in other expression languages and not in this one, each with the message
// that says what to write instead. A targeted error is the difference between an author fixing a
// template in a minute and an author filing a support request.
const ABSENT_CONSTRUCTS: ReadonlyMap<string, string> = new Map([
  [
    "/",
    "division is not an operator here, because an infix / states nothing about rounding. Use divideExact for a split that must come out even, divideRounded for one that rounds, or allocate for parts that add back up to the whole.",
  ],
  ["&", 'boolean operators are words here: write "and", not "&&".'],
  ["|", 'boolean operators are words here: write "or", not "||".'],
  ["!", 'write "not x" rather than "!x"; "!=" is spelled the same as elsewhere.'],
  ["?", 'there is no ? : here. Write choose(condition, "one", "the other").'],
  [
    "[",
    "there is no indexing here. A repeating block walks a list; an expression cannot reach into one.",
  ],
  [
    "]",
    "there is no indexing here. A repeating block walks a list; an expression cannot reach into one.",
  ],
  ["{", "an expression cannot contain braces — they delimit the placeholder it sits in."],
  ["}", "an expression cannot contain braces — they delimit the placeholder it sits in."],
  ["%", "there is no remainder operator here."],
  ["^", "there is no exponentiation here."],
  ["~", "there is no bitwise operator here."],
  [";", "an expression is one expression: there are no statements to separate."],
  ["'", 'text is written in double quotes: "like this".'],
  ["`", 'text is written in double quotes: "like this".'],
  [".", "a dot belongs inside a merge field's name, never on its own."],
  ["@", "that character has no meaning in an expression."],
  ["#", "that character has no meaning in an expression."],
  ["\\", "that character has no meaning in an expression."],
]);

export function lex(source: string): ExpressionOutcome<readonly Token[]> {
  if (source.length > EXPRESSION_LIMITS.sourceLength) {
    return expressionFailed(
      "expression-too-complex",
      EXPRESSION_LIMITS.sourceLength,
      `an expression may be at most ${EXPRESSION_LIMITS.sourceLength} characters; this one is ${source.length}. A calculation that needs more than that belongs in the platform rather than in a template.`,
    );
  }

  const tokens: Token[] = [];
  let index = 0;

  const push = (token: Token): boolean => {
    tokens.push(token);
    return tokens.length <= EXPRESSION_LIMITS.tokens;
  };

  while (index < source.length) {
    const character = source[index] ?? "";

    if (isWhitespace(character)) {
      index += 1;
      continue;
    }

    if (character === "(") {
      if (!push({ kind: "openParenthesis", text: "(", offset: index })) break;
      index += 1;
      continue;
    }
    if (character === ")") {
      if (!push({ kind: "closeParenthesis", text: ")", offset: index })) break;
      index += 1;
      continue;
    }
    if (character === ",") {
      if (!push({ kind: "comma", text: ",", offset: index })) break;
      index += 1;
      continue;
    }

    // Text literals: `\"` and `\\` are the only escapes. No interpolation, no expression inside a
    // string, so a string is never a second place an expression could hide.
    if (character === '"') {
      let scan = index + 1;
      let value = "";
      let closed = false;
      while (scan < source.length) {
        const inner = source[scan] ?? "";
        if (inner === "\\") {
          const escaped = source[scan + 1];
          if (escaped === '"' || escaped === "\\") {
            value += escaped;
            scan += 2;
            continue;
          }
          return expressionFailed(
            "expression-syntax-error",
            scan,
            'the only escapes inside quoted text are \\" and \\\\.',
          );
        }
        if (inner === '"') {
          closed = true;
          scan += 1;
          break;
        }
        value += inner;
        scan += 1;
      }
      if (!closed) {
        return expressionFailed(
          "expression-syntax-error",
          index,
          "quoted text opens here and is never closed.",
        );
      }
      if (!push({ kind: "text", text: value, offset: index })) break;
      index = scan;
      continue;
    }

    if (character >= "0" && character <= "9") {
      DIGITS_PATTERN.lastIndex = index;
      const match = DIGITS_PATTERN.exec(source);
      const digits = match?.[0] ?? "";
      const dot = digits.indexOf(".");
      if (dot === -1) {
        const value = Number(digits);
        if (!Number.isSafeInteger(value)) {
          return expressionFailed(
            "expression-too-complex",
            index,
            `"${digits}" is larger than this language holds exactly.`,
          );
        }
        if (!push({ kind: "integer", text: digits, offset: index, significand: value, scale: 0 }))
          break;
        index += digits.length;
        continue;
      }
      const scale = digits.length - dot - 1;
      if (scale > EXPRESSION_LIMITS.numericScale) {
        return expressionFailed(
          "expression-too-complex",
          index,
          `a decimal may carry at most ${EXPRESSION_LIMITS.numericScale} places after the point; "${digits}" carries ${scale}.`,
        );
      }
      const significand = Number(digits.replace(".", ""));
      if (!Number.isSafeInteger(significand)) {
        return expressionFailed(
          "expression-too-complex",
          index,
          `"${digits}" is larger than this language holds exactly.`,
        );
      }
      if (!push({ kind: "decimal", text: digits, offset: index, significand, scale })) break;
      index += digits.length;
      continue;
    }

    if (/[A-Za-z_$]/.test(character)) {
      WORD_PATTERN.lastIndex = index;
      const match = WORD_PATTERN.exec(source);
      const word = match?.[0] ?? character;
      if (KEYWORDS.has(word)) {
        if (!push({ kind: "keyword", text: word, offset: index })) break;
        index += word.length;
        continue;
      }
      if (NAME_PATTERN.test(word)) {
        if (!push({ kind: "name", text: word, offset: index })) break;
        index += word.length;
        continue;
      }
      if (HELPER_NAME_PATTERN.test(word)) {
        if (!push({ kind: "identifier", text: word, offset: index })) break;
        index += word.length;
        continue;
      }
      return expressionFailed(
        "expression-syntax-error",
        index,
        `"${word}" is not a name this language can read. A merge field looks like matter.number; a calculation's name is a lowercase word.`,
      );
    }

    const comparison = COMPARISON_OPERATORS.find((operator) => source.startsWith(operator, index));
    if (comparison !== undefined) {
      if (!push({ kind: "operator", text: comparison, offset: index })) break;
      index += comparison.length;
      continue;
    }

    if (character === "+" || character === "-" || character === "*") {
      if (!push({ kind: "operator", text: character, offset: index })) break;
      index += 1;
      continue;
    }

    // A lone `=` would otherwise read as an assignment attempt, which is the thing to say plainly.
    if (character === "=") {
      return expressionFailed(
        "expression-syntax-error",
        index,
        'there is no assignment here; "==" is how two things are compared.',
      );
    }

    const absent = ABSENT_CONSTRUCTS.get(character);
    return expressionFailed(
      "expression-syntax-error",
      index,
      absent ?? `"${character}" has no meaning in an expression.`,
    );
  }

  if (tokens.length > EXPRESSION_LIMITS.tokens) {
    return expressionFailed(
      "expression-too-complex",
      tokens[EXPRESSION_LIMITS.tokens]?.offset ?? 0,
      `an expression may be at most ${EXPRESSION_LIMITS.tokens} words and symbols long.`,
    );
  }

  tokens.push({ kind: "end", text: "", offset: source.length });
  return expressionSucceeded(tokens);
}
