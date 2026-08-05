---
slug: template-expression-realization
status: Proposed
date: 2026-08-05
area: Document Automation
summary: "Realization decisions taken while building the template expression language, each an OWNER-REVIEWABLE DEFAULT applied as the design recommended rather than a new direction: an unresolved CONDITION fails the assembly naming the field and the total form to write instead, never treat-as-false (G1); banker's rounding is the only mode a template author sees, through the money package's roundLedger, with roundTax and roundInvoiceLine deliberately absent (G2); no business-day or court-deadline helper ships (G3); no aggregate over a repeat collection (G4, superseded the following day by `template-expression-aggregates`, which admits them on the owner's answer); no pronoun or verb-agreement helper, because choose covers it visibly and it would require recording a gender attribute on a party (G5). Plus six choices the design left open: an {{#each}} over allocate binds each part as loop.value, since a split's parts have no field names of their own; a conditional closes with either {{/if}} or {{/unless}} while a repeat closes only with {{/each}}; a marker in a table row's FIRST CELL makes the ROW the unit even when the same marker would otherwise read as a paragraph block; the declared tree-depth bound counts NODES, guarded separately from the parser's own recursion, so that pretty-printing an expression cannot change whether it is legal; braces are not expressible inside a text literal, because the placeholder delimiters own them; and matter.parties — role plus Directory display name, one batched read joined across directory_person and directory_organization — is the first list-valued dictionary source, answering the design's open question about where a collection comes from."
---

**The owner-flagged defaults G1 through G5 are applied as the design recommends, and six under-specified points are settled in the direction that keeps the language closed.**

**Context:** ADR-0218 fixed the expression ceiling and the security property. Building it surfaced two
kinds of open question. The first kind is the design's own owner flags — real product choices with a
recommended answer, which a build has to pick one way or the other to ship at all. The second kind is
detail the design did not reach: what an author writes to print one part of a split, which closing
marker matches which opening one, what happens when a marker sits in a table row's first cell and could
be read two ways, and what a depth bound counts.

**Decision:** (1) **G1 — an unresolved condition FAILS the assembly**, naming the merge field and
naming `has(…)` as the total form to write instead. The alternative, treating an unknown condition as
false, never interrupts anyone and produces documents silently missing clauses; nobody reads a contract
and notices the paragraph that is not there. The safe reading stays one word away, and the dangerous one
cannot be reached by accident. An unresolved computed FIELD renders a visible placeholder instead — the
asymmetry is the point, because a hole on the page is something a human cannot miss.

(2) **G2 — banker's rounding only**, through `@magna-carta/money`'s `roundLedger`. `roundTax` (half-up)
and `roundInvoiceLine` (half-away-from-zero) are not in the catalog: a template computing statutory tax
or an invoice credit is a document reimplementing the billing subsystem, which is where those rules
belong and where they are tested.

(3) **G3 — no business-day or court-deadline helper.** It needs a per-jurisdiction holiday calendar with
an effective date, maintained forever; a wrong answer is a missed filing, which is a content obligation
with an owner rather than a helper.

(4) **G4 — no aggregate over a repeat collection.** `sum(disbursements.amount)` would be safe (bounded
by the data, exactly as `{{#each}}` is) and a settlement statement will ask for it, but it is iteration
inside an expression, which is the line ADR-0218 drew. Recorded as a named seam, not smuggled in.
**Superseded the following day:** the owner answered G4 by admitting aggregates on exactly those
terms — see `template-expression-aggregates`, which is now the home for what they are and what an
empty collection means.

(5) **G5 — no pronoun or verb-agreement helper.** It requires recording a gender attribute on a party,
which is the part we do not want; `choose(condition, "his", "her")` lets an author write it explicitly
and visibly.

(6) **`{{#each allocate(amount, n)}}` binds each part as `loop.value`.** A split's parts have no field
names of their own, so inventing a collection name for them would be inventing a fact; keeping the
binding inside the reserved `loop.` namespace costs no new vocabulary.

(7) **A conditional closes with either `{{/if}}` or `{{/unless}}`; a repeat closes only with
`{{/each}}`.** `{{#unless}}` exists because it reads better in a document, and an author reaching for
the closing mark that matches their opener is not making a mistake — blocks are properly nested, so
neither reading is ambiguous. Confusing a repeat with a condition, on the other hand, would expand or
drop the wrong span, so that pairing stays exact.

(8) **A marker in a table row's FIRST CELL makes the ROW the unit**, and the row's cells are not then
walked again for a paragraph-level block. Partial rows are how a table's banding and column widths go
wrong, and a rule that sometimes means the row and sometimes the paragraph is a rule nobody can predict.

(9) **The declared tree-depth bound counts NODES, and the parser's recursion is guarded separately.**
The parser descends one function per precedence level and most of those produce no node, so conflating
the two would make the published cap several times tighter than it says — and, worse, would make
pretty-printing an expression change whether it is legal, which breaks the reparse property that detects
precedence bugs.

(10) **Braces cannot appear inside a text literal**, because the placeholder delimiters own them. Stated
rather than worked around: an escape would put a second parser inside the first.

(11) **`matter.parties` is the first list-valued dictionary source** — the matter's linked parties with
their role and Directory display name, resolved by ONE batched read that joins `matter_party` to
`directory_person` and `directory_organization`. It answers the design's open question about where a
collection comes from with the collection the language could actually be exercised against today; the
richer Directory role sources and firm custom fields arrive with the widened dictionary.

**Considered & rejected:** *Treating an unresolved condition as false* — the option that never
interrupts anyone, rejected for exactly that reason. *Exposing all three rounding modes* — one line of
code, and an invitation for a template to reimplement billing. *Binding an allocate's parts to a
synthetic collection name such as `parts.amount`* — reads better in one example and invents a fact
nobody declared. *Making `{{/if}}` the only conditional closer* — tidier, and it turns a reasonable
author instinct into a registration failure for no gain. *Counting parser recursion as tree depth* —
already written that way, and the round-trip fuzz property found it within an hour, which is what that
property is for.

**Consequences:** The five owner flags now have code behind them, so changing any of G1 through G5 is a
change to shipped behaviour rather than a decision still open — G1 in particular is visible to every
firm the first time a condition reads a field a matter does not carry. `matter.parties` puts one
collection in front of authors before the dictionary widens, which means the collection vocabulary is
set by a source chosen for availability rather than for product fit; a later, better-shaped collection
would sit alongside it rather than replace it. Depends on ADR-0218; realizes it.
