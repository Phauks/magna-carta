---
slug: a-table-nothing-can-reach-is-not-a-feature-that-exists
status: Accepted — built
area: Directory
date: 2026-08-30
summary: "directory_email, directory_phone and directory_address have existed since the baseline migration, are registered for subject erasure, and are named in the schema with careful comments about temporality and primary enforcement. None of the twenty-five directory routes touches any of them. The email table has a write path built for inbound capture and reachable only from it; phone and address have no domain module at all, so not one statement anywhere in the repository inserts a telephone number or an address for a person. A firm therefore cannot record a client's phone number. Reaching the three tables is a phase of its own, ahead of every structural improvement and depending on none of them, because the structural work is worth nothing while the capability is zero. The three tables stay three: a postal address has seven components and a telecommunication endpoint has one, a polymorphic contact-point table would put six always-null columns on every phone row, and it would break the normalized-address index inbound email capture depends on."
---

**A table nothing can reach is not a feature that exists.**

**Context:** `directory_email`, `directory_phone` and `directory_address` have been in the per-firm
schema since the baseline migration. They are temporal, soft-deleted, indexed on `entity_id`, carry an
`is_primary` flag the schema comments say the write path enforces, and all three are registered in the
erasure registry as hard-delete on subject erasure. They look, in the schema file, like a finished
subsystem.

`apps/api-worker/src/routes/directory/directory.ts` mounts twenty-five route definitions and **not one of them
touches email, phone, fax or address.** `directory_email` has a complete write path in
`contact-email.ts` — insert with a normalized match key, update, soft delete, primary demotion — built
for inbound email capture and reachable only from it. `directory_phone` and `directory_address` have
no domain module whatsoever; there is not one statement in the repository that inserts a telephone
number or an address for a person. The record screen lists seven panes and none of them is Contact.

So a firm using this platform cannot record a client's telephone number. That is the state of the
system, and it is not visible from the schema, which is why it survived this long.

**Decision:** reaching the three tables is a phase of its own that ships **first**, ahead of every
structural improvement in the surrounding design and depending on none of them. Domain modules for
phone and address mirroring `contact-email.ts`; the email module lifted from capture-only to a general
write path; routes for emails, phones and addresses under the entity, plus one contact-points read
returning all three so a record screen makes a single round trip; a Contact pane.

**One thing changed between this decision and the build, and it is worth stating.** The plan was to
reach the tables with **no schema change at all** and let the typed columns follow. That was reversed
deliberately: the owner's rulings on the same pass — a contact point carries a permission and a
preference, a failed verification notifies, a phone number is structured rather than one text column,
an address is the international field set — are each a column, and every one of them is a fact the
ENTRY SURFACE has to be able to take. Reaching the tables first and then adding the columns would have
meant building the Contact pane twice: once against a value-and-a-label, and once against the shape it
actually has to hold. So the columns landed in the same change as the modules and the routes, and the
pane was built once, against the shape it keeps. The decision's own consequence section anticipated
this cost and it was avoided rather than paid.

**The three tables stay three.** A postal address has seven components and a telecommunication endpoint
has one, so a polymorphic `directory_contact_point` would put six permanently null columns on every
phone row. It would also break `directory_email_normalized_address_index`, which the inbound-capture
reverse lookup and `readMatterPartiesForEmailAddresses` both depend on to resolve a correspondent to a
matter in one statement. FHIR keeps `Address` separate from `ContactPoint` for the same reason.

**Considered and rejected:** one polymorphic contact-point table; deferring the routes until the
structural columns land (it holds a shipped capability hostage to a design discussion); exposing the
inbound-capture email path directly as the general write path (it validates permissively on purpose,
because it captures addresses off real correspondence, and a person typing their own address should be
told when it is malformed).

**Consequences:** a firm can record and read a person's email addresses, telephone and fax numbers and
postal addresses, with more than one of each, one default per channel, a permission and a preference
on each, and a record of what happened the last time the firm tried to use one. The reverse lookup
gains a much larger corpus, so inbound email capture proposes matters correctly far more often — a
second-order benefit that arrives free.
