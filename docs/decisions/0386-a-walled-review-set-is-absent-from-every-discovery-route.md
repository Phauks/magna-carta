---
number: 386
slug: a-walled-review-set-is-absent-from-every-discovery-route
status: Proposed
date: 2026-08-19
area: Discovery
summary: "The per-review-set access list shipped with the coding surface and was composed by the coding reads alone. Every other discovery route — the review-set LIST, the review set itself, its loads, its Custodians of Record, and every write including the irreversible close — reached a corpus on a discovery permission and nothing else. A member holding all five discovery grants and on no access list could read a walled review set's name, which on a matter is itself the disclosure that a production was received, and could rename or CLOSE it, releasing its derived artifacts with no path back. Every route that names a review set now resolves it through the access list first and answers ABSENT rather than refused; the nine new member-facing reads compose the predicate in SQL ahead of the LIMIT, and the visibility fitness sweep gained a second registry so they are held to it from the same table-driven pass the coding reads use."
---

**A wall that only the newest surface stands behind is not a wall, and the routes that predated it
were the ones holding the destructive operations.**

**Context.** The review-set access list is fail-closed by construction: no row means no access, and a
review set a member is not listed on produces no rows, no count, no progress figure and no error
naming it. The coding statements compose it as a required argument, and a table-driven fitness pass
proves every registered builder puts it inside the WHERE clause and ahead of the LIMIT.

The list arrived with the coding surface. The routes built before it — the review-set model's own —
were written when a discovery permission WAS the access rule, and nothing went back over them. So
`GET /matters/{id}/review-sets` returned every review set on the matter to anybody with
`discovery:read`, and `POST /review-sets/{id}/state` accepted `closed` from anybody with
`discovery:manageReviewSets`. Closing a review set marks its extracted text and its metadata sidecars
collectable and there is no reopen; the reason there is no reopen is that closing is meant to be a
deliberate act by somebody entitled to make it.

The name alone is enough to matter. "Plaintiff's production, Ridgeway settlement" on a matter tells a
reader that a production was received, from whom, and about what — before anybody opens a document.

**Decision.** Every discovery route that names a review set, directly or through a load or a Custodian
of Record, resolves it through the access list before doing anything else, and returns the same 404 as
for a review set that does not exist. A 403 would be its own bug: it names the corpus.

The member-facing READS live in `packages/discovery/src/review-reads.ts` and take the predicate as a
required argument, so a read that forgets it is a type error first and a fitness failure second. The
pipeline reads beside them deliberately do not: a queue consumer runs with no member and no session
over a corpus the platform itself put there, and composing a predicate with nobody bound would be a
clause matching whatever the previous binding happened to be. That split is stated in the package's
own rules and is why the registry is per module rather than per package.

The WRITE routes take a gate rather than a predicate — one read that either refuses or does not —
because a write does not narrow a result set, it either happens or it does not, and the honest shape
of "you may not do this to a corpus you cannot see" is a refusal before the write rather than an
UPDATE whose WHERE clause silently matched nothing.

**Considered and rejected.** **Leaving the list read unscoped and relying on the per-document reads**
— the name is the disclosure, and a list of names is the cheapest possible enumeration of a firm's
protective-order material. **Returning an empty list for a walled review set on the routes that
return lists** — indistinguishable from an empty corpus for the loads and custodians, which is fine,
but it confirms the review set resolves, so the identifier itself becomes an existence oracle. **A
403** — it is the most natural status and it is the one thing that must not be returned.

**Consequences.** A member who creates a review set is on its list, seeded in the same commit as the
review set itself, so no ordinary flow changes. A member who was relying on a discovery grant alone
to reach somebody else's corpus stops being able to, which is the point. Widening a list is a recorded
act somebody performs on purpose — inferring a wall's membership from matter staffing would assert
something about who is cleared that nobody decided.
