---
category: Added
---

Case calendar and matter timeline — design. A specification for the backend a calendar surface reads:
what happened on a case, what is coming, and where each of those facts lives.

The design's central call is **derived where the fact already lives, recorded where the fact is
born**. Most of what "transpired in the case" is already recorded — mail filed to the matter,
documents produced, assemblies run, originals moved in and out of the safe, money moved through
trust, time and costs booked, conflicts run, the matter opened and closed — across eleven per-firm
tables that each already carry a timestamp and, in most cases, an index built for exactly this filter
and sort. Those are read **in place** through a source registry rather than copied into a calendar
table: nothing is backfilled, nothing drifts, no privileged fact gets a second copy, and the timeline
cannot disagree with the custody register because it _is_ the custody register. Only the facts that
exist nowhere today — litigation events and deadlines — get tables of their own.

Litigation events are member-entered and first-class: a hearing, a filing, service, an order, a
deposition, with a type catalog a firm can extend, participants who may be a firm member, a Directory
entity, or someone external to both (a judge does not have to be added to the Directory to appear on
the record), a courtroom as free text, and a date that may be all-day, timed, or a range.

Deadlines are modelled separately, because a deadline can be satisfied and an event cannot: a due
date and optional time, who satisfied it and what filing discharged it, and a reason on the record
when one is vacated. A deadline past its date and still open reads as **overdue** — computed when it
is read, never written down. The platform reports what it can see; it never records that a firm
missed anything, because the deadline may have been extended, satisfied elsewhere, or vacated that
morning.

**The platform does not calculate deadlines, and the design says so as a position rather than a
to-do.** No business-day arithmetic, no court-holiday calendars, no "three days for mailing", no
cascade when a trigger date moves. Missed deadlines are the largest single source of malpractice
claims, and that argues for visibility rather than arithmetic: a computed deadline that is wrong is
worse than none, because it will be trusted precisely because it was computed. Where a verified
statutory catalog eventually exists, it **proposes** and a person **confirms**, with the catalog
entry and its version frozen onto the row so an amended statute surfaces as something to review
rather than as a date that moved while nobody was looking.

Hearings finally get real time zones. A date is stored as a calendar date and a time separately, so
an all-day filing is not an event at midnight, and the zone lives on the event rather than on the
office — a Nevada firm appearing in a California court has a hearing in California's zone, and
nothing about the firm says so. Offices gain a time-zone setting as part of this, which is also what
lets assembled documents stop rendering every date in a normalized zone.

Reads are bounded and keyset-paginated: one statement per source, all issued together, merged in
order, with a single cursor that works across all of them. Nothing is filtered after a page is cut,
and every read composes one visible-matter rule in the query itself — today it keeps the platform's
internal holding matter off a firm's calendar, and it is the single place a future confidentiality
screen attaches without touching a source.

Two specs, one decision record, and seven owner decisions. No product code, no user interface, and no
court integrations in this cycle.
