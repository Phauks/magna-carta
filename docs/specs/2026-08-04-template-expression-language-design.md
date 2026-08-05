# The template expression language — design (slice 2·6·2)

**Date:** 2026-08-04 (evening)
**Status:** Amendment to the document-automation design, on an owner decision taken the same day. The
expression ceiling recorded there is superseded; everything else in that design stands.
**Scope:** The expression language that conditional blocks, repeating blocks, and computed fields are
written in — its grammar, its type system, its arithmetic and date rules, its fixed helper catalog,
where it is checked, how it terminates, what it may not become, and the fuzzing obligation that keeps
that claim honest. Excludes: the OOXML mechanics of removing a paragraph or cloning a table row (the
document-automation design's block section already owns those), the dictionary sources that widen in
the same build slice, and the authoring interface.
**White-paper home:** _Document Automation_.
**Governing decisions:** ADR-0011 (document automation as a first-class capability), ADR-0210 /
ADR-0211 (the engine and template model shipped in slice 2·6·1), plus the pending decision fragment
this spec is written against (`docs/decisions/pending/template-expression-ceiling.md`).
**Decision inputs:** the shipped substrate this design is obliged to reuse —
`@magna-carta/document-assembly` (the normalization pass, the field manifest, the dictionary, the
formatter table, the batched resolver, and `timeZoneForLocation`), `@magna-carta/money` (exact
integer money, `Ratio`, `Intermediate`, the three named rounding helpers, and `allocate`), and
`@magna-carta/identifiers`'s `seededRandomSource` (the deterministic generator the fuzz harness
builds on). A survey of HotDocs, Gavel, and docxtemplater's Angular parser informs section 9 and
nothing else.

## 1. What changed, and what did not

The document-automation design fixed the expression ceiling deliberately low — presence, negation,
and equality against a literal — and named the widening as owner decision F6. **F6 is answered: the
ceiling grows.** Template expressions may compute. Arithmetic over money and numbers, date math,
comparisons, and a catalog of formatting and grammar helpers are all in.

The reasoning the original ceiling rested on was two arguments braided together, and the owner
decision separates them:

- _"A template rich enough to need a developer produces a firm-wide dependency on whoever wrote the
  templates."_ This is a **product** argument about authoring complexity. It is real, it is why
  HotDocs authoring became a specialist job, and it is answered by keeping the language small,
  closed, and total — not by keeping it incapable. A paralegal who can write a spreadsheet formula
  can write `daysBetween(system.today, matter.openedOn) > 30`; the thing they cannot do, and must
  never be able to do, is write a program.
- _"A template that evaluates code is an execution surface inside our Worker."_ This is a
  **security** argument, and it does not move at all.

**The non-negotiable line that survives, stated once:** an expression is **never executable
template-supplied code.** Not code we sandbox, not code we lint, not code we run under a restricted
interpreter — code that the grammar cannot express in the first place. Everything in sections 3
through 8 is subordinate to that sentence, and section 10 is the argument that the design keeps it.

What the widened ceiling still refuses, permanently and by construction: user-defined functions,
property traversal of any kind, indexing, assignment, iteration written by the author, recursion,
template includes, regular expressions, `eval` in any spelling, and any reach into the host — no
clock, no randomness, no environment, no network, no database handle, no file system.

## 2. Where the language lives, and why it is one language

One grammar serves three constructs, and they differ only in what is done with the result:

| Construct             | Form                                            | Result type   |
| --------------------- | ----------------------------------------------- | ------------- |
| **Conditional block** | `{{#if expression}}` … `{{/if}}`, `{{#unless}}` | `boolean`     |
| **Repeating block**   | `{{#each collectionKey}}` … `{{/each}}`         | a list source |
| **Computed field**    | `{{= expression}}` or `{{= expression:format}}` | any scalar    |

Three constructs, one lexer, one parser, one checker, one evaluator. The alternative — a small
condition language and a separate arithmetic language for computed fields — is two grammars to keep
consistent, two checkers to keep in step, and two places for a security property to hold. There is
one of each.

**`{{= }}` is a deliberately distinct marker.** A plain `{{matter.number}}` keeps exactly the meaning
slice 2·6·1 shipped: a dictionary key, substituted, optionally formatted. No template that registered
before this slice changes meaning, and an author reading a template can tell a lookup from a
calculation at a glance.

The code lands at `packages/document-assembly/src/expression/` — `limits.ts`, `lex.ts`, `parse.ts`,
`catalog.ts`, `check.ts`, `evaluate.ts`, `errors.ts` — and a purity test asserts the folder imports
nothing from `src/ooxml/`. That is not tidiness: the checker is the thing an authoring surface wants
to run in the browser as the author types (slice 2·6·4), and an OOXML-free module is the cheap
version of that seam, taken now.

