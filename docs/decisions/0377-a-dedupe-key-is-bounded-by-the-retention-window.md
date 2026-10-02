---
number: 377
slug: a-dedupe-key-is-bounded-by-the-retention-window
status: Proposed
date: 2026-08-17
area: Notifications
summary: "The UNIQUE index on notification_event.dedupe_key sits on a row the retention sweep deletes, so the guarantee it carries is duplicate suppression bounded by the firm's window and not a permanent record that a subject was ever notified about. Confirmed as the intended contract rather than a defect, on the subsystem's own evidence: the delivery design frames the key as a redelivery floor throughout, and each production path's required lifetime is far shorter than the thirty-day retention floor — an outbox row is published once and flipped out of pending so the relay never re-carries it, a comparison's civil-date bucket is derived from the pass's own instant so it can only move forward, and a job reports each terminal state once inside its own life. No shipped consumer depends on once-per-subject-forever semantics, and the platform already routes conditions that need it away from this key: billing's automations put their convergence in invoice_reminder rows and recorded why. The decision is therefore to name and enforce the boundary rather than build a durable key table: each production path declares a convergence horizon in a Record keyed on the raiser union, so a fourth path is a compile error until it states one; the rule that a condition needing once-per-subject-forever convergence carries it in the owning subsystem's own tables and points a notification at that record is written into the subsystem's own home rather than only into another subsystem's design; and a fitness test states the semantics out loud by re-inserting a key the sweep took, then proves the comparison bucket follows the clock. A durable key table is rejected: it would trade a bounded pointer store for an unbounded one to serve no consumer that exists."
---

**A UNIQUE index is only a guarantee for as long as its row lives, and this one lives on a row the
retention sweep deletes. That is the contract — so the fix is to say so, not to make the key immortal.**

**Context:** `notification_event.dedupe_key` carries a UNIQUE index, and it is what makes a notification
fire once: a queue redelivery, an overlapping sweep, or a re-reported job all converge on it and the
duplicate insert is refused. `retentionSweepDeleteStatements` in `packages/notifications/src/retention.ts`
deletes `notification_event` rows on the firm's configured window. Both facts are plain in the source,
and together they mean the uniqueness that enforces "once" is gone once retention ages the row out.

Read as "once, ever" — which is how "dedupe key" reads to almost everybody — that is a defect: a
condition still true after the window would be raised again, silently. So the question is what the key
was ever promising, and the evidence is unusually clear.

The delivery design describes the key as a **redelivery** floor and never as a permanent record: "Queues
are at-least-once and sweeps overlap. Both paths converge on one floor", path A's outbox row id being
"stable across every redelivery of that message, so a redelivery is a no-op by construction", and path
B's civil date making an overdue deadline raise "**once per day** rather than once per sweep". Once per
day is already not once ever, stated in the design's own words.

What settles it is that each path's required lifetime is bounded, and bounded far below the shortest
window a firm may set (thirty days):

- **The outbox path.** `sweepOutbox` selects only rows with `status = 'pending'` and flips each to
  `dispatched` or terminally `failed`. The relay never re-publishes a row it carried, so a duplicate can
  only come from overlapping sweeps or a queue redelivery — minutes — or from an operator deliberately
  reviving a dead-lettered row. Nothing re-presents a ninety-day-old outbox row on its own.
- **The comparison path.** Both collectors derive the civil-date bucket from the pass's own instant, so
  the bucket a pass can produce moves only as the clock does. A swept bucket is **unreachable by
  construction**, not merely unlikely — this is the property that makes deleting the row safe, and it is
  now held by a test rather than left as a reading of the code.
- **The job path.** A coordinator reports each terminal state once inside the job's own life; nothing
  revisits a job that ended a window ago.

And the platform has already answered this once, deliberately, for the one consumer that genuinely needed
more. The billing automations put their convergence in `invoice_reminder` rows — unique on the invoice,
the reason and the ordinal — precisely because "a condition whose only convergence is that key re-fires
once the row ages out… for a reminder step that must fire once per invoice, ever, it is a defect". That is
one consumer's answer already, reached from first principles, and it is the right pattern.

**Decision:** the boundary is the intended contract. Name it and enforce it; do not make the key outlive
its row.

**Each production path declares a convergence horizon.** `CONVERGENCE_HORIZON_BY_RAISER` in
`packages/notifications/src/materialize.ts` is a `Record<NotificationRaisedBy, ConvergenceHorizon>`, so
adding a fourth production path is a **compile error** until it states how long its key must hold. The
horizon is a property of the path rather than of each type, because the path already determines the key
shape one-to-one — a per-type field would be derivable from `raisedBy` and therefore free to disagree
with it, which this registry avoids elsewhere for the same reason.

**The rule that follows is written in the subsystem's own home.** A condition that must raise once per
subject **forever** carries its convergence in the owning subsystem's own tables, with their own UNIQUE
index and their own retention posture, and the notification points at that record. This is the
idempotency form of the rule the subsystem already holds — a notification is a pointer and never a
record — and it now lives in `packages/notifications/CLAUDE.md` and at both ends of the mechanism in
source, rather than only in another subsystem's design document where it had to be re-derived.

**The semantics are stated out loud in a test.** `test/retention-convergence.test.ts` re-inserts a key the
sweep took and asserts it succeeds. A test that asserted the opposite would be the documentation defect
in test form; asserting the truth is what stops the next reader from mistaking the index for a record.

**Considered and rejected:** **A durable dedupe-key table or tombstone.** It is the obvious answer and it
is the wrong one twice over. It serves no consumer that exists — every shipped path is retention-safe by
construction — and it would trade a bounded pointer store for an unbounded one: a key retained forever
accumulates one row per notification ever raised, in a subsystem whose entire defensibility rests on the
fact that it holds pointers with a window rather than records without one. "Retain a key forever" is a
storage decision, and nothing asked for it. **Renaming the `dedupe_key` column** to say "window" in its
name: widening or renaming a CHECK or a column on a growing table rebuilds it, which is the cost this
subsystem already refuses for its `channel` set, and the name is not what was wrong — the missing
statement of the boundary was. **Keying the comparison path on the subject alone** and letting retention
do the re-raising: that is once-per-window semantics by accident, with the window as the schedule, and it
would make a firm's retention setting silently control how often it hears about an overdue deadline.

**Consequences:** No firm-observable behaviour changes; nothing durable is added; no table or column is
touched. The subsystem gains a stated, compile-enforced boundary where it had an inference, and the next
raiser confronts the question at the point of declaring itself rather than discovering it as a
notification that quietly raised itself again months later. The accepted cost is that a future condition
needing once-per-subject-forever convergence must build a record in its own domain — which is more work
than a durable key table would have been, and is the same work billing already did and was right to do.
