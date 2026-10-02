---
number: 397
slug: a-contact-point-carries-a-permission-and-a-preference-and-they-are-two-facts
status: Accepted
date: 2026-08-30
area: Directory
summary: "The owner's direction is that the platform must be able to denote what methods a person CAN and SHOULD be contacted by. Those are two facts and one flag cannot hold both: a person is routinely reachable at a number they would rather nobody rang, and routinely asks to be reached by post while their email address stays perfectly usable. So every contact point carries contact_permitted, defaulting to yes, and contact_preferred, of which at most one exists per entity ACROSS email, phone and address together, because reach-me-by-post is a single answer about every channel at once. is_primary stays what it already was and is neither of them: the channel's default row, where a message goes when the sender named no address. Withdrawing a permission is offered where deleting the row would otherwise be used, because deleting loses the instruction along with the value and the next member types the number back in and rings it. None of this is Rule 4.2: a represented party may not be contacted about the subject of ONE matter, which stays matter-scoped and derived."
---

**A contact point carries a permission and a preference, and they are two facts.**

**Context:** the owner's direction on the contact work was that the platform should "be able to denote
what methods a person can or should be contacted". `directory_email`, `directory_phone` and
`directory_address` carried a value, a validity period and an `is_primary` flag, and nothing else. A
firm that was told "do not ring my mobile during the week" had one place to put it: delete the number.

CAN and SHOULD are not the same question and a single flag answers neither well.

- **CAN** is permission. It is the standing instruction the person gave, and its natural state is
  yes.
- **SHOULD** is preference. It is the route the person asked to be reached by, and it is a claim
  about every channel at once — "write to me" is an answer about the phone as much as the post.

A person can be permitted three numbers, prefer email, and still have one number that gets rung when
nobody names one. That last one is `is_primary`, which the tables already had and which is neither of
the other two.

**Decision:** all three contact tables gain `contact_permitted` (0/1, default 1), `contact_preferred`
(0/1, default 0) and `contact_note`. `is_primary` keeps its existing meaning as the CHANNEL's default
row and is untouched.

**At most one preferred contact point per entity, across all three tables.** Promoting one demotes
whichever held it, in whichever table it was in — three UPDATE statements in the same atomic batch,
because D1 has no interactive transaction to hold them open between and the fact genuinely spans three
tables. A per-table preferred flag would let a record claim the person prefers post AND prefers email,
which is not an answer.

**Withdrawing the permission is what the screen offers instead of deleting.** A number the firm was
told not to use is recorded with `contact_permitted` at 0 and the reason in `contact_note`. Deleting
the row loses the instruction along with the value, and the observable consequence is that the next
member re-enters the number from the same correspondence and rings it.

**None of this is Rule 4.2, and the model must not let it become that.** A represented party may not
be contacted about the subject of the representation IN THE MATTER. That is a fact about a matter, it
changes when counsel withdraws, and it is derived rather than stored — the reasoning is in the
no-contact decision beside this one. What lives here is the person's own standing preference, and it
applies everywhere.

**Considered and rejected:** one enumeration column with values like `preferred`/`permitted`/`do not
use` (it makes the two facts mutually exclusive, and "permitted but not preferred" is the ordinary
case); overloading `is_primary` as the preference (a person can prefer email and still have a default
number, and a send path that read one as the other would ring somebody who asked to be written to); a
per-table preferred flag (a record could then prefer two channels at once); a `do_not_contact` boolean
on the entity (it states Rule 4.2 wrongly and swallows the per-channel instruction that is actually
being given).

**Consequences:** a firm can record "write, do not ring" and every send path can read it. The cost is
that a write which promotes a preferred contact point touches three tables, and that the screen has to
present three related-but-different marks — preferred, default, do not use — without letting a reader
collapse them.