## 3. The grammar

### 3.1 The concrete syntax

```
expression      := orExpression
orExpression    := andExpression { "or" andExpression }
andExpression   := notExpression { "and" notExpression }
notExpression   := [ "not" ] comparison
comparison      := additive [ compareOperator additive ]
                 | additive "in" "(" literal { "," literal } ")"
compareOperator := "==" | "!=" | "<" | "<=" | ">" | ">="
additive        := multiplicative { ( "+" | "-" ) multiplicative }
multiplicative  := unary { "*" unary }
unary           := [ "-" ] primary
primary         := literal | mergeKey | loopReference | helperCall | "(" expression ")"
helperCall      := helperName "(" [ expression { "," expression } ] ")"
literal         := textLiteral | integerLiteral | decimalLiteral | dateLiteral | "true" | "false"
mergeKey        := ATOMIC dictionary token, e.g. matter.number, client.displayName, custom.customField_<handle>
loopReference   := collectionKey "." fieldName | "loop" "." ( "index" | "count" | "first" | "last" )
```

Comparison is **non-associative**: `a == b == c` is a parse error with a location, not a surprise.
`and` binds tighter than `or`; `not` binds tighter than both and looser than comparison, so
`not matter.isProSe and client.isOrganization` parses as `(not matter.isProSe) and (...)` — which is
the reading a person expects and the one the error message states when the author's parentheses
disagree.

Boolean operators are **words**, not symbols. `&&` and `||` are typed into Word as literal ampersands
and stored XML-escaped; word operators sidestep an entire category of authoring confusion and read
better in a document a paralegal maintains. `<` and `>` are kept as symbols because a comparison
reads badly without them; the lexer receives **already-decoded** text from the XML layer and never
decodes again (double-decoding is its own bug class, and the one place it would bite is a template
containing the literal text `&lt;`).

### 3.2 The single most important lexical rule

**`matter.number` is one token.** The dot is part of the identifier's lexical form, not an operator.
There is no member-access production in the grammar, no indexing production, and therefore no way for
an expression to walk from one value to another. A name is matched by
`[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+){1,2}` as a single atom and then **resolved by exact match**
against the dictionary and the enclosing loop scope. A name that resolves to neither is a
registration error naming it.

This is the structural difference from every prior-art evaluator in section 9, and it is worth being
explicit about why: in a language where `a.b.c` is real traversal over a host object, the escape
hatches are properties of the host object graph, and the sandbox is a denylist over that graph. With
no traversal production, `__proto__.constructor` is not a traversal that must be blocked — it is one
atom, looked up in a `Map`, found absent, and reported at registration as an unknown merge field.

### 3.3 Literals

- **Text** — `"double quoted"`, with `\"` and `\\` as the only escapes. No interpolation, no
  backticks, no expression inside a string.
- **Integer** — `0`, `-12`, `9000`. Must be a safe integer.
- **Decimal** — `0.075`, `2.5`. Held as an exact `(significand, scale)` pair, never a float, with
  `scale <= 9`.
- **Date** — `date "2026-08-04"`, a calendar date in ISO form. A prefix keyword rather than bare
  quotes so a date is never a stringly-typed accident.
- **Boolean** — `true`, `false`.

There is no money literal and no currency literal. Money enters an expression only from the
dictionary, where its currency is a fact the firm's data carries. An author who could write `$500`
would be writing a currency assumption into a template that a multi-currency firm would then file.

### 3.4 What has no production at all

Written out because the absence is the design: assignment, variable declaration, function or macro
definition, lambda, member access, indexing (`a[b]`), `this` / `self` / `parent`, string
concatenation with `+` (there is `concat`), the ternary `?:` (there is `choose`), division as an
operator (section 5.3), modulo, exponentiation, bitwise operators, regular expressions, comments,
semicolons or statement sequencing, `include` / `partial` / template composition, and any form of
loop, comprehension, or aggregate written by the author (section 6.2).

## 4. The type system

### 4.1 Types

`text` · `number` (exact decimal) · `money` · `rate` · `date` · `boolean` · `list`.

Two absences from that list are load-bearing.

**There is no instant type.** A dictionary key whose stored value is an instant is projected to a
calendar date in the matter's office time zone **once, at the resolution boundary**, before the
evaluator sees it. Time-of-day arithmetic is therefore not expressible, which is correct: legal
deadlines are date arithmetic, and an expression that could subtract hours would silently make a
filing date depend on the hour a job happened to run.

