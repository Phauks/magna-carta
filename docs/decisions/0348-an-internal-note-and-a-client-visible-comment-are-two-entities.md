---
number: 348
slug: an-internal-note-and-a-client-visible-comment-are-two-entities
status: Accepted
date: 2026-08-15
area: Notes and activity
summary: "An internal matter note and a client-visible portal comment are two tables with two identities, not one table with a visibility flag, and there is no path by which one becomes the other. A boolean would make publishing attorney work product to the opposing party's most interested reader a one-character diff, and an irreversible one — flipping it back does not unsend what the portal already rendered. Beyond that the two differ in kind: a note's author is a firm member while a comment's may be an external principal that the portal places in the control-plane database as a distinct principal type never mixed with staff access control; a portal grant's scope vocabulary is matter, folder and file, so a comment is reachable through a grant and a note is reachable through nothing, and that structural unreachability is the actual protection rather than a WHERE clause; and the two carry different retention and different discoverability postures. Sharing a note with a client is therefore a new comment authored by the member at the instant they authored it, never a state change on the note — a publication decision made in June must not alter a record made in January. Decided now because the portal is unbuilt and nothing depends on the answer yet, which is the cheapest this decision will ever be."
---

**One boolean is not a confidentiality boundary, so the internal note and the client-visible comment
are two objects and nothing converts between them.**

**Context:** the platform has no note primitive and no portal. Both are being designed against, and
the tempting shape is one `note` table with a `visible_to_client` column — one write path, one read
path, one surface, a flag. It is the shape most products in this category have, and it is the shape
that eventually leaks.

The client portal is entirely unbuilt: every node in its ledger area is `not-started` and
`PortalGrantId` is reserved with nothing behind it. That is precisely why this is decided now. Nothing
depends on the answer, so it costs nothing; every month it waits, something does.

**Decision:** `matter_note` is internal. A client-visible comment is `portal_comment`, specified by the
portal's own slice. Two entities, no shared table, no visibility column, and no promotion path.

**Five reasons, in descending order of how much they would hurt.**

**A one-character diff is a disclosure, and it is irreversible.** Flipping a boolean the wrong way
publishes attorney work product to the party most interested in reading it. Flipping it back does not
unsend it: the portal has rendered it and the client has read it. Nowhere else in this platform is a
single column value the entire barrier between privileged content and an external principal, and
there should not be a first place.

**The authors are different kinds of thing.** A note's author is a `member.user_id` in the per-firm
database. A comment's author may be an external principal, which the portal design places in the
**control-plane** database as a distinct principal type explicitly never mixed with staff access
control. One table would need a polymorphic author column plus a check constraint enforcing "internal
rows have member authors" — a constraint doing, badly, what two tables do for free.

**A grant has nothing to say about a row.** A portal grant's scope vocabulary is `matter | folder |
file`. A comment is reachable through a grant because it hangs off a thread that hangs off a scope. A
note is reachable through nothing, because no grant scope names it. That structural unreachability is
the protection. Merging the tables replaces a structural guarantee with a `WHERE` clause, and the
portal's least-privilege invariant does not rescue it — that invariant bounds a grant by the sharer's
own access, and the sharer can see the note.

**Retention and discoverability differ.** A comment is a communication with the client, the same class
of record as filed email, and a firm may have to produce it. A note is internal work product with the
opposite posture. One table would carry that as a second discriminated behaviour hanging off the same
flag.

**The product already separated them.** The matter section map has `notes` ("Matter notes and
memoranda — dated, attributed, and searchable") and `messaging` ("Secure messages exchanged with the
client through the portal") as two sections with two descriptions, and the portal ledger places its
comment capability as "threaded on the matter record." Nobody proposed one table; merging them would
regress against a decision already visible in the tree.

**There is no promotion path, and that is the load-bearing half.** "Share this with the client" is not
a state change on a note. It is a **new comment, authored by the member, at the instant they authored
it**, with its own identity in its own table. The note is untouched — because a note records what the
firm thought on the day it thought it, and a publication decision made in June must not alter a record
made in January. If the member wants the note's words, they type or paste them: a deliberate act by a
person, not a migration performed by a checkbox.

**Considered and rejected:** **one table with a visibility enum** rather than a boolean — three values
instead of two does not change that a write moves content across the boundary. **One table with an
append-only visibility history** — it makes the leak auditable, not preventable, and the auditable
version of an irreversible disclosure is still an irreversible disclosure. **A promotion operation
that copies the note into a comment automatically** — it is the boolean again with more steps, and it
back-dates a publication to the note's original instant. **Deferring the decision until the portal is
built** — the portal will be built under delivery pressure with a note table already in place, which
is the worst moment to be arguing about a column.

**Consequences:** the portal's slice inherits a decision instead of making one, and inherits the
harder half — it must build `portal_comment` rather than adding a column. Any product affordance that
makes copying convenient (a "copy to a client message" control that pre-fills a composer) stays a
product decision above this line, and is raised as an open owner flag rather than settled here,
because it is one usability step from feeling like the promotion path this decision refuses.
