---
category: Security
audience: internal
---

**The firm's matter-visibility gate could be silently neutralized by the caller's own table names, and
the fitness functions that exist to guarantee it could never have caught that.**

The predicate every matter-scoped read composes is an `EXISTS` over `matter`, correlated to an
expression the caller supplies. Written against the bare table name, the correlation dies whenever
the CALLER's query also has an unaliased `matter` in scope: inside the subquery `matter` resolves to
the subquery's own copy, the correlation degenerates to `matter.id = matter.id` — true of every row —
and the `EXISTS` is satisfied by any visible matter in the firm rather than by the one being checked.
The gate reads exactly like a working gate and checks nothing.

**It shipped.** The call and text log's anchor check selected from `matter` and composed the
predicate over its own id, so it accepted every matter in the firm, the platform-owned custody
holding matter included. It was caught by a behavioural test asserting that holding matter is
unreachable — not by anything looking at the SQL, and not by any of the three fitness functions whose
whole purpose is this predicate. They assert the predicate's MARKER appears in the built statement,
and it did: the predicate was composed, it was composed uselessly, and a test looking for evidence of
composition cannot tell those two apart.

**Fixed at the source rather than at the call site: the subquery now aliases its own table.** A
caller's `matter` can no longer be shadowed, so an expression naming `matter.id` correlates to the
caller's row — which is what every author writing one intends. The failure becomes unwritable rather
than merely tested for. The narrowed variant gets the same treatment, and there it matters more: that
is the shape an ethical-wall overlay takes when it is built, where a dead correlation would exclude
the wrong rows rather than merely fail open.

**Swept, and this was the only instance.** All 56 call sites of the predicate were checked against
the two conditions the bug needs — the predicate composed, and an unaliased `matter` in the caller's
own FROM or JOIN. No timeline or search source is exposed: none passes `matter` as its `from`. Two
hand-written `EXISTS` clauses over `matter` exist, in the task list and the notification feed, and
both correlate against a different table, so both are sound.

Three regression tests, each verified to fail against the old predicate, including one that reads
real rows and watches the holding matter leak. The calendar's schema-name scanner now knows the
alias, with the reason attached, so nobody removes it to quiet the scan.