**There is no null.** A merge key either has a value or is `unresolved`, and `unresolved` is a
property of evaluation, not a value the language can name, compare against, or construct. `has(key)`
is the total presence test and `default(expression, fallback)` is the total elimination form; there
is no `== null` to write and no null to propagate into a comparison that then quietly answers
`false`.

**`list` is not a first-class value.** It is the source of a `{{#each}}` block and the argument of
`count` and `isEmpty`, and it can be neither constructed, indexed, assigned, nor passed to any other
helper. A list-typed key used anywhere else is a registration type error.

### 4.2 Checking happens at registration

The registration pipeline gains a stage, in this order, per expression found:

1. **Lex** — bounded (section 8). A malformed token is a failure with a character offset.
2. **Parse** — bounded depth. An unbalanced parenthesis, an associativity violation, or an unknown
   operator is a failure with an offset.
3. **Resolve names** — every atom against the dictionary and the enclosing loop scope.
4. **Type-check** — operator operand types, helper arity and parameter types, and the block's
   required result type (`boolean` for a condition, `list` for a repeat, a formattable scalar for a
   computed field).
5. **Check the format suffix** — a computed field's `:format` must be legal for the expression's
   **static result type**, checked against the shipped `legalFormatsFor` table. A format name is a
   literal by grammar precisely so this check can be static.
6. **Check limits.**

**A type error is a registration error with a location, never an assembly surprise.** That is the
invariant this stage exists to produce, and it is the same trade the normalization pass already made
for run splitting: the fiddly, failure-prone work happens once, at the moment a human is looking at
the result, rather than at 4:55pm on a filing deadline. The failure surfaces through the existing
field-inspector route with the part, the paragraph, the character offset, and the offending token.

New `NormalizationFailureCode` values: `expression-syntax-error`, `expression-unknown-key`,
`expression-type-error`, `expression-too-complex`, `expression-format-illegal`,
`block-unbalanced`, `block-nesting-too-deep`. The existing `block-syntax-unsupported` code retires
with this slice — blocks are supported now, and a code that means "we refuse to read this" must not
survive as a vaguer version of the six codes that replace it.

### 4.3 What the manifest stores, and why it is the source

The field manifest gains, per block and per computed field: the expression **source text**, its
static result type, and the sorted set of merge keys it reads.

It does **not** store a serialized syntax tree. Assembly re-parses and re-checks from the source. Two
reasons, and the second is the real one. Parsing a bounded expression is microseconds against an
assembly that decompresses and rebuilds an OOXML package, and the parsed form is cached in the
isolate alongside the parsed template package, keyed the same way. More importantly, re-checking at
assembly time is the only thing that catches **dictionary drift**: a template registered in March
against a custom field that was archived in June must fail in September with the key named, not
evaluate against a stale tree that still believes the key exists. A stored tree would be a second
representation to version, to migrate, and to trust; the source text is already the thing the author
wrote and the thing the field inspector shows them.

**The keys an expression reads join the manifest's key set**, which is what keeps the batching rule
(one read per source per assembly, regardless of field count) true once conditions and computed
fields can read anything the dictionary has. An expression must never be the reason a read happens
late.

## 5. Arithmetic

### 5.1 Nothing here is a float

Every numeric value in the evaluator is an exact integer with a declared scale — the same discipline
`@magna-carta/money` already enforces, reused rather than re-derived. `money` is minor units at scale
2, `rate` is `rate_e4` at scale 4, a `number` is a `(significand, scale)` pair. The evaluator
contains no floating-point arithmetic and no `Math` call that could introduce one; a fitness test
greps for both.

`+` and `-` align scales and add exactly. `*` on numbers produces a result at the sum of the operand
scales, exactly. Every intermediate is checked against `Number.isSafeInteger` **before** the
operation is performed, so the money package's own `assertSafeInteger` throw is unreachable from
here; a breach is a typed refusal naming the operation, never an exception and never a silent slide
into inexact arithmetic.

### 5.2 Money

- `money + money` and `money - money` → `money`. **Same currency required.** A mismatch is a runtime
  refusal naming both keys. **There is no currency conversion in this language, ever** — a rate of
  exchange is a fact with a date and a source, and a template inventing one would put an unsourced
  number into a filed document.
- `money * integer` → `money`, exact. Multiplication by a non-integer is not an operator (5.3).
- `- money` → `money`.
- Comparisons between same-currency money values.
- `money + number` is a **static** type error. So is `money * money`.

