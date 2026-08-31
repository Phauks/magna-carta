---
category: Changed
audience: internal
---

**A firm using this platform cannot record a client's telephone number, and nothing in the schema
says so.** `directory_email`, `directory_phone` and `directory_address` have been in the per-firm
schema since the baseline migration. They are temporal, soft-deleted, indexed, carry an `is_primary`
flag whose enforcement the schema comments describe, and all three are registered for subject
erasure. Twenty-five directory routes, and not one touches any of them. The email table has a write
path built for inbound capture and reachable only from it; phone and address have no domain module
at all, so there is not one statement anywhere in the repository that inserts a telephone number or
an address for a person. The record screen lists seven panes and none of them is Contact.

The design pass that found it is at
[`docs/specs/2026-08-30-directory-entity-model-design.md`](../docs/specs/2026-08-30-directory-entity-model-design.md),
and its first conclusion is that the model is much deeper than the screen suggests, so this is a
completion rather than a rebuild. Names are already temporal, role-typed, phonetically coded and
match-keyed twice over; identifiers are already one sealed row per value with a per-type frozen
normalize transform and an explicit, reasoned blind-index policy. Neither is touched.

What the pass proposes, grounded in RFC 6350, FHIR R4, NIEM's `nc:PersonType`, schema.org, Popolo,
and the professional-conduct rules the data exists to serve: the contact tables reached by an API
and a pane before anything structural changes; a phone split into what technology answers it and in
what context, with a canonical E.164 form beside the number as entered and the extension in its own
column, because fax is a technology and work is a context and one free-text label cannot be both;
identifier types promoted from bare strings to registered scheme descriptors shipped as package
reference data, with the issuing jurisdiction moved out of the sealed value into its own column and
the frozen transform still seeing byte-identical input so no existing blind index is invalidated;
date of birth, date of death and a deceased flag moved onto the person, because a range query over
ciphertext is not a query and `IdentifierNotIndexableError` already exists as the symptom; an
organization given a kind, a jurisdiction of formation and a life, which the schema's own
`court_entity_id` and `estate_entity_id` have needed since they were written; provenance and a
verification status on every contact point and identifier, where `failed` — returned mail, a bounce,
a disconnected line — is the state with nowhere to live today and the one an affidavit of diligence
turns on; a no-contact warning derived per matter from who represents the party rather than stored as
a flag on a person, because Rule 4.2 is scoped to the matter and a stale warning teaches people to
dismiss warnings; and the edge catalog split so a constituent who can bind an organization is
distinguishable from one who cannot, since the conflicts traversal currently spends its control
budget on a mailroom clerk with the same weight it spends on a chief executive.

Nine decision fragments accompany it. Eight open questions are put to the owner rather than settled,
the largest being whether a date of birth sits in plaintext, in plaintext as a birth year beside the
retained sealed date, or unchanged.
