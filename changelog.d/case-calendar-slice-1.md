---
category: Added
---

The case calendar and matter timeline — the backend a firm's calendar reads. Two questions that sound
like one and are not: what has happened in the litigation, and what the firm must do next.

**What is recorded here.** Litigation events (hearings, filings, service, orders, depositions,
mediations, trials, client meetings) and deadlines, neither of which the platform had any way to hold
before. An event carries a **civil date** and a separate optional wall-clock time — because "all day"
is what a filing is, and storing midnight-local-as-UTC is the daylight-saving off-by-one that moves a
hearing by a day when the clocks change. Its **time zone is required and lives on the row**: a Nevada
firm appearing in a California court has a hearing in Los Angeles, and no property of the firm, the
matter, or the office says so. Participants can be a firm member, a Directory entity, or somebody
external to both, so nobody is forced to create a Directory record for a judge in order to name one. A
continued hearing is the **same hearing on a new date** — one row, edited, with the move on the audit
trail, rather than two hearings on the calendar and a question about which one counts.

**The timeline is federated, and nothing is projected, copied, or backfilled.** Everything the firm
already recorded about a case — documents filed, mail captured, documents assembled, originals moved
in and out of the safe, client money through trust, time and costs booked, conflicts checks run, and
the matter's own opening and closing — is read **in place** through a registry of thirteen declared
sources, merged under one comparable ISO-8601 sort key and the platform's existing cursor. A source
is a read-side declaration: a statement builder, a projection, and a decision about whether it has a
non-privileged label. It is never a write-side obligation on the subsystem that owns the rows. The
property that buys is the one worth having — a federated timeline **cannot disagree** with the
register it is built from, because it is that register; the bug where the calendar says one thing and
the custody ledger says another cannot be written. It also means a custody movement back-dated to
Friday and typed on Monday sorts on **Friday**, which a projection over write-time timestamps would
have got wrong for every physical-world event in the system.

**The platform does not calculate deadlines, and that is a position rather than a gap.** No
business-day arithmetic, no court-holiday calendar, no service-method offsets, no cascade when a
trigger date moves, no default deadline when a matter opens. Missed deadlines are the largest single
source of malpractice claims, and that cuts toward visibility and against arithmetic: a computed
deadline that is wrong is worse than none, because it is trusted precisely because it was computed and
the firm that would have looked the rule up does not. A deadline records the date a person supplied,
the authority **they** state, who recorded it, and — where there is one — a link to the event that
started the clock, which is a record and never an input to a calculation. The columns a verified,
jurisdiction-keyed catalog would one day write through a propose-and-confirm path are reserved and
refused until such a catalog exists.

**Overdue is derived and never written.** A deadline still open past its due instant — resolved in its
own zone — is reported overdue every time a page is read. There is no column, no sweep, and no state
transition, because a platform that writes "missed" onto a firm's record has asserted something about
that firm's conduct it is not in a position to assert: the deadline may have been extended by a
stipulation nobody has typed in, met under another matter, or vacated by an order that arrived this
morning.

**Every source composes the visible-matter predicate into SQL before its `LIMIT`**, as a required
argument rather than an optional one, so a source that forgets is a type error before it is a test
failure — and post-filtering, which under-fills a page and turns the page size into an existence
oracle, is structurally impossible. Today the predicate excludes the platform-owned custody holding
matter, which is a genuine filter doing genuine work; when an information-barrier overlay is built it
is one more clause in that one predicate and every registered source inherits it untouched.

Four per-firm tables, one `location.time_zone` column (which finally makes `timeZoneForLocation` in
document assembly return the office's real zone instead of UTC), two composite indexes on shipped
tables, two permissions, and seventeen routes.