### 5.3 Division is not an operator, and this is the whole rule

**`/` has no production in the grammar.** The lexer recognizes the character solely to emit a
targeted error naming the three helpers that replace it. Division is where a money engine either
states its rounding or lies about it, and an infix `/` states nothing.

| Helper                          | Rule                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `divideExact(money, integer)`   | The quotient at the operand's scale, or a **refusal** if it is not exact. `$100.00 / 4` is `$25.00`; `$100.00 / 3` refuses and names the key.                                              |
| `divideRounded(money, integer)` | **Banker's rounding — half to even**, through the money package's `roundLedger`. `$100.00 / 3` is `$33.33`, and the remaining penny is gone.                                               |
| `allocate(money, integer)`      | `n` parts that **sum exactly to the input**, largest-remainder, through the money package's `allocate`. This is the correct primitive for a split, and the only one whose parts reconcile. |
| `applyRate(money, rate)`        | Money times a stored `rate_e4`, banker's rounding at the boundary.                                                                                                                         |
| `percentOf(money, number)`      | Money times a decimal, banker's rounding at the boundary.                                                                                                                                  |

Banker's rounding is the single rounding mode exposed to template authors, and it is the money
package's `roundLedger` rather than a fourth implementation. The other two shipped modes
(`roundTax`, half-up; `roundInvoiceLine`, half-away-from-zero) are deliberately **not** in the
catalog: a template computing statutory tax or an invoice credit is a document reimplementing the
billing subsystem, which is where those rules belong and where they are tested. Owner flag G2.

`allocate` returns a list, and a list is not a first-class value (4.1), so its only legal use is as
the source of a `{{#each}}` — `{{#each allocate(matter.settlementAmount, 3)}}` renders a three-way
split whose parts reconcile to the total. That constraint is not a limitation worked around; it is
the reason an allocation cannot be pulled apart element by element and quietly fail to sum.

### 5.4 Dates

All date math is over calendar dates in **the matter's office time zone**, resolved once through the
existing `timeZoneForLocation` seam in `src/resolve.ts` and carried on the `MergeContext`. The
evaluator has no clock and no zone of its own; `system.today` is a resolved dictionary value like any
other, which is also what keeps an assembly reproducible.

- `addDays(date, integer)`, `addMonths(date, integer)`, `addYears(date, integer)` → `date`.
  **End-of-month clamps**: 31 January plus one month is 28 (or 29) February, stated here because the
  alternative convention exists and a silent choice between them is a wrong deadline.
- `daysBetween(earlier, later)` → `number`, an exact integer, negative when the arguments are the
  other way round.
- `year(date)`, `month(date)`, `day(date)` → `number`; `monthName(date)` → `text`.
- Comparison operators between dates.

**Business-day and court-deadline arithmetic is out, permanently unless the owner says otherwise.** A
`addCourtDays` helper needs a per-jurisdiction holiday calendar with an effective date, maintained
forever, and a wrong answer from one is a missed filing. That is a content obligation and a
malpractice-shaped failure, not a helper. Owner flag G3.

## 6. Blocks

### 6.1 Conditionals

`{{#if expression}}` and `{{#unless expression}}` take any expression whose static result type is
`boolean`. `{{#unless x}}` is exactly `{{#if not x}}` and exists because it reads better in a
document.

A **bare merge key** as the whole condition keeps the meaning slice 2·6·1 promised, with one
disambiguation stated so it is never guessed: if the key's declared type is `boolean`, the condition
is its value; for any other type, the condition is its **presence**, exactly `has(key)`. A key used
inside a larger expression is always a value, never a presence test.

Block markers are their own paragraphs and the marker paragraph is removed with the block; in a
table, a marker in the first cell of a row makes the row the unit. That is unchanged from the
document-automation design, as is the numbering-and-banding continuity work, which remains the real
implementation risk in this build slice and is not a language question.

### 6.2 Repeats — the iteration boundary, stated precisely

**`{{#each}}` iterates data; expressions do not iterate.**

`{{#each exhibits}}` takes a **list-valued dictionary key or the `allocate` helper**, and nothing
else — not an arbitrary expression, not a filtered list, not a sorted one. Inside the block, a scope
frame is pushed containing the current item's fields (`exhibits.letter`, `exhibits.title`) plus
`loop.index` (1-based), `loop.count`, `loop.first`, and `loop.last`. The frame holds scalars. The
evaluator's only awareness that a loop exists is that its name-resolution scope has one more layer;
it has no iteration construct of its own, no `map`, no `filter`, no `reduce`, and no comprehension.

