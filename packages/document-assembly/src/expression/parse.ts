import { helperArity, lookupHelper, type HelperSignature } from "./catalog.ts";
import {
  expressionFailed,
  expressionSucceeded,
  type ExpressionFailure,
  type ExpressionOutcome,
} from "./errors.ts";
import { lex, type Token } from "./lex.ts";
import { EXPRESSION_LIMITS } from "./limits.ts";

// Recursive descent over a CLOSED grammar:
//
//   expression      := orExpression
//   orExpression    := andExpression { "or" andExpression }
//   andExpression   := notExpression { "and" notExpression }
//   notExpression   := [ "not" ] comparison
//   comparison      := additive [ compareOperator additive ] | additive "in" "(" literal {"," literal} ")"
//   additive        := multiplicative { ( "+" | "-" ) multiplicative }
//   multiplicative  := unary { "*" unary }
//   unary           := [ "-" ] primary
//   primary         := literal | name | helperCall | "(" expression ")"
//
// Comparison is NON-ASSOCIATIVE: `a == b == c` is a parse error with a location, not a surprise.
//
// What has NO production at all, written out because the absence is the design: assignment, variable
// declaration, function or macro definition, lambda, member access, indexing, `this` / `self` /
// `parent`, string concatenation with `+` (there is `concat`), the ternary `?:` (there is `choose`),
// division as an operator, modulo, exponentiation, bitwise operators, regular expressions, comments,
// statement sequencing, template composition, and any form of loop, comprehension, or aggregate written
// by the author. A repeating block walks data; an expression does not iterate.
//
// A CALL NODE CARRIES A CATALOG SIGNATURE RESOLVED HERE, at parse time. By the time evaluation runs,
// the only callable things in existence are ones we wrote — there is no node kind meaning "call
// something the host has".

export type ComparisonOperator = "==" | "!=" | "<" | "<=" | ">" | ">=";

export type ExpressionNode =
  | { readonly kind: "text"; readonly value: string; readonly offset: number }
  // Every number in this language is an exact (significand, scale) pair. Never a float: a float is how
  // a money engine starts lying about amounts it was handed exactly.
  | {
      readonly kind: "number";
      readonly significand: number;
      readonly scale: number;
      readonly offset: number;
    }
  | { readonly kind: "boolean"; readonly value: boolean; readonly offset: number }
  | { readonly kind: "date"; readonly isoDate: string; readonly offset: number }
  | { readonly kind: "name"; readonly name: string; readonly offset: number }
  | {
      readonly kind: "call";
      readonly helper: HelperSignature;
      readonly argumentNodes: readonly ExpressionNode[];
      readonly offset: number;
    }
  | { readonly kind: "not"; readonly operand: ExpressionNode; readonly offset: number }
  | {
      readonly kind: "and";
      readonly left: ExpressionNode;
      readonly right: ExpressionNode;
      readonly offset: number;
    }
  | {
      readonly kind: "or";
      readonly left: ExpressionNode;
      readonly right: ExpressionNode;
      readonly offset: number;
    }
  | {
      readonly kind: "compare";
      readonly operator: ComparisonOperator;
      readonly left: ExpressionNode;
      readonly right: ExpressionNode;
      readonly offset: number;
    }
  | {
      readonly kind: "membership";
      readonly subject: ExpressionNode;
      readonly options: readonly ExpressionNode[];
      readonly offset: number;
    }
  | {
      readonly kind: "add";
      readonly left: ExpressionNode;
      readonly right: ExpressionNode;
      readonly offset: number;
    }
  | {
      readonly kind: "subtract";
      readonly left: ExpressionNode;
      readonly right: ExpressionNode;
      readonly offset: number;
    }
  | {
      readonly kind: "multiply";
      readonly left: ExpressionNode;
      readonly right: ExpressionNode;
      readonly offset: number;
    }
  | { readonly kind: "negate"; readonly operand: ExpressionNode; readonly offset: number };

export interface ParsedExpression {
  readonly node: ExpressionNode;
  readonly depth: number;
  readonly callNodes: number;
}

const COMPARISON_OPERATORS: ReadonlySet<string> = new Set(["==", "!=", "<", "<=", ">", ">="]);

// The parser descends through one function per precedence level, and most of those levels produce NO
// node — a bracket and a `multiplicative` that turns out to be a bare literal both cost a stack frame
// and no tree. So two bounds, not one: this one keeps the descent off the stack's limit, and the
// declared tree-depth bound is checked against the tree that actually came out. Conflating them would
// make the published depth cap secretly several times tighter than it says, and would make
// pretty-printing an expression change whether it is legal.
const PARSER_RECURSION_LIMIT = EXPRESSION_LIMITS.treeDepth * 8;

