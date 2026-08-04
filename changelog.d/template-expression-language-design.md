---
category: Changed
---

**The template expression ceiling grows to computed expressions — design only, no code in this
change.** Document automation's conditional and repeating blocks were designed against a deliberately
narrow expression ceiling: presence, negation, and equality against a literal. On an owner decision
that ceiling now grows to **computed expressions** — arithmetic over money and numbers, date math,
comparisons, and a fixed catalog of formatting, pluralization, ordinal, and case helpers — plus a new
computed-field placeholder, so a fee agreement can state a cap, a settlement statement can split a
recovery, and a notice can compute a deadline thirty days out without anyone reaching for a
calculator and typing the answer in.

**The line that does not move: an expression is never executable template-supplied code.** Not code
we sandbox, not code we lint — code the grammar cannot express. There is no production for a function
definition, a property access, an index, an assignment, a lambda, a regular expression, a template
include, or a call to anything but an allowlist compiled into our own source. A merge key such as
`matter.number` is **one atom, not a traversal**: names resolve by exact match through a `Map`, so
`__proto__.constructor` is a missing merge field reported at registration rather than a reachable
prototype chain. That is the structural difference from the templating libraries that evaluate
JavaScript expressions from template content, whose sandboxes are denylists over a language that can
express everything and have failed twice as such.

**Termination is structural rather than a timeout.** No loop, no recursion, no self-reference, no
includes; a finite tree of bounded depth walked once; the only variadic-cost construct is `{{#each}}`,
which iterates a finite list of the firm's own data under a cap. Expressions do not iterate — the
document construct does.

**Money stays integer-exact, and division is not an operator.** No floating point anywhere in the
evaluator, no currency conversion, and mixed currencies refuse by name. `/` has no production at all;
in its place are three helpers whose rounding is explicit — `divideExact` (the exact quotient or a
refusal), `divideRounded` / `applyRate` / `percentOf` (**banker's rounding, half to even**, through
the money package's existing ledger rounding), and `allocate` (parts that sum exactly to the input).
Date math runs over calendar dates in the **matter's office** time zone through the existing
time-zone seam; there is no instant type and therefore no time-of-day arithmetic, and no business-day
or court-deadline helper ships, because that needs a maintained per-jurisdiction holiday calendar and
a wrong answer is a missed filing.

**Type errors are registration errors, with a location.** Expressions are lexed, parsed, name-
resolved, type-checked, and limit-checked when the template version registers, and a failure carries
the part, the paragraph, and the character offset to the field inspector — never an assembly
surprise. An unresolved **condition** fails the assembly by default (a wrong branch is invisible;
nobody reads a contract and notices the paragraph that is not there) while an unresolved **computed
field** renders a visible placeholder, and `has(...)` is the one-word total form for an author who
genuinely means "omit it when we have nothing on file".

The build slice is resequenced accordingly — grammar, evaluator, conditionals, repeats, computed
fields, each independently testable, with the first two touching no document at all so the language
is proven correct before it meets an OOXML package. The security claim carries a standing fuzzing
obligation: structure-aware and byte-level generation, a committed hostile-input corpus that must
fail at parse or check rather than at evaluation, an arithmetic oracle, and one test per resource
bound.

Design: `docs/specs/2026-08-04-template-expression-language-design.md`. Plan:
`docs/specs/2026-08-04-document-automation-implementation-plan.md`.
