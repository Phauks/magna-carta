---
number: 382
slug: posting-dimensions-live-on-the-line-and-the-statements-that-need-them-wait
status: Proposed
date: 2026-08-17
area: Financial Core
summary: "Matter and location dimensions go on ledger_line rather than ledger_entry, because one vendor bill carries lines for two matters and a rent expense has an office but no matter at all. This amends the ledger's account-only account model without replacing it: ACCOUNTS ENFORCE BOUNDS — the per-matter trust leaf stays a child account row, because the no-negative invariant is the account_balance bounds CHECK, which is per balance row and has no dimension equivalent — while DIMENSIONS ENABLE SEGMENTATION. Practice area is deliberately not a column: the referent is matter.matter_type_id, reachable by join once the line carries the matter, and denormalizing it is a cache under the measure-first rule. Timekeeper is excluded because the grain is wrong — at invoice finalize many timekeepers' work aggregates into one receivable line — and realization reads the work-in-progress store where that grain lives. The honest half is a scope-out rather than a caveat: the general journal and vendor bills populate the columns and the trust, billing and cost paths are NOT retrofitted, so they write null, which is additive and breaks nothing. A per-office or per-matter income statement assembled from a dimension the income-producing paths do not write would be silently partial, so those statements are NOT DESIGNED in this slice. The columns land anyway, because a nullable column on the line is cheap now and expensive to retrofit into every posting path later, and because the paths this slice owns populate them from the first day."
---

**Matter and location are dimensions on the ledger line, and the statements that would need them fully
populated are not built until the paths that produce income write them.**

**Context:** the ledger's account model contemplated accounts alone, with subledgers expressed as child
accounts under a parent roll-up. That is right for client trust ledgers and wrong for firm-wide
segmentation: a rent expense belongs to an office and to no matter, and an account per office per expense
category is a chart nobody can read.

**Decision:**

(1) **Two nullable, indexed columns on `ledger_line`** — `matter_id` and `location_id`. On the line
rather than the entry, because one vendor bill carries lines for two matters. `location_id` is
independent rather than derived from the matter, because an expense can have an office and no matter.

(2) **Accounts and dimensions answer different questions and both survive.** Accounts enforce **bounds**:
the per-matter trust leaf must stay a child account row, because the no-negative trust invariant is the
`account_balance` bounds CHECK, which is per balance row and has no dimension equivalent. Dimensions
enable **segmentation**. Neither replaces the other, and nothing about the trust tree changes.

(3) **Practice area and timekeeper are deliberately excluded.** Practice area's referent is
`matter.matter_type_id`, reachable by join once the line carries the matter; denormalizing it is a cache
and the measure-first rule governs. Timekeeper's grain is wrong — at finalize, many timekeepers' work
aggregates into one receivable line — and realization reads the work-in-progress store, where that grain
lives.

(4) **Existing paths are not retrofitted, and the statements that would need them are scoped out.**
The general journal and vendor bills populate the columns; trust, billing, and cost postings write null,
which is additive. So a per-office or per-matter **income statement** would be assembled from a dimension
the paths producing income do not write, and would be silently partial. Those statements are therefore not
designed in this slice, and saying "we have dimensions, here is a per-office profit figure" is the worst
outcome available. The columns land anyway: a nullable column on the line is cheap now and expensive to
retrofit into every posting path later, and the paths this slice owns populate them from the first day.

Amends **ADR-0072**.
