// The two failure vocabularies of the expression language, and the tagged results that carry them.
//
// NOTHING IN THIS FOLDER THROWS. Every stage returns one of these, so a caller classifies an outcome by
// reading a discriminant rather than by catching. That is not a style preference: a throw from a lexer
// handed a megabyte of unicode is indistinguishable at the call site from a defect in the caller, and
// the whole claim this language makes is that hostile input produces a NAMED refusal.
//
// The two vocabularies are deliberately separate because they happen at different times to different
// people. A CHECK failure is an authoring mistake, caught at registration while a human is looking at
// the template, with a character offset so the field inspector can point at it. A REFUSAL happens
// during assembly, on real data, and always fails the assembly — it never becomes `false`, never
// becomes blank, and never becomes a rounded guess.

// ---------------------------------------------------------------------------------------------
// Registration-time failure
// ---------------------------------------------------------------------------------------------

export type ExpressionFailureCode =
  | "expression-syntax-error"
  | "expression-unknown-key"
  | "expression-type-error"
  | "expression-too-complex"
  | "expression-format-illegal";

export interface ExpressionFailure {
  readonly code: ExpressionFailureCode;
  // The character offset into the expression SOURCE the finding sits at. Zero when the finding is about
  // the expression as a whole rather than about one token.
  readonly offset: number;
  // What the author has to change, in their words. Names the offending token; never quotes a value,
  // because at registration there are none.
  readonly detail: string;
}

export type ExpressionOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ExpressionFailure };

export function expressionSucceeded<T>(value: T): ExpressionOutcome<T> {
  return { ok: true, value };
}

export function expressionFailed<T>(
  code: ExpressionFailureCode,
  offset: number,
  detail: string,
): ExpressionOutcome<T> {
  return { ok: false, failure: { code, offset, detail } };
}

// ---------------------------------------------------------------------------------------------
// Assembly-time refusal
// ---------------------------------------------------------------------------------------------

// Why an expression could not produce a value from data that all resolved. Each one is arithmetically
// or structurally impossible rather than merely absent — absence is a separate outcome, because a
// missing value and an impossible calculation call for different answers from the person reading the
// document.
export type RefusalCode =
  // Two money values in different currencies met in one operation. There is no currency conversion in
  // this language: a rate of exchange is a fact with a date and a source, and a template inventing one
  // would put an unsourced number into a filed document.
  | "currency-mismatch"
  // An intermediate left the exact-integer range. Checked BEFORE the operation, so the money package's
  // own guard is unreachable from here.
  | "magnitude"
  // Exact-decimal multiplication grew the scale past what the language holds exactly.
  | "scale"
  // `divideExact` was asked for a quotient that is not exact. The whole point of the helper.
  | "inexact-division"
  // A divisor or part count of zero, or a fractional operand where the operation admits only an integer.
  | "invalid-operand"
  // The shared per-assembly step budget ran out.
  | "step-budget"
  // A helper produced more text than one result may carry, or the document's expressions produced more
  // text in aggregate than one assembly may carry.
  | "text-budget"
  // A repeat's collection has more items than one block may expand.
  | "repeat-too-large"
  // The document's blocks expanded to more units in aggregate than one assembly may carry.
  | "expansion-budget"
  // A currency code the platform does not know reached an operation that needs one.
  | "unknown-currency";

export interface Refusal {
  readonly code: RefusalCode;
  // WHICH expression and WHY, never what any value held.
  readonly detail: string;
}

export function refusal(code: RefusalCode, detail: string): Refusal {
  return { code, detail };
}
