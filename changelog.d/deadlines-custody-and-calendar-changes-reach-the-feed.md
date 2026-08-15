---
category: Added
audience: internal
---

**Overdue deadlines, deadlines due today, custody reviews, overdue check-outs, calendar changes, and
finished document assemblies now reach a member's notification feed. The comparison-driven production
path is built, and the three calendar write paths that had no transactional announcement have one.**

The first delivery slice rested on the observation that the emission half was already built:
thirty-one topics commit a durable outbox row in the same atomic batch as the write they describe, so
the subsystem subscribes and owns nothing on the bus. This slice covers the things that were never
writes at all.

**A third production path, declared rather than inferred.** A notification type now says how it is
raised — `outbox-topic`, `comparison-sweep`, or `job-coordinator` — and each path gets its own index,
so a comparison kind can never be materialized twice by a translator that mistook its name for a
topic. All three paths share one materializer, one set of audience resolvers, and one set of
UNIQUE-insert statements.

**The per-firm comparison sweep** rides the daily cron over the same reachable-active-firm
enumeration every other per-firm sweep uses, quarantining one firm's failure exactly as the outbox
sweep does. It calls the calendar's own overdue arithmetic and the custody register's own
`collectCustodyReminders` rather than restating either — no second definition of what is due. The
dedupe key buckets by the civil date in the subject's own zone (the court's for a deadline), so a
condition that is continuously true raises once per day rather than once per pass; each kind is
capped at 200 findings with the clamp counted on a new `notifications.comparison_clamped` metric.
Four types registered: `deadlines.deadline.due`, `deadlines.deadline.overdue`, `custody.review.due`,
`custody.checkout.overdue`.

**Three calendar topics.** `calendar.event.scheduled`, `.rescheduled`, and `.cancelled` are written
in the batch the record / edit / cancel / continue effects were already composing, spelled once in
`packages/calendar/src/notifications.ts` so a producer and a subscriber cannot diverge. `rescheduled`
fires only when the setting actually moves — its dates, times, or zone — and never for a title or
room correction; a continuance raises exactly one `rescheduled` naming the new setting, because one
thing happened in the world. Payloads are two identifiers.

**A document assembly's terminal state** writes the durable row for the tab that was closed while it
ran, addressed to the member who asked. The socket push is unchanged. The dedupe key carries the
outcome, so a job the stuck-alarm failed and that then succeeded announces both rather than leaving
the timeout's row as the last word.

**What is deliberately not built.** `calendar.deadline.horizon` stays declared and unwired: it needs
a firm-configured lead window and no such setting exists, and a lead the platform picked is a lead the
firm did not choose. Four of the five job coordinators announce nothing durable — three record no
requester at all, and the bundle builder structurally cannot (it is single-flight across concurrent
identical requests, so one job has many requesters); the recovery coordinator's type is registered
and unwired pending a refactor of its five terminal transitions. Each gap has a written reason and a
fitness test where one is possible.

**A new fitness rule:** a matter-anchored type may not resolve to a single member unless it is on a
short list saying why. That is the failure that put three notification kinds in front of exactly one
reader once already, and the new comparison kinds are tested with an assertion that counts the
recipients rather than checking that somebody was told.

No user interface. The bell, the list, and the preference screens remain unbuilt.
