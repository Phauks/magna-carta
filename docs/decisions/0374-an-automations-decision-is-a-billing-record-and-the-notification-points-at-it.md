---
number: 374
slug: an-automations-decision-is-a-billing-record-and-the-notification-points-at-it
status: Proposed
date: 2026-08-16
area: Financial Core — Billing
summary: "A billing automation writes a durable billing record of what it decided and emits an outbox topic; Notifications subscribes as an ordinary outbox-topic type and delivers. It does NOT use the comparison-sweep production path, for two concrete reasons. Convergence: a reminder step must fire once per invoice ever, and the notification dedupe key is a UNIQUE index on notification_event — a row the nightly retention sweep DELETES on the firm's window — so a reminder whose only convergence is that key re-raises the day it ages out. Completeness: MAX_COMPARISON_FINDINGS_PER_KIND caps a comparison at two hundred findings per firm per pass, and a capped reminder is a bill nobody chased. The comparison path stays for conditions the owning package deliberately refuses to store, which is what it was built for; these conditions ARE stored, because a firm has to see what was decided on its behalf after the notification is gone. This is Notifications' own rule — a notification is a pointer and never a record — applied where it lands."
---

**A notification is a pointer, so the thing it points at has to exist first — and for an automation
that thing is a billing record, not the notification itself.**

**Context.** Slice 3·7 raises four kinds of finding: a recurring bill was drafted, a schedule paused, an
invoice crossed a reminder step, a retainer fell below its floor. Notifications ships three production
paths, and the tempting one is `comparison-sweep`: the overdue-deadline and custody-review machinery is
already there, already bucketed, already capped, and adding a fourth comparison to `sweep.ts` looks like
the smallest change. It is the wrong path, and the reasons are properties of the shipped code rather
than preferences.

**Reason one: the dedupe key is on a row that gets deleted.** The comparison path's convergence is a
UNIQUE index whose key carries a **civil date**, because a condition that is continuously true would
otherwise raise every time the sweep runs. That is exactly right for "this deadline is overdue". A
reminder step is a different shape: it fires **once per invoice, ever**, so its key carries no date. And
the key lives on `notification_event`, which `retentionSweepDeleteStatements` removes on the firm's
retention window — thirty to three hundred and sixty-five days, ninety by default. A reminder whose only
convergence is that key re-raises the day the row ages out, and the failure is silent, late, and looks
like a bug in the comparison rather than in where the key was kept.

**Reason two: a comparison is capped and a reminder must not be.**
`MAX_COMPARISON_FINDINGS_PER_KIND` is two hundred per kind per firm per sweep, deliberately, because a
comparison is unbounded by nature and a runaway one must not starve the others. A firm with five
hundred overdue invoices would get two hundred findings and a counted clamp — which is honest for a
badge and wrong for a bill, because the three hundred nobody was told about are three hundred nobody
chased.

**Decision.**

**1. Every automation writes a durable billing record in the firm-scoped billing schema, and the
record carries the convergence.** `recurring_bill_run` is UNIQUE on `(schedule_id, period_key)`;
`invoice_reminder` is UNIQUE on `(invoice_id, reason, ordinal)`; `billing_batch_run_item` is UNIQUE on
`(run_id, matter_id)`. The record, its run row and its outbox message commit in **one**
`commitEffectBatch`, so there is never a decision without its record nor a topic for a record that
rolled back.

**2. Notifications subscribes as an ordinary `outbox-topic` type** and nothing in `sweep.ts` changes.
The shipped `<topic>:<outboxRowId>` dedupe key is stable across redeliveries by construction, and the
notification is free to age out on the firm's window because the billing record is what actually holds
the decision. This is the subsystem's own stated rule — the ledger entry, the invoice, the deadline are
the record, and sweeping a pointer destroys no evidence — applied to a case where the record did not
previously exist.

**3. The comparison-sweep path keeps its purpose intact.** It exists for subtractions against the clock
that the owning package deliberately refuses to store: the calendar will not keep an `overdue` column
and the custody register schedules nothing. Those conditions have no record and should not gain one.
These conditions **should**, because "which twelve matters did the run skip, and why" is a question a
firm asks months later about work the platform did on its behalf, and the answer cannot live in a
pointer.

**Considered and rejected.** **Keying the reminder's dedupe on a civil date** so it fits the comparison
path — that makes a step re-raise every day it stays true, which is a mail-bomb rather than a reminder.
**Excluding automation notifications from the retention sweep** — a per-kind retention exemption inside
Notifications, which makes a pointer into a record and breaks the one property that makes the window
defensible at all. **Raising the comparison cap for billing** — the cap protects the other kinds, and
raising it for one is how a runaway comparison eventually starves a custody review.

**Consequences.** Notifications gains four registry entries and no machinery. Billing gains three
append-only tables whose UNIQUE indexes are the convergence and whose reads are the deferred surfaces'
whole content. A reminder that was decided is answerable after its notification is gone, which is the
property a firm actually needs, and the test that proves it is a retention sweep followed by a pass that
raises nothing. Builds on **ADR-0059** (Notifications owns the delivery decision), **ADR-0064** (the
transactional outbox), and **ADR-0063** (idempotency).
