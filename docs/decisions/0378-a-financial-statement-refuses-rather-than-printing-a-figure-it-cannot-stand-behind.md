---
number: 378
slug: a-financial-statement-refuses-rather-than-printing-a-figure-it-cannot-stand-behind
status: Proposed
date: 2026-08-17
area: Financial Core
summary: "The trial balance, balance sheet and income statement refuse by name rather than degrading: a trial balance that does not foot, a balance sheet that does not balance, trust asset and client-liability sections that do not net to zero, and any account carrying postings that no section would place. An unclassified account is the interesting one — dropping it silently means the statement does not foot, and lumping it into 'other' asserts a classification nobody made, so it refuses and names the accounts that need classifying, the posture the unmapped account role and the unresolved jurisdiction already take. Classification-on-the-account is safe because an entry names its accounts by handle, so a rename or a renumber restates no historical figure; RE-SECTIONING is the hazard, because a statement is assembled from classification at read time and moving an account across statements would silently rewrite last year's profit. It is bounded by making the section vocabulary a refinement of type with a DDL CHECK per type, and by refusing a type change on any account that carries lines — so a re-section can only move an account WITHIN one statement. Statements are bitemporal in the shape financial reporting already shipped and defended, and the temporal contract moves down into a shared leaf so exactly one validation of a period-plus-knowledge-instant triple exists rather than two. This slice OWNS these figures under the reporting layer's own class-1 discipline and reporting renders them without re-deriving; nothing is materialised, no closing entries and no period snapshot, and the performance relief held in reserve is the effective-date denormalization onto ledger_line argued from measurement rather than up front."
---

**A statement that cannot be stood behind is refused by name, and the classification that assembles it
can never move an account across statements.**

**Context:** the reporting layer deferred the trial balance, balance sheet, and income statement to this
slice with the words "it does not invent a partial book", and its own discipline says a figure another
package owns is called rather than re-implemented. This slice is that owner. A general ledger is also
where the two soft failures are most tempting: dropping an account nobody classified, and storing a
period-end balance.

**Decision:**

(1) **Each statement refuses rather than degrading.** A trial balance that does not foot refuses; a
balance sheet that does not balance refuses; trust asset and client-liability sections that do not net to
zero refuse, naming the trust account and the difference; and any account carrying postings with no
`statement_section` refuses, naming the accounts that need classifying. That last one is the load-bearing
refusal: dropping the account leaves a statement that does not foot, and lumping it into "other" asserts
a classification nobody made. Same posture as the unmapped account role and the unresolved jurisdiction —
a fact the platform does not have is not a fact it invents.

(2) **Re-sectioning cannot move an account across statements.** Classification on the account is safe
because an entry names its accounts by handle, so a rename or a renumber restates no historical figure. A
re-section is different: a statement is assembled from classification at read time, so moving an account
from an expense section to an asset section would silently rewrite last year's profit. Two guards bound
it — the section vocabulary is a closed refinement of `type` asserted by a DDL CHECK (drizzle text enums
are type-level only, which the ledger's own columns already state twice), and `type` is immutable on any
account that carries lines. Together those mean a re-section can only move an account within one
statement.

(3) **Bitemporal in the shape already shipped.** A civil-date period on the effective axis plus a
knowledge instant, filtering `effective_date <= periodEnd AND recorded_at <= knownAsOf`, so a stated
triple is a pure function of rows that cannot change. Omitting the instant means live, and a live
statement is stamped and does not claim to reproduce. The temporal contract moves down out of the
reporting package into the shared periods leaf, so exactly one validation of a triple exists in the
repository rather than two — the reporting package cannot be depended on by a domain package, and a
second validator would be a second answer to a bitemporal question.

(4) **This slice owns these figures; the reporting layer renders them.** Under that layer's own class-1
rule, a decomposition it later adds carries its agreement test proving it sums to the aggregate produced
here.

(5) **Nothing is materialised.** No rollup table, no cached total, no period snapshot, and no closing
entries. Every aggregate is computed in SQL and returned as a handful of rows; `account_balance` is never
read to answer a statement question, because it is a live figure with no as-of — the rule trust's
three-way proof already holds. The relief held in reserve is a copy of `effective_date` onto
`ledger_line`, written inside the posting batch so a composite index can drive the read: it duplicates an
immutable column of the same row's parent and cannot drift, unlike a stored balance. It is argued from
the slice's own measurement or not at all.

Builds on **ADR-0061** and **ADR-0072**.