The consequence worth naming: **there is no aggregate.** A settlement statement wanting "the total of
all disbursements" cannot express it, and that will be the first thing a firm asks for. The honest
position is that a bounded aggregate over resolved data (`sum(disbursements.amount)`, with a literal
field path, never over a computed expression) would be _safe_ — its cost is bounded by the data, not
by the expression, exactly as `{{#each}}` is — but it is iteration inside an expression, which is the
line the owner drew. It is a named seam, not a feature, and it is owner flag G4.

A repeat's collection is **one batched read**, like every other source: one read for all of
`exhibits`, never one per item. Repeats are the first list-valued source in the dictionary, so this
is the slice where the batching rule meets its first real test.

### 6.3 Computed fields

`{{= expression}}`, optionally `{{= expression:format}}`. The result must be a formattable scalar;
`list` and `boolean` without a format are type errors at registration (a bare boolean in a document
renders as "true", which is not a thing a filed document should say — `{{= choose(x, "Yes", "No")}}`
or the `yesNo` format is the intent, written out).

The default format is the result type's default — `plain` for text and number, `currency` for money,
`long` for date — and the suffix overrides it, checked statically against `legalFormatsFor`.

## 7. Absence, refusal, and what a document does about each

Three outcomes, deliberately distinguished, because collapsing them is how a silently wrong document
gets filed.

**Resolved** — the expression produced a value. Nothing more to say.

**Unresolved** — some merge key the expression reads has no value. `unresolved` propagates through
every operator and every helper except the three total forms: `has(key)` (always a boolean),
`default(expression, fallback)` (the fallback when the expression is unresolved), and `choose`'s
unselected arm (which is never evaluated). What happens then depends on where it happened, and the
asymmetry is the point:

| Site                 | Default           | Why                                                                                                                                                                                                          |
| -------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A **condition**      | **`fail`**        | An unresolved condition means we do not know whether a clause belongs in the document. Choosing a branch anyway is an invisible error — nobody reads a contract and notices the paragraph that is not there. |
| A **computed field** | **`placeholder`** | A hole in the output is visible on the page, which is the house bias the absence model already takes for merge fields.                                                                                       |

Both are overridable per placeholder through the same `blank` / `placeholder` / `fail` vocabulary the
dictionary already uses, and an author who genuinely means "omit the clause when we have no spouse on
file" writes `{{#if has(party.spouse)}}`, which is total and never unresolved. Making that the
explicit form rather than the default is the whole design: the safe reading is available in one word,
and the dangerous reading cannot be reached by accident.

**Refused** — the expression is arithmetically impossible or exceeded a bound: a currency mismatch,
a magnitude breach, an inexact `divideExact`, a step-budget exhaustion. A refusal **always fails the
assembly**, naming the location and the reason. It never becomes `false`, never becomes blank, and
never becomes a rounded guess. A refusal reports **which** expression and **why**, never what any
value held.

Every one of these is a tagged result. Nothing in `src/expression/` throws.

## 8. Resource bounds

Enforced in one module, `expression/limits.ts`, so a later change moves a number in one place rather
than discovering there were four. Each bound has a test that hits it exactly.

| Bound                                 | Value        | What it stops                                                                                                               |
| ------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Expression source length              | 512 chars    | A computation that needs more belongs in the platform, not a template.                                                      |
| Tokens per expression                 | 256          | Lexer work is linear and capped before the parser runs.                                                                     |
| Syntax-tree depth                     | 32           | The recursive-descent parser and the post-order evaluator cannot blow the stack.                                            |
| Call nodes per expression             | 64           | Bounds `concat`-style output growth together with the per-result cap.                                                       |
| Merge keys read per expression        | 32           | Keeps the manifest's read plan bounded.                                                                                     |
| Expressions per template version      | 512          | Registration work stays bounded for a pathological upload.                                                                  |
| Numeric magnitude                     | safe integer | Every intermediate is checked before the operation; a breach refuses.                                                       |
| Numeric scale                         | 9            | Bounds exact-decimal multiplication's scale growth.                                                                         |
| Text result per helper                | 4,096 chars  | With the depth cap, kills nested-`concat` doubling.                                                                         |
| Expression-produced text per assembly | 256 KB       | The aggregate backstop for the same class.                                                                                  |
| Evaluation steps per assembly         | 100,000      | Charged per node visited and per list element; a shared budget across every expression in the document, not per expression. |
| Items per `{{#each}}`                 | 1,000        | A repeat over an unexpectedly large collection fails loudly.                                                                |
| Block nesting depth                   | 5            | Bounds expansion multiplicatively with the item cap.                                                                        |
| Expanded blocks per assembly          | 10,000       | The aggregate backstop for nested repeats.                                                                                  |