// The depth of the tree that was produced, counted in NODES.
export function treeDepthOf(node: ExpressionNode): number {
  switch (node.kind) {
    case "text":
    case "number":
    case "boolean":
    case "date":
    case "name":
      return 1;
    case "not":
    case "negate":
      return 1 + treeDepthOf(node.operand);
    case "call":
      return 1 + Math.max(0, ...node.argumentNodes.map(treeDepthOf));
    case "membership":
      return 1 + Math.max(treeDepthOf(node.subject), ...node.options.map(treeDepthOf));
    default:
      return 1 + Math.max(treeDepthOf(node.left), treeDepthOf(node.right));
  }
}

// A calendar date, validated here so `date "2026-02-30"` is an authoring error at registration rather
// than a silently shifted deadline in a filed document.
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDate(text: string): boolean {
  const match = ISO_DATE_PATTERN.exec(text);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

class Parser {
  private position = 0;
  private depth = 0;
  private deepest = 0;
  private calls = 0;
  private failure: ExpressionFailure | undefined;

  constructor(private readonly tokens: readonly Token[]) {}

  private peek(): Token {
    return this.tokens[this.position] ?? { kind: "end", text: "", offset: 0 };
  }

  private advance(): Token {
    const token = this.peek();
    if (token.kind !== "end") this.position += 1;
    return token;
  }

  private fail(offset: number, detail: string): undefined {
    this.failure ??= { code: "expression-syntax-error", offset, detail };
    return undefined;
  }

  private tooComplex(offset: number, detail: string): undefined {
    this.failure ??= { code: "expression-too-complex", offset, detail };
    return undefined;
  }

  private enter(offset: number): boolean {
    this.depth += 1;
    if (this.depth > this.deepest) this.deepest = this.depth;
    if (this.depth > PARSER_RECURSION_LIMIT) {
      this.tooComplex(
        offset,
        `an expression may nest at most ${EXPRESSION_LIMITS.treeDepth} levels deep.`,
      );
      return false;
    }
    return true;
  }

  private leave(): void {
    this.depth -= 1;
  }

  parse(): ExpressionOutcome<ParsedExpression> {
    const node = this.parseOr();
    if (this.failure !== undefined) return { ok: false, failure: this.failure };
    if (node === undefined) {
      return expressionFailed("expression-syntax-error", 0, "there is no expression here to read.");
    }
    const trailing = this.peek();
    if (trailing.kind !== "end") {
      return expressionFailed(
        "expression-syntax-error",
        trailing.offset,
        `"${trailing.text}" is left over after the end of the expression.`,
      );
    }
    const depth = treeDepthOf(node);
    if (depth > EXPRESSION_LIMITS.treeDepth) {
      return expressionFailed(
        "expression-too-complex",
        node.offset,
        `an expression may nest at most ${EXPRESSION_LIMITS.treeDepth} levels deep; this one nests ${depth}.`,
      );
    }
    return expressionSucceeded({ node, depth, callNodes: this.calls });
  }

  private parseOr(): ExpressionNode | undefined {
    const offset = this.peek().offset;
    if (!this.enter(offset)) return undefined;
    let left = this.parseAnd();
    while (left !== undefined && this.peek().kind === "keyword" && this.peek().text === "or") {
      const operator = this.advance();
      const right = this.parseAnd();
      if (right === undefined) {
        this.leave();
        return undefined;
      }
      left = { kind: "or", left, right, offset: operator.offset };
    }
    this.leave();
    return left;
  }

  private parseAnd(): ExpressionNode | undefined {
    const offset = this.peek().offset;
    if (!this.enter(offset)) return undefined;
    let left = this.parseNot();
    while (left !== undefined && this.peek().kind === "keyword" && this.peek().text === "and") {
      const operator = this.advance();
      const right = this.parseNot();
      if (right === undefined) {
        this.leave();
        return undefined;
      }
      left = { kind: "and", left, right, offset: operator.offset };
    }
    this.leave();
    return left;
  }

  private parseNot(): ExpressionNode | undefined {
    const token = this.peek();
    if (token.kind === "keyword" && token.text === "not") {
      this.advance();
      if (!this.enter(token.offset)) return undefined;
      const operand = this.parseNot();
      this.leave();
      return operand === undefined ? undefined : { kind: "not", operand, offset: token.offset };
    }
    return this.parseComparison();
  }

  private parseComparison(): ExpressionNode | undefined {
    const offset = this.peek().offset;
    if (!this.enter(offset)) return undefined;
    const left = this.parseAdditive();
    if (left === undefined) {
      this.leave();
      return undefined;
    }

    const token = this.peek();
    if (token.kind === "keyword" && token.text === "in") {
      this.advance();
      const open = this.advance();
      if (open.kind !== "openParenthesis") {
        this.leave();
        return this.fail(
          open.offset,
          '"in" is followed by a bracketed list, as in x in ("a", "b").',
        );
      }
      const options: ExpressionNode[] = [];
      for (;;) {
        const option = this.parseLiteral();
        if (option === undefined) {
          this.leave();
          return undefined;
        }
        options.push(option);
        const next = this.advance();
        if (next.kind === "closeParenthesis") break;
        if (next.kind !== "comma") {
          this.leave();
          return this.fail(
            next.offset,
            'the list after "in" is comma-separated and ends with ")".',
          );
        }
      }
      this.leave();
      return { kind: "membership", subject: left, options, offset: token.offset };
    }

    if (token.kind === "operator" && COMPARISON_OPERATORS.has(token.text)) {
      this.advance();
      const right = this.parseAdditive();
      if (right === undefined) {
        this.leave();
        return undefined;
      }
      const trailing = this.peek();
      // Non-associative, and said plainly rather than parsed into something the author did not write.
      if (
        (trailing.kind === "operator" && COMPARISON_OPERATORS.has(trailing.text)) ||
        (trailing.kind === "keyword" && trailing.text === "in")
      ) {
        this.leave();
        return this.fail(
          trailing.offset,
          'two comparisons cannot be chained. Write "a < b and b < c" rather than "a < b < c".',
        );
      }
      this.leave();
      return {
        kind: "compare",
        operator: token.text as ComparisonOperator,
        left,
        right,
        offset: token.offset,
      };
    }

    this.leave();
    return left;
  }

  private parseAdditive(): ExpressionNode | undefined {
    const offset = this.peek().offset;
    if (!this.enter(offset)) return undefined;
    let left = this.parseMultiplicative();
    while (
      left !== undefined &&
      this.peek().kind === "operator" &&
      (this.peek().text === "+" || this.peek().text === "-")
    ) {
      const operator = this.advance();
      const right = this.parseMultiplicative();
      if (right === undefined) {
        this.leave();
        return undefined;
      }
      left = {
        kind: operator.text === "+" ? "add" : "subtract",
        left,
        right,
        offset: operator.offset,
      };
    }
    this.leave();
    return left;
  }

  private parseMultiplicative(): ExpressionNode | undefined {
    const offset = this.peek().offset;
    if (!this.enter(offset)) return undefined;
    let left = this.parseUnary();
    while (left !== undefined && this.peek().kind === "operator" && this.peek().text === "*") {
      const operator = this.advance();
      const right = this.parseUnary();
      if (right === undefined) {
        this.leave();
        return undefined;
      }
      left = { kind: "multiply", left, right, offset: operator.offset };
    }
    this.leave();
    return left;
  }

  private parseUnary(): ExpressionNode | undefined {
    const token = this.peek();
    if (token.kind === "operator" && token.text === "-") {
      this.advance();
      if (!this.enter(token.offset)) return undefined;
      const operand = this.parsePrimary();
      this.leave();
      return operand === undefined ? undefined : { kind: "negate", operand, offset: token.offset };
    }
    return this.parsePrimary();
  }

  // A literal, and only a literal — the right-hand side of `in`, where admitting an expression would
  // turn a membership test into an unbounded fan-out over computed values.
  private parseLiteral(): ExpressionNode | undefined {
    const token = this.peek();
    if (
      token.kind === "text" ||
      token.kind === "integer" ||
      token.kind === "decimal" ||
      (token.kind === "keyword" &&
        (token.text === "true" || token.text === "false" || token.text === "date"))
    ) {
      return this.parsePrimary();
    }
    if (token.kind === "operator" && token.text === "-") {
      return this.parseUnary();
    }
    return this.fail(
      token.offset,
      'only fixed values may be listed after "in" — text, a number, a date, true, or false.',
    );
  }

  private parsePrimary(): ExpressionNode | undefined {
    const token = this.advance();

    switch (token.kind) {
      case "text":
        return { kind: "text", value: token.text, offset: token.offset };
      case "integer":
      case "decimal":
        return {
          kind: "number",
          significand: token.significand ?? 0,
          scale: token.scale ?? 0,
          offset: token.offset,
        };
      case "openParenthesis": {
        if (!this.enter(token.offset)) return undefined;
        const inner = this.parseOr();
        this.leave();
        if (inner === undefined) return undefined;
        const close = this.advance();
        if (close.kind !== "closeParenthesis") {
          return this.fail(token.offset, "a bracket opens here and is never closed.");
        }
        return inner;
      }
      case "keyword": {
        if (token.text === "true" || token.text === "false") {
          return { kind: "boolean", value: token.text === "true", offset: token.offset };
        }
        if (token.text === "date") {
          const literal = this.advance();
          if (literal.kind !== "text") {
            return this.fail(
              token.offset,
              'a date is written as date "2026-08-04" — the keyword, then the date in quotes.',
            );
          }
          if (!isCalendarDate(literal.text)) {
            return this.fail(
              literal.offset,
              `"${literal.text}" is not a calendar date. Dates are written year-month-day, as in 2026-08-04.`,
            );
          }
          return { kind: "date", isoDate: literal.text, offset: token.offset };
        }
        return this.fail(
          token.offset,
          `"${token.text}" cannot start a value; it joins two of them together.`,
        );
      }
      case "name": {
        if (this.peek().kind === "openParenthesis") {
          return this.fail(
            token.offset,
            `"${token.text}" is a merge field, not a calculation, so it cannot be called.`,
          );
        }
        return { kind: "name", name: token.text, offset: token.offset };
      }
      case "identifier":
        return this.parseCall(token);
      default:
        return this.fail(
          token.offset,
          token.kind === "end"
            ? "the expression stops before it says anything."
            : `"${token.text}" cannot appear here.`,
        );
    }
  }

  private parseCall(nameToken: Token): ExpressionNode | undefined {
    const open = this.peek();
    if (open.kind !== "openParenthesis") {
      // A bare lowercase word that is not a helper and carries no dot is not a merge field either. Said
      // as an unknown name rather than as a syntax error, because that is what the author has to fix.
      this.failure ??= {
        code: "expression-unknown-key",
        offset: nameToken.offset,
        detail: `"${nameToken.text}" is not a merge field this firm has, and not a calculation this system knows.`,
      };
      return undefined;
    }
    const helper = lookupHelper(nameToken.text);
    if (helper === undefined) {
      return this.fail(
        nameToken.offset,
        `"${nameToken.text}" is not a calculation this system knows.`,
      );
    }
    this.advance();
    this.calls += 1;
    if (this.calls > EXPRESSION_LIMITS.callNodes) {
      return this.tooComplex(
        nameToken.offset,
        `an expression may use at most ${EXPRESSION_LIMITS.callNodes} calculations.`,
      );
    }
    if (!this.enter(nameToken.offset)) return undefined;

    const argumentNodes: ExpressionNode[] = [];
    if (this.peek().kind === "closeParenthesis") {
      this.advance();
    } else {
      for (;;) {
        // A `personSubject` parameter takes a BARE SUBJECT WORD — `pronoun(client, "subject")` —
        // and nothing else. It is read here, from the token, rather than parsed as an expression,
        // because `client` alone is not a merge field and must not become one: the atom names WHOSE
        // pronouns are wanted, and the checker resolves it against the subjects the firm's field
        // catalogue actually carries. Confined to this one declared position, so no other place in
        // the grammar gains a bare word, and it is still one atom looked up in a Map — the property
        // that makes `__proto__` here uninteresting rather than dangerous.
        const specification = helper.parameters[argumentNodes.length];
        if (specification === "personSubject" && this.peek().kind === "identifier") {
          const subject = this.advance();
          argumentNodes.push({ kind: "name", name: subject.text, offset: subject.offset });
          const separator = this.advance();
          if (separator.kind === "closeParenthesis") break;
          if (separator.kind !== "comma") {
            this.leave();
            return this.fail(
              separator.offset,
              `${nameToken.text}'s inputs are comma-separated and end with ")".`,
            );
          }
          continue;
        }
        const argument = this.parseOr();
        if (argument === undefined) {
          this.leave();
          return undefined;
        }
        argumentNodes.push(argument);
        const next = this.advance();
        if (next.kind === "closeParenthesis") break;
        if (next.kind !== "comma") {
          this.leave();
          return this.fail(
            next.offset,
            `${nameToken.text}'s inputs are comma-separated and end with ")".`,
          );
        }
      }
    }
    this.leave();

    const arity = helperArity(helper);
    if (argumentNodes.length < arity.minimum || argumentNodes.length > arity.maximum) {
      return this.fail(
        nameToken.offset,
        helper.variadic === undefined
          ? `${helper.name} takes ${arity.minimum} input${arity.minimum === 1 ? "" : "s"}, not ${argumentNodes.length}.`
          : `${helper.name} takes at least ${arity.minimum} input${arity.minimum === 1 ? "" : "s"}.`,
      );
    }

    return { kind: "call", helper, argumentNodes, offset: nameToken.offset };
  }
}

export function parse(source: string): ExpressionOutcome<ParsedExpression> {
  const tokens = lex(source);
  if (!tokens.ok) return tokens;
  return new Parser(tokens.value).parse();
}

// ---------------------------------------------------------------------------------------------
// Pretty printing
// ---------------------------------------------------------------------------------------------

// Fully parenthesized, so re-parsing the output yields an IDENTICAL tree. That round trip is the
// standard detector for parser-ambiguity and precedence bugs, and the fuzz harness asserts it over
// every generated expression — a precedence mistake shows up as a tree that differs rather than as a
// document with the wrong clause in it.
export function prettyPrint(node: ExpressionNode): string {
  switch (node.kind) {
    case "text":
      return `"${node.value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
    case "number": {
      const digits = String(Math.abs(node.significand)).padStart(node.scale + 1, "0");
      const whole = digits.slice(0, digits.length - node.scale);
      const fraction = node.scale === 0 ? "" : `.${digits.slice(digits.length - node.scale)}`;
      const sign = node.significand < 0 ? "-" : "";
      return `${sign}${whole}${fraction}`;
    }
    case "boolean":
      return node.value ? "true" : "false";
    case "date":
      return `date "${node.isoDate}"`;
    case "name":
      return node.name;
    case "call":
      return `${node.helper.name}(${node.argumentNodes.map(prettyPrint).join(", ")})`;
    case "not":
      return `(not ${prettyPrint(node.operand)})`;
    case "and":
      return `(${prettyPrint(node.left)} and ${prettyPrint(node.right)})`;
    case "or":
      return `(${prettyPrint(node.left)} or ${prettyPrint(node.right)})`;
    case "compare":
      return `(${prettyPrint(node.left)} ${node.operator} ${prettyPrint(node.right)})`;
    case "membership":
      return `(${prettyPrint(node.subject)} in (${node.options.map(prettyPrint).join(", ")}))`;
    case "add":
      return `(${prettyPrint(node.left)} + ${prettyPrint(node.right)})`;
    case "subtract":
      return `(${prettyPrint(node.left)} - ${prettyPrint(node.right)})`;
    case "multiply":
      return `(${prettyPrint(node.left)} * ${prettyPrint(node.right)})`;
    case "negate":
      // No wrapping brackets: every compound operand already brackets itself, and a bracketed negative
      // literal is not a literal, which is what the fixed list after `in` admits.
      return `-${prettyPrint(node.operand)}`;
  }
}

// Structural equality over the closed node set, ignoring source offsets — the round-trip property is
// about the SHAPE a parse produced, and a pretty-printed expression's offsets differ from its
// original's by construction.
export function nodesEqual(left: ExpressionNode, right: ExpressionNode): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "text":
      return right.kind === "text" && left.value === right.value;
    case "number":
      return (
        right.kind === "number" &&
        left.significand === right.significand &&
        left.scale === right.scale
      );
    case "boolean":
      return right.kind === "boolean" && left.value === right.value;
    case "date":
      return right.kind === "date" && left.isoDate === right.isoDate;
    case "name":
      return right.kind === "name" && left.name === right.name;
    case "call":
      return (
        right.kind === "call" &&
        left.helper.name === right.helper.name &&
        left.argumentNodes.length === right.argumentNodes.length &&
        left.argumentNodes.every((argument, index) =>
          nodesEqual(argument, right.argumentNodes[index] as ExpressionNode),
        )
      );
    case "not":
      return right.kind === "not" && nodesEqual(left.operand, right.operand);
    case "negate":
      return right.kind === "negate" && nodesEqual(left.operand, right.operand);
    case "membership":
      return (
        right.kind === "membership" &&
        nodesEqual(left.subject, right.subject) &&
        left.options.length === right.options.length &&
        left.options.every((option, index) =>
          nodesEqual(option, right.options[index] as ExpressionNode),
        )
      );
    case "compare":
      return (
        right.kind === "compare" &&
        left.operator === right.operator &&
        nodesEqual(left.left, right.left) &&
        nodesEqual(left.right, right.right)
      );
    case "and":
    case "or":
    case "add":
    case "subtract":
    case "multiply":
      return (
        (right.kind === "and" ||
          right.kind === "or" ||
          right.kind === "add" ||
          right.kind === "subtract" ||
          right.kind === "multiply") &&
        nodesEqual(left.left, right.left) &&
        nodesEqual(left.right, right.right)
      );
  }
}
