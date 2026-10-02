---
number: 358
slug: a-comparison-is-a-third-production-path-and-the-registry-says-so
status: Proposed
date: 2026-08-15
area: Notifications
summary: "A notification type declares which production path raises it — `outbox-topic`, `comparison-sweep`, or `job-coordinator` — rather than the registry inferring it from the emission point's name, and each path gets its own index so a type can only ever be materialized by the raiser that owns it. The comparison path is a per-firm pass on the daily cron that calls the calendar's shipped overdue arithmetic and the custody register's own `collectCustodyReminders` rather than restating either, buckets its dedupe key by the civil date in the SUBJECT's zone (the court's for a deadline, the platform's for a register with no zone), caps each kind at 200 findings with the clamp counted, and reports per emission point on the same telemetry metrics the queue-driven path already uses. `calendar.deadline.horizon` is deliberately left unwired because no firm setting names a lead window, and a lead the platform picked for a firm is a lead the firm did not choose."
---

**A subscription and a comparison are not the same thing wearing two hats, and a registry that cannot
tell them apart will eventually materialize one of them twice.**

**Context:** The delivery subsystem's first slice rested on a single, true observation: the emission
half is already built, thirty-one topics already commit a durable outbox row in the same atomic batch
as the write they describe, so notifications subscribes and owns nothing on the bus. Every registry
field was shaped by that — `subscribesTo` names a topic, the topic index resolves a bus message to
its types, and the translator is the one materializer.

Some of the things a firm most needs telling about were never writes. Nothing writes "this deadline
is overdue": the calendar refuses to keep it as a column, because a stored flag needs machinery to
maintain a fact that is a subtraction, can be stale where a comparison cannot, and would have the
platform assert something about a firm's conduct it is not in a position to assert. Nothing in the
custody register schedules anything either, by the same deliberate design. Those are queries, and
both are already written and already read by the reports each subsystem ships.

A job coordinator is a third shape again. Its state lives in Durable Object storage, so there is no
firm-database batch for an outbox row to ride at all.

**Decision:** `NotificationType` gains `raisedBy: "outbox-topic" | "comparison-sweep" |
"job-coordinator"`, and the registry builds one index per path. `notificationTypesForTopic` sees only
subscriptions. A comparison kind whose emission-point name happened to collide with a live topic
cannot be picked up by the translator, and a topic kind cannot be picked up by the sweep — which
matters because the calendar's declared emission points and the platform's outbox topics are drawn
from the same vocabulary and three of them are now both. A fitness test asserts that every type is
indexed under exactly one path.

Everything downstream of the registry is shared rather than duplicated. All three raisers build a
payload, resolve recipients through the same audience resolvers, and go through the same pure
materializer and the same UNIQUE-insert statements, so a path cannot grow its own idea of what a
notification row is.

**Four rules bind the comparison path.**

**It calls the shipped comparison and never restates it.** `overdueCutoffFor` and
`selectMatterDeadlinesStatement` for the deadlines, `collectCustodyReminders` for the register. Two
definitions of what is due would eventually disagree, and the one people acted on would be whichever
they happened to be looking at.

**The dedupe bucket is a civil date in the SUBJECT's zone.** `overdue` is true continuously, so a key
built from the finding alone raises a row every pass, forever. A deadline's bucket is its court's
civil date, because that is the calendar the deadline lives in; the custody register keeps no zone at
all — it is one firm's own list of civil dates the firm typed — so its bucket is the platform's civil
day, and the asymmetry is stated rather than smoothed over.

**A comparison is unbounded, so the read is capped per kind and the clamp is counted.** "Every open
deadline past its due instant" is a number a firm's own working habits choose; a register nobody has
looked at in two years answers in the thousands. Two hundred per kind, per kind rather than per sweep
so one runaway comparison cannot starve the others, and a new counter — `notifications.comparison_clamped`
— because a firm silently told about two hundred of its four hundred overdue matters is worse than
one told about none.

**It reports on the metrics the queue path already uses, per emission point.** A materialized
notification is the same fact however it was raised, and two parallel metric families would mean
every dashboard asking the question twice. Per emission point rather than per firm, because a kind
that silently stops producing looks exactly like a kind nobody registered.

**Cadence: the daily cron pass, and the bucket is what makes that a free choice.** Because the key
buckets by civil day, the pass produces exactly one row per subject per day however often it runs —
so re-running is safe, and moving it later costs no correctness. Given that, daily is the honest
default: the five-minute pass would perform 288 firm-wide deadline reads to produce the same single
row. What the cadence genuinely decides is _when in a member's day_ the row appears, and one daily
pass at 03:00 UTC lands in the evening for the western zones. A second daily pass is the fix if that
matters, and it costs a cron expression and no code.

**`calendar.deadline.horizon` is declared and left unwired.** "An open deadline enters the firm's
configured lead window" needs a firm-configured lead window, and no such setting exists. The
retention window's precedent would make one cheap — a bounded firm setting with an in-code default —
but the default value is the whole question, and a lead the platform picked is a lead the firm did
not choose. It stays declared and raises nothing, and a fitness test asserts the emission point
resolves to no type so the gap cannot be mistaken for an oversight.

**Considered and rejected:** **Inferring the path from the emission point's name** — a prefix
convention that holds until the day a topic and a comparison share one, which is already true for
three calendar names. **A second materializer for the sweep** — the fastest way to two subtly
different notion of what a notification row is. **Storing "overdue" as a column so the sweep becomes
a subscription** — the calendar's own position, and it is right for reasons that have nothing to do
with notifications. **Running the sweep on the five-minute pass** so a row appears within minutes of a
zone's midnight — 288x the reads for a row nobody is watching for at 00:05 local. **Charging the
custody clamp to both custody points** — the register caps both reasons in one read and returns one
merged list, so attributing a clamp to a reason would mean asking it a second question; it is charged
to the review point, which is the ceiling both reads share.

**Consequences:** Deadlines and custody reminders reach the feed, on the same rows and through the
same wall as everything else. The registry now states its production path, which makes "how is this
raised" a declared fact rather than something read out of the raiser. The horizon comparison remains
unbuilt and named, waiting on one number from the owner.