The step budget is **not** the termination guarantee — section 10 is. It is the second line of
defence against the product of the other bounds, and the number it enforces is a real number a real
document stays far below: a 150-field template with a dozen conditionals and a forty-row exhibit
schedule spends a few thousand steps.

## 9. Prior art, and what each one teaches

**HotDocs** is the maximal case and the cautionary one. Its expressions admit literals, variables,
computations with parameters, system functions with parameters, and unary and binary operators,
composing to arbitrary depth; beyond a certain complexity its own documentation directs authors out
of the field editor and into Component Studio, because the inline editor has neither syntax
highlighting nor error validation. The pattern is worth naming precisely: the language did not become
a developer tool because it added arithmetic — it became one because it added **user-defined,
reusable, parameterized computations**, at which point a template's behaviour lived in a component
library that only its author understood. HotDocs Advance's own remedy was a formula-building
interface that lowers the barrier without lowering the ceiling. **The lesson we take:** computed
expressions are not the slope; user-defined named computations are. Ours has none, and the catalog is
fixed in our source (owner flag G6 is the question of whether firm-level named expressions ever
arrive, and it is the decision that would actually move us onto that slope).

**Gavel** (formerly Documate) sits at the other end: conditional logic, variables, calculations, and
branching authored in a visual no-code editor, with the questionnaire as the primary data source
rather than a matter database. Its expressions are built by clicking rather than typed, which
eliminates the syntax-error class outright and costs expressiveness and reviewability. **The lesson
we take:** the authoring surface, not the grammar, is what determines whether a paralegal can
maintain a template. Our grammar is small enough that the slice 2·6·4 authoring surface can offer the
same guided construction over it — which is exactly why the checker is kept OOXML-free and
browser-runnable (section 2).

**docxtemplater's Angular parser is the thing we refuse, and the reason is structural rather than
diligence.** Its richer expressions are evaluated by `angular-expressions`, a general-purpose
JavaScript expression evaluator, against the data object: dot-notation property access, arithmetic,
comparison, boolean logic, ternaries, and — by default — `CallExpression`, so a template can call a
function. The security posture that necessarily follows is a **denylist over a language that can
express everything**, and it has failed twice in the way denylists fail. CVE-2020-5219 was one escape;
CVE-2024-54152 (CVSS 9.3, CWE-94) was another, where `expressions.compile("__proto__.constructor")`
returned an object instead of `undefined` and a longer payload reached arbitrary code execution. The
documented mitigations are exactly the mitigations a denylist needs: pin `angular-expressions` to
1.5.2 or later, enable `csp: true` so the interpreter avoids `new Function()`, disable
`CallExpression` through `disabledSyntaxes`, and harden the runtime around it — defence in depth,
because the first line is known to be permeable. docxtemplater's own guidance names the precondition
plainly: you are impacted if the Angular parser is enabled **and** the templates are written by
untrusted people.

Ours differs structurally, and the difference is one sentence: **their sandbox is a denylist over a
language that can express property traversal and function calls, and ours is an allowlist over a
language in which neither has a production.** There is no sandbox to escape because the escape target
does not exist in the grammar — `__proto__.constructor` is one atom, matched against a `Map` of
dictionary keys, absent, and reported at registration as an unknown merge field. The failure mode we
accept in exchange is real and worth stating: a firm will eventually want something the catalog does
not have, and the answer is a catalog entry we write, review, and test — not a template that computes
it.

## 10. Why this cannot become an execution surface

Seven properties, each independently checkable, and each with a test named in section 11.

1. **No dynamic code path exists.** No `eval`, no `new Function`, no dynamic `import`, no `with`, no
   `Reflect`, no regular expression constructed from template text (which would also be a ReDoS
   surface). A source-scan fitness test refuses all of them inside `src/expression/`.
2. **The evaluator is a switch over a closed set of node kinds** declared in our source. There is no
   node kind meaning "call something the host has". A call node carries a **catalog identifier
   resolved at parse time**, so by the time evaluation runs, the only callable things in existence
   are functions we wrote.
3. **No property traversal, and no template string is ever a JavaScript property key.** Names resolve
   through `Map.get` against the merge context and the loop scope — prototype-free lookup by
   construction, which is why the `__proto__` family is uninteresting here rather than dangerous.
   There is no `.` operator to walk with and no host object to walk.
4. **Values are our own tagged records** (`MergeValue`, plus exact-decimal pairs), never host
   objects. Nothing the evaluator holds has a prototype chain worth reaching.
