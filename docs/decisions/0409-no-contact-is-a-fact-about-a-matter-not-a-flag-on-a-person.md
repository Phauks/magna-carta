---
number: 409
slug: no-contact-is-a-fact-about-a-matter-not-a-flag-on-a-person
status: Proposed
date: 2026-08-30
area: Directory
summary: "Model Rule 4.2 forbids communicating about the subject of the representation with a person known to be represented by another lawyer in the matter — in the matter, which means a person represented on one matter may be contacted freely about an unrelated one, and an entity-level do-not-contact boolean states the rule wrongly. So the no-contact warning is derived, never stored: matter_party gains a nullable represented_by_entity_id naming counsel on this matter, and every surface that addresses a party reads it. Derived because a stored copy rots the moment counsel withdraws, and a stale warning trains people to ignore warnings. A separate small temporal table records the restrictions that are not Rule 4.2 at all — a client who asked not to be emailed, a protective order — scoped to a channel and attributed to whoever recorded it, because a firm has to be able to say who said so and when."
---

**No contact is a fact about a matter, not a flag on a person.**

**Context:** Model Rule 4.2 provides that "In representing a client, a lawyer shall not communicate
about the subject of the representation with a person the lawyer knows to be represented by another
lawyer in the matter, unless the lawyer has the consent of the other lawyer or is authorized to do so
by law or a court order." Comment [9] extends it to organizational constituents who supervise, direct
or consult with the organization's lawyer about the matter, who can obligate the organization, or
whose acts may be imputed to it, and to any former constituent who substantially participated in the
representation.

The words that decide the data model are **in the matter**. The duty is scoped to a representation,
not attached to a human being. A person represented in a contested probate may be contacted freely
about the unrelated conveyance the firm is handling for their employer. An entity-level
`do_not_contact` boolean would state the rule wrongly in both directions: too broad on the unrelated
matter, and silent about a party whose counsel appeared only yesterday.

Today the platform records nothing at all. There is no way to say that a party is represented, no way
to say by whom, and no warning anywhere.

**Decision:** two layers, and the first is derived.

`matter_party` gains a nullable `represented_by_entity_id` naming the counsel entity **on this
matter**. Where it is non-null, the platform derives _do not contact directly on this matter_ and
surfaces it wherever that party is addressed — the message composer, document assembly, a call list.
Derived and never stored, because a stored copy rots the moment counsel withdraws or substitutes, and
a warning that is sometimes wrong is a warning people learn to click past.

It is a column on the matter link rather than a directory edge because counsel of record is
matter-scoped. An entity-level edge saying "represented by" would assert it on every matter that party
appears in, including the ones where they are unrepresented.

A second, small temporal table records the restrictions that are **not** Rule 4.2 — a client who asked
not to be emailed, a protective order, a channel the subject has withdrawn consent for. It carries the
entity, the channel scope (all, email, phone, sms, postal), a reason, who recorded it, when, and a
validity period, because a firm defending a contact has to be able to say who said so and when.

**Considered and rejected:** a `do_not_contact` boolean on `directory_person` (states the rule wrongly
and cannot expire); storing the derived warning on the party row (rots on withdrawal, and a stale
no-contact banner is worse than none because it teaches people to dismiss banners); a directory edge
for counsel of record (asserts on every matter); making the platform _block_ a send to a represented
party (Rule 4.2 has consent and court-order exceptions and a lawyer may be authorized by law, so a
hard block would be wrong law enforced by software — it warns and names the rule, and a member decides).

**Consequences:** the platform can, for the first time, tell a member that the person they are about
to email is represented on this matter and by whom. Rule 4.2 comment [9]'s constituent limbs become
answerable, but only to the extent the edge catalog can distinguish a constituent who can bind the
organization from one who cannot — which is a separate decision and a precondition for this one being
useful against organizations.
