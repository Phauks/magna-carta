---
category: Added
---

Notifications, the delivery half — slice 1: the record, the registry, the subscriber, and a member's
own read API. The thing worth saying first is what did **not** have to be built.

**The emission half was already there, and nobody had said so.** An inventory found forty-four places
in the platform that already decide something notification-worthy happened, and thirty-one of them
already write a durable row **in the same atomic batch as the change it describes** — the
transactional outbox, shipped, swept every five minutes, published onto a per-firm queue that already
resolves the firm's database and dispatches by topic. So this subsystem does not own a topic and does
not ask a single producing package to change: it **subscribes**, as a second non-exclusive pass in
the existing dispatcher. A topic may have both a business consumer and a notification and neither can
suppress the other; an unrecognized topic stays acked and ignored, because the bus is open by design;
and a translator failure is caught and counted where an owning handler's still propagates — a missed
notification is an annoyance and a re-driven cost posting is a double charge, so the weaker one
yields. Nine kinds are registered to start: trust postings, invoices finalized and voided, files
quarantined and re-scanned infected, check-in conflicts, matters closed and reopened, and filed
incidents.

**A notification row carries no string a person typed.** Not the matter title, not the client name,
not the filename, not the email subject line, not a free-text note. What it holds is identifiers,
counts, closed labels, and dates, and a validated grammar makes that structural rather than a review
note: a type that declares a text field cannot be written. What the reader sees — "a matter you are
responsible for was closed — 8181-3" — is assembled **at read time** from the kind plus the matter
number, resolved by the same join that enforces visibility. Three reasons, in the order they bind:
the row outlives the access check that justified it, and a row holding a title still holds it after
the reader stops being entitled to it; a stored title is a stale title, wrong invisibly because the
row still looks authoritative; and resolving at read costs nothing, because the read was already
joining the matter.

**Visibility binds when a notification is READ, not when it is raised.** Access changes after the
fact: a member taken off a matter on Tuesday must stop seeing Monday's notifications about it on
Tuesday, and one added should see what is still live. Enforcing at emission gives neither — it gives
a recipient list frozen at the moment of the event plus a revocation sweep that has to be perfect
forever. So the feed page, the unread count, and (when the digest lands) the digest all compose one
predicate in SQL **before the page is cut**, through one shared function, so "the digest respects the
wall" will describe one implementation rather than two that can drift. Nothing is ever deleted or
rewritten because access changed; rows are filtered, and reappear if access returns. A filtered row
leaves no placeholder and no gap in the count — "one item you cannot see" is an existence oracle.

**Retention is the firm's to set, between thirty days and a year, defaulting to ninety, swept
nightly.** A notification is a pointer and never a record — the ledger entry, the invoice, the
deadline, and the audit-log row beside each of them are the record and keep their own retention — so
sweeping one destroys no evidence. That is what makes a platform default defensible here where the
custody register refuses one outright. But **the sweep does not quietly drop what nobody had read
yet.** It tallies, per member, how much aged out unread and how far back it reaches, and the unread
count reports that beside the live count, so somebody back from three weeks' leave is told there is a
gap rather than shown a zero. Clearing it is the same act as marking the feed read.

**Five reads and writes, all of them the member's own.** One page of the feed (cursor-paginated, with
category and state filters, and an unknown category refused rather than quietly ignored), the unread
count, marking one item read or dismissed, and a "mark everything I have seen" that is **bounded by a
cursor from a page the caller actually rendered** — so it cannot silently clear what arrived while
they were looking, and cannot become an unbounded update over a member's whole history. Every one is
scoped to the session's own user and never to a value in the URL, so one member can never reach
another's feed by handing over a handle; a row that is not theirs is _not found_, never _forbidden_.
The capability, `notifications:read`, is seeded to every default role including Read-only: reading
your own feed is not a privilege, and a firm whose staff cannot see their own deadlines is a firm
this feature has failed.

Also shipped: the email content setting as a **member's choice under a firm's ceiling** — the firm
caps how much a mailed summary may say and a member may only choose something _more_ private, never
less — with per-category counts as the platform default. Email sending itself is a later sub-slice;
the setting shape lands now because a firm's stored choice must not be silently rewritten when it
does.

No user interface: the notification centre and the preference screens stay the stubs they are, and
their user guide is written when they ship. Web push, SMS, desktop-native presentation, external
calendar feeds, outbound webhooks, per-kind preference grain, and a per-matter team audience remain
named seams with nothing built.
