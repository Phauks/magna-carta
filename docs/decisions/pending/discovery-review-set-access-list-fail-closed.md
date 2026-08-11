---
slug: discovery-review-set-access-list-fail-closed
status: Proposed
area: Discovery
date: 2026-08-08
summary: "The per-review-set access list is fail-closed and composed as a SQL predicate. A review set with no access rows is reachable by nobody rather than by everybody holding a discovery permission, so a bug in the seeding path hides a corpus instead of disclosing one. The predicate is a required argument to every review-set statement builder and is composed into the WHERE clause before the LIMIT — never applied in the Worker after rows return — proved for every registered builder by a table-driven fitness pass modelled on packages/calendar/test/source-fitness.test.ts. The list is seeded with the creating member alone rather than the matter team, widening is a recorded act requiring discovery:produce, the last member cannot be removed, and existing review sets are backfilled with their creator by the migration. Coding writes no generic audit row: the coding journal is the audit."
---

**Make the per-review-set access list fail-closed, compose it in SQL as a required predicate, and seed it with the creating member alone.**

**Context:** The review-workflow design (docs/specs/2026-08-07-discovery-5-2-review-workflow.md) called
for the per-review-set access list that the review-set model named and deliberately did not build — "a
list nothing renders is a list nothing enforces" — with membership "defaulting to the matter team at
creation, narrowable to named members, checked by every discovery read and write beside the permission
check." Three things the design left open had to be settled to build it, and each is the kind of choice
where the wrong answer is a confidentiality breach rather than a bug: what an empty list means, where
the check happens, and who a new list starts with. Review sets created before this change carry no
access rows at all, so whatever an empty list means, it means it for every corpus already in the fleet.

**Decision:** An empty access list means **nobody**, not everybody. The predicate is a **required**
argument to every statement builder that touches review-set content, composed into the WHERE clause
before the LIMIT, and is never applied in the Worker after rows come back; a registry of every
access-taking builder is enumerated by a fitness pass that asserts marker presence, WHERE-clause
placement and LIMIT ordering for each, plus a source scan proving the registry has not fallen behind the
file and a behavioural pair proving the predicate actually excludes. A route additionally checks
membership so the status code is a **404 rather than a 403** — a walled corpus is absent, not present
and refused — but that check is a courtesy, not the wall. A new review set's list is seeded in the same
batch as its own insert with **the creating member alone**; the migration backfills one row per existing
review set for its creator. Widening the list requires `discovery:produce`, writes a generic audit row
carrying the member id, and removing the **last** member is refused by name. Coding itself writes **no**
generic audit row — the coding journal carries the actor, instant, scope, criteria, frozen selection and
reversal, and two homes for one fact drift.

**Consequence:** Fail-closed inverts the failure mode: a seeding bug makes a corpus unreachable, which a
person notices and an administrator repairs, rather than disclosing one, which nobody notices. It also
means **existing review sets narrow on merge** — anyone other than the creator who was reviewing one
must be added back deliberately. That is the intended direction, and it is why the list is seeded from
the creator rather than from matter staffing: inferring a wall's membership from who happened to be
staffed would assert something about who was cleared that nobody ever decided, which is precisely the
assertion a protective order makes consequential. The refusal to empty the list keeps a corpus from
becoming permanently unreachable, since under fail-closed nothing short of a migration could reopen it.
The SQL-composed predicate makes the page a page — a post-filter would under-fill it and turn the page
size into an existence oracle for the rows it removed — and gives every later review surface (the
privilege log, production membership, quality-control sampling) one seam to inherit rather than a rule
each must remember.