5. **Termination is structural.** The grammar has no loop, no recursion, no function definition, and
   no self-reference; the syntax tree is finite with a bounded depth; evaluation is a single
   post-order walk visiting each node once; and the only variadic-cost construct, `{{#each}}`,
   iterates a **finite list resolved from the firm's own data**, capped. Evaluation therefore
   terminates in time bounded by (nodes × iterations), both of which are bounded before evaluation
   starts. There is no template-include and no partial, so the billion-laughs expansion shape has no
   entry point either.
6. **The evaluator is pure and has no ambient authority** — no clock, no randomness, no environment,
   no locale beyond the time zone carried on the merge context, no I/O, no database handle. Its
   signature is `(checkedExpression, mergeContext, loopScope) -> Value | Unresolved | Refusal`, and
   the package's existing purity test extends to cover it.
7. **Defence in depth remains, and is not the argument.** Templates are macro-stripped and
   re-verified at registration, assembly runs in the queue consumer rather than a request handler,
   and authoring a template requires `templates:manage`. Those matter, and none of them is why this
   is safe — points 1 through 6 are.

The claim these make together: **a bug in this evaluator is a wrong number in a document, which is
serious, and cannot be a foothold in a Worker, which would be catastrophic.** The two failure classes
are separated by the grammar, not by our care.

## 11. The fuzzing obligation

The security claim in section 10 is a claim about **all** inputs, so it needs a test method that
generates inputs rather than enumerating them. This is an obligation of the slice, not a follow-up.

**Structure-aware generation.** A generator over the grammar produces well-formed random expressions
across every production, type, and helper, seeded through `seededRandomSource` from
`@magna-carta/identifiers` so a CI failure is reproducible from its seed. Properties asserted on
every generated expression: parse, check, and evaluate **never throw**; every outcome is one of the
tagged results; evaluation always terminates inside the step budget; and a checked expression's
result type always matches the type its evaluation produced.

**Byte-level fuzzing of the lexer and parser.** Arbitrary strings — unicode, unbalanced braces,
XML-escaped text, deeply nested parentheses, megabyte literals, null bytes, mixed scripts — with the
property that the parser **always** returns a typed failure with a location, never throws, never
loops, and never exceeds its bounds.

**A committed denied-construct corpus**, which is the test that makes section 10 falsifiable rather
than rhetorical. Each entry asserts a **parse or check** failure, never an evaluation:
`__proto__.constructor`, `constructor.constructor("return process")()`, `this`, `[].map(x)`,
`a["b"]`, `(function(){})()`, `x = 1`, `import("y")`, `/re/`, prototype-named keys, 32-deep nested
`concat`, a 10^6-character literal, and every symbol operator the grammar does not have.

**Round-trip property.** Pretty-printing a parsed expression and re-parsing it yields an identical
tree — the standard detector for parser ambiguity and precedence bugs.

**An arithmetic oracle.** Money and decimal operations checked against an independent exact
reference, with the half-to-even rule proven on the exact tie cases in both signs, `allocate`'s parts
proven to sum to the input for every generated split, and `divideExact` proven to refuse exactly when
the quotient is inexact.

**Bound-hitting tests**, one per row of the section 8 table, asserting the named refusal rather than
a timeout.

**Corpus regression.** Every input that ever produced a crash, a hang, or a wrong answer is committed
as a fixture case and runs forever after.

The seeded generator is in-house because the repository has no property-testing library and adding
one for a single consumer is a dependency decision rather than a test decision; `fast-check` is the
obvious fallback if the generator becomes expensive to maintain, and it is pure TypeScript, so golden
rule 14 does not bite either way.

## 12. Telemetry, errors, and load profile

**Two counters**, added to the existing catalog with the same discipline: no expression text, no
merge-field key, no value ever becomes a dimension.

- `documentTemplate.expressionCheck`, dimensions `[outcome, failureKind]` — how often registration
  rejects an expression and which of the six failure codes it was. This is the instrument that says
  whether the grammar is teachable.
- `documentAssembly.expression`, dimensions `[outcome, site]` — `resolved` / `unresolved` / `refused`
  against `condition` / `repeat` / `computedField`. A rising `unresolved` on conditions is the
  template-and-data drift signal, one layer up from `documentAssembly.absentField`.

**Problem types** are additive registry entries: `template-expression-invalid` (registration) and
`assembly-expression-refused` (assembly), each carrying the location structure the field inspector
already renders.

