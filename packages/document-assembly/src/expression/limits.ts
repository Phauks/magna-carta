// Every resource bound the expression language enforces, in ONE module.
//
// One home rather than a constant beside each check: a later change moves a number here rather than
// discovering there were four, and a bound nobody can find is a bound nobody maintains. Each of these
// has a test that hits it exactly and asserts the named refusal — never a timeout, because a timeout is
// a bound the product discovered rather than one it declared.
//
// The step budget is NOT the termination guarantee. Termination is structural: the grammar has no loop,
// no recursion, and no self-reference, the tree is finite with a bounded depth, and evaluation is one
// post-order walk. The budget is the second line of defence against the PRODUCT of the other bounds,
// and the number it enforces is one a real document stays far below — a 150-field template with a dozen
// conditionals and a forty-row schedule spends a few thousand steps.

export const EXPRESSION_LIMITS = {
  // A computation that needs more than this belongs in the platform, not in a template.
  sourceLength: 512,
  // Lexer work is linear and capped before the parser ever runs.
  tokens: 256,
  // The recursive-descent parser and the post-order evaluator cannot blow the stack.
  treeDepth: 32,
  // Bounds `concat`-style output growth together with the per-result text cap.
  callNodes: 64,
  // Keeps the manifest's read plan bounded: an expression must never be the reason a read happens late.
  keysPerExpression: 32,
  // Registration work stays bounded for a pathological upload.
  expressionsPerTemplateVersion: 512,
  // Bounds exact-decimal multiplication's scale growth. A product's scale is the sum of its operands'.
  numericScale: 9,
  // With the depth cap, kills nested-`concat` doubling.
  textResultLength: 4096,
  // The aggregate backstop for the same class, across every expression in one document.
  textPerAssembly: 256 * 1024,
  // Charged per node visited and per list element; SHARED across every expression in the document,
  // not per expression, so a thousand cheap expressions are bounded as well as one expensive one.
  evaluationSteps: 100_000,
  // A repeat over an unexpectedly large collection fails loudly rather than expanding a document nobody
  // asked for.
  itemsPerRepeat: 1_000,
  // Bounds expansion multiplicatively with the item cap.
  blockNestingDepth: 5,
  // The aggregate backstop for nested repeats.
  expandedBlocksPerAssembly: 10_000,
} as const;

export type ExpressionLimits = typeof EXPRESSION_LIMITS;
