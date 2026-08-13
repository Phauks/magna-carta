---
number: 230
slug: template-expression-aggregates
status: Proposed
date: 2026-08-05
area: Document Automation
summary: "Owner flag G4 is answered: aggregates over a repeat collection are ADMITTED, on exactly the terms the original exclusion named. `sum`, `minimum`, and `maximum` take a LITERAL FIELD PATH of a list-valued merge key — one lexical atom, resolved by exact match, never an expression — and their cost is bounded by the data on the same terms a repeating block's is: the collection arrives from the batched read it already cost, the items-per-repeat cap applies unchanged, and every element is charged a step against the budget the whole document shares. `count` is deliberately NOT repeated among them, because `count(matter.parties)` already answers it and a field-path spelling could differ only by skipping items whose field is absent, which is a filter. Element types are checked at REGISTRATION — `sum` folds number and money, `minimum` and `maximum` fold number, money, and date — and the result carries the element's type, with money folding through the same addition the `+` operator uses. RECOMMENDED AND FLAGGED for owner review: an aggregate over an EMPTY collection is an ABSENCE (unresolved, naming the collection) rather than a zero, uniformly across all three helpers; an item carrying nothing for the field likewise leaves the answer unresolved rather than being skipped. Named `minimum` and `maximum` rather than `min` and `max`, because the repository spells names out."
---

**Aggregates over a repeat collection are admitted (G4), and an aggregate over an empty collection is
an absence rather than a zero.**

**Context:** The expression-language design excluded aggregates and recorded honestly why the exclusion
was a line rather than a safety property: a bounded aggregate over resolved data would be _safe_ — its
cost bounded by the data, not by the expression, exactly as `{{#each}}` is — and the only objection
left standing was that it is iteration inside an expression. It also predicted that "the total of all
disbursements" would be the first thing a firm asks for. The owner answered the flag on 2026-08-05:
admit them, on the terms that argument rested on. Nothing about the security property is at stake here;
what is at stake is whether the bound stays a bound, and what a template prints when a collection is
empty.

**Decision:** (1) **`sum`, `minimum`, and `maximum` join the fixed helper catalog**, each taking one
argument: a **literal field path**, `<collection>.<field>`, which the lexer already reads as a single
atom and which the checker resolves by exact match against a list-valued key and the fields its items
carry. There is no production admitting an expression there, so there is still no iteration an author
can write — no map, no filter, no sort, no comprehension, nothing under the fold. The set of values
folded is fixed before evaluation starts.

(2) **The bound is a repeat's bound, unchanged.** The collection arrives from the one batched read it
already cost; a collection larger than the items-per-repeat cap refuses with the same code a repeat
would; each element costs a step against the budget shared by every expression in the document. An
aggregate can therefore make an assembly no more expensive than the `{{#each}}` an author could already
have written over the same collection.

(3) **`count` is not repeated as an aggregate.** `count(matter.parties)` already answers how many items
a collection has. A second spelling over a field path could differ only by skipping items whose field
has no value — which is a filter, and a filter is the thing this language refuses.

(4) **Element types are checked at registration.** `sum` folds `number` and `money`; `minimum` and
`maximum` fold `number`, `money`, and `date`. A total of text, or a smallest yes-or-no, is a
registration error naming the field and its actual type, while a human is still looking at the
template. The result carries the element's type, and money folds through the same addition the `+`
operator uses — same same-currency refusal, same before-the-operation safe-integer check, no second
implementation of adding money.

(5) **RECOMMENDED AND FLAGGED — an aggregate over an EMPTY collection is `unresolved`, naming the
collection, for all three helpers.** A smallest of nothing has no answer in any type. A total of no
amounts would have to name a currency, and a currency is a fact the firm's data carries rather than one
a template may invent — the same reason there is no money literal. Returning the identity element for
`number` alone was considered and rejected: it would give the family a rule that changes with the
element type, so an author would have to know which of four types a field is to predict whether an
empty collection prints a zero or a hole. Absence then flows exactly where absence already flows — a
visible placeholder in a computed field, a failed assembly in a condition — and the total forms are one
word away: `isEmpty(collection)` asks first, `default(…)` supplies a fallback.

(6) **RECOMMENDED AND FLAGGED — an item carrying nothing for the named field leaves the answer
unresolved**, naming the path, rather than being skipped. Skipping would silently understate a total,
and a total that is quietly wrong is the failure this subsystem exists to prevent.

(7) **Named `minimum` and `maximum`, not `min` and `max`.** Names are spelled out here, and these are
consumer-facing vocabulary a paralegal reads in a template; the abbreviation saves four characters and
costs the rule.

**Considered & rejected:** _Zero of the element type for an empty `sum`_ — the useful answer for a
number column, and it makes the family's behaviour depend on a type the author cannot see in the
template. _A refusal for an empty collection_ — a matter with no disbursements is ordinary data, not an
arithmetic impossibility, and failing the whole assembly over it would misuse the refusal vocabulary,
which is reserved for what cannot be computed. _Skipping items whose field is absent_ — reads as
helpful and produces a total nobody can reconcile. _Admitting a list VALUE as the argument
(`sum(allocate(x, 3))`)_ — always equal to its own input by construction, and it would open the
argument position to computed lists. _A `count` over a field path_ — a second spelling of an answer the
catalog already gives, whose only distinct meaning would be a filter.

**Consequences:** The aggregates are the only helpers whose cost grows with the firm's data, so the
items-per-repeat cap now governs an expression as well as a block — a fact worth keeping in view if
that cap is ever raised. `matter.parties` carries only text fields today, so nothing in the shipped
dictionary can yet be totalled; the helpers are exercised against synthetic collections until the
widened dictionary lands a money-typed or date-typed item field, at which point the empty-collection
ruling becomes visible to firms and is the part of this decision most worth revisiting with real
templates in hand. Amends the G4 item recorded in `template-expression-realization`; depends on
ADR-0218.