**Load profile.** The existing `documentAutomation` volume profile accretes two measured operations
rather than gaining a bespoke benchmark: registration-time checking of a template carrying 64
expressions, and an assembly whose repeat expands 200 rows. Neither is allowed onto a request hot
path — registration checking runs where normalization already runs, and evaluation runs in the queue
consumer.

## 13. Build sequencing

Five steps, each independently testable, each leaving `main` shippable. The ordering is deliberate:
the first two touch no document at all, so the language is proven correct as a language before it
ever meets an OOXML package, and the two hardest problems (a grammar's totality, and a table row's
banding) never have to be debugged at the same time.

1. **Grammar** — lexer, parser, syntax tree, name resolution, type checker, limits, the denied-
   construct corpus, the fuzz harness. Input: a string. Output: a checked tree or a located failure.
   No dictionary values, no document, no evaluation.
2. **Evaluator** — a checked tree plus a synthetic merge context. All arithmetic, date math, helper
   semantics, banker's rounding, the unresolved and refusal outcomes, the step budget. Still no
   document.
3. **Conditionals** — `{{#if}}` / `{{#unless}}` recognized at registration, block ranges on the
   manifest, whole-paragraph and whole-row removal, numbering and banding continuity, the unresolved-
   condition policy.
4. **Repeats** — `{{#each}}`, the loop scope, list-valued dictionary sources and their batched read,
   row cloning, nesting, expansion bounds.
5. **Computed fields** — `{{= }}` placeholders, the static format check, the manifest entries, the
   telemetry, the user guide.

The implementation plan carries this as tasks 11 through 15 of build slice 2·6·2.

## 14. Owner decisions newly raised

The expansion answers F6 and raises seven questions that the narrow ceiling never had to face.

| Flag   | Decision                                                                                                                                                                                                                                                                                        |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1** | **What an unresolved condition does by default.** Recommended: `fail`. The alternative (treat as false) never interrupts anyone and produces documents silently missing clauses. This is the single most product-visible choice in the design.                                                  |
| **G2** | **One rounding mode or three.** Recommended: banker's rounding only, through the money package's `roundLedger`. Exposing `roundTax` and `roundInvoiceLine` to template authors invites a template to reimplement billing.                                                                       |
| **G3** | **Business-day and court-deadline date math.** Recommended: never, without a maintained per-jurisdiction holiday calendar treated as a content obligation with an owner. A wrong answer here is a missed filing.                                                                                |
| **G4** | **Aggregates over a repeat collection** — `sum(disbursements.amount)` with a literal field path. Safe (bounded by data, like `{{#each}}` itself), genuinely wanted by a settlement statement, and on the wrong side of the "expressions do not iterate" line as drawn. Excluded now; flagged.   |
| **G5** | **Pronoun and verb agreement.** The original design deferred it as "a conditional the author writes". With helpers now allowed, a `pronoun(party, "subject")` becomes expressible — but it requires recording a gender attribute on a party. Recommended: still no; `choose` covers it visibly. |
| **G6** | **Firm-level named expressions.** Reusable named computations are the next natural ask and remain non-executable — and they are precisely what turned HotDocs authoring into a specialist job. Recommended: not in this ceiling; decide deliberately if asked.                                  |
| **G7** | **Does the checker ship to the browser** for the slice 2·6·4 authoring surface? Cheap now (keep the module OOXML-free, which this design does); awkward to retrofit. Needs no answer to build, only to not foreclose.                                                                           |
| **G8** | **How a computed field appears in the merge-field input contract.** An expression is not a fillable field, and the field-input stream's catalog contract has no shape for one. Coordination, not a blocker.                                                                                     |

## 15. Open questions

1. **Where a list-valued dictionary source comes from.** Repeats need `exhibits`, `parties`,
   `disbursements` — each is a batched read the dictionary does not yet declare, and the dictionary's
   entry shape has no `list` value type today. Adding one is small; deciding which collections are
   worth exposing first is a product question the same build slice has to answer.
2. **Whether a refusal should be recoverable at the assembly interface.** A currency mismatch fails
   the assembly; whether the assemble dialog can offer "assemble anyway, leaving that clause out" is
   an interface decision with a real safety cost, and the answer is probably no.
3. **The interaction between an expression and a `protected()` value.** An expression that reads a
   protected key triggers the decrypt-permission-plus-audit path like any other read — but an
   expression that reads one only in a branch it does not take should arguably not decrypt at all.
   Resolution is batched and happens before evaluation, so today it would. Narrowing that is possible
   (evaluate conditions over non-protected keys first) and is not obviously worth the complexity;
   flagged rather than decided.
