---
category: Changed
audience: internal
---

**The notification dedupe key now says what it guarantees: duplicate suppression bounded by the firm's
retention window, not a permanent record that a subject was ever notified about. And the one bound in the
comparison sweep that could stop it finding things without saying so now says so.**

**The question, and why the answer is "intended".** The UNIQUE index that makes a notification fire once
lives on `notification_event.dedupe_key` — a column on a row the retention sweep deletes. Read as "once,
ever", which is how "dedupe key" reads to almost everybody, that is a defect waiting to happen. It is not
one, and the subsystem's own design says so: it frames the key as a **redelivery** floor throughout, with
the comparison path raising "once per day" in as many words. Each production path's required lifetime is
far shorter than the thirty-day retention floor — an outbox row is published once and flipped out of
`pending`, so the relay never re-carries it; a comparison's civil-date bucket is derived from the pass's
own instant, so the bucket can only move forward and a swept one is unreachable rather than merely
unlikely; a job reports each terminal state once inside its own life. No shipped consumer depends on
forever semantics.

**What was actually wrong was where the fact lived.** The boundary had been worked out and written down —
in the billing automations' design, for billing's own purposes, when that slice decided to put its
convergence in `invoice_reminder` rows rather than on this key. The notifications subsystem itself said
nothing about it, so the next author had to re-derive it or get it wrong. Each production path now
declares a **convergence horizon** in `CONVERGENCE_HORIZON_BY_RAISER`, as a `Record` keyed on the raiser
union so a fourth production path is a **compile error** until it states how long its key must hold. Both
ends of the mechanism — the key builders and the retention sweep — name the boundary and the rule that
follows it: a condition that must raise once per subject **forever** carries its convergence in the owning
subsystem's own tables and points a notification at that record. A fitness test states the semantics out
loud by re-inserting a key the sweep took, then proves the property that makes it safe by holding the
comparison bucket to following the clock rather than anything stored.

**No durable key table, deliberately.** It would serve no consumer that exists and would trade a bounded
pointer store for an unbounded one — one row per notification ever raised, in a subsystem whose entire
defensibility rests on holding pointers with a window rather than records without one. "Retain a key
forever" is a storage decision, and nothing asked for it.

**The uncounted clamp.** The comparison pass's per-kind findings cap was already honest: it over-reads by
one to detect rather than infer, and reports `notifications.comparison_clamped`. Its **zone discovery**
was not. The deadline comparison needs one cutoff per zone because no D1 query can resolve a zone, and
that read was bounded at the same two hundred with no over-read and no counter. A truncated zone list is
worse than a clamped finding count and fails differently: a zone the read never returns contributes no
cutoff, so every deadline in it matches neither the overdue bound nor the due-today window, and the pass
reports nothing at all about a whole jurisdiction while every other counter reads healthy — a check that
stopped looking and still reads as coverage. It now over-reads by one and reports
`notifications.comparison_zone_discovery_truncated`, on its own metric rather than folded into the findings
clamp, because a clamp bounds what was missed and this does not bound it at all. The value counts
truncated **passes** rather than zones: a read that over-reads by one to catch its own truncation learns
that it truncated and can never learn by how much, and a magnitude invented there would be the same
dishonesty one level down. It is reported even from the early return where no zone resolved and the pass
found nothing, because "I found nothing" and "I could not finish looking" are different statements.

The collectors' incompleteness now travels in the tally's own delta shape rather than a purpose-built
map per kind of clamp, which is what let the zone truncation go uncounted in the first place: a new kind
of incompleteness no longer needs a new parallel channel to be reportable.

**Not changed, and left to the owner:** whether two hundred findings per kind per pass is the right
ceiling. It is counted rather than silent, but a busy litigation practice can exceed it honestly, and
raising it changes how much of a firm's overdue work gets reported as well as what one pass costs.
Recorded on the ledger node rather than decided here.
