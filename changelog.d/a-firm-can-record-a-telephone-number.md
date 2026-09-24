---
category: Added
audience: public
---

**The three contact tables are reachable.** `directory_email`, `directory_phone` and
`directory_address` had been in the per-firm schema since the baseline migration with nothing able to
write to them: phone and address had no domain module at all, and `contact-email.ts` was a write path
built for and reachable only from inbound mail capture. Twenty-five directory routes touched none of
the three, and `entity-sections.ts` listed seven panes, none of them Contact. A firm could not record a
client's telephone number.

This change adds `contact-phone.ts`, `contact-address.ts`, `contact-points.ts`, `contact-preference.ts`,
`phone-number.ts` and `postal-address.ts` to `packages/directory`, lifts `contact-email.ts` to a general
write path, mounts thirteen routes on `apps/api-worker/src/http/routes/directory/directory.ts`, and adds the Contact
and Dates panes to the record screen. One additive migration
(`20260830T120000_directory-contact-points.sql`) carries every column: the plan had been to reach the
tables first and add columns after, and that was reversed deliberately, because each of the owner's
rulings on this pass is a column the ENTRY SURFACE has to be able to take and building the pane twice
was the alternative.

The columns: `contact_permitted` / `contact_preferred` / `contact_note` on all three tables, with at
most one preferred contact point per entity ACROSS the three (three UPDATEs in the write batch, since
"write to me" is one answer about every channel and `is_primary` is a different fact — the channel's
default row); `contact_system` / `contact_use` / `country_calling_code` / `national_number` /
`extension` / `country_region_code` on phone, with `number` keeping its meaning as the number AS
ENTERED; the international address field set (`recipient`, `organization_name`, `street_two`,
`dependent_locality`, `sorting_code`) plus `address_use`, `address_type` and a `normalized_key` that is
a duplicate key and deliberately not a canonical postal form; the four verification columns on all
three; and `date_of_birth` / `date_of_death` / `deceased` on `directory_person`, in the clear and
registered for erasure. `structurePhoneNumber` implements the E.164 assignment rule rather than
carrying a metadata library, so a national-form number yields a null calling code rather than a guessed
one.

Eight of the design's open questions were answered by the owner and every section they touched was
rewritten in
[`docs/specs/2026-08-30-directory-entity-model-design.md`](../docs/specs/2026-08-30-directory-entity-model-design.md):
the date of birth is the full date in plaintext (the `birth_year` compromise is withdrawn), citizenship
is dropped, the organization taxonomy is deferred whole, a failed verification never gates a send, and
the point person on an organization is an edge type rather than a flag because the point person is
frequently not an employee. Three decision fragments are new — the permission-and-preference split, the
point-of-contact edge, and the address-provider recommendation — and four existing ones were amended to
what was built. `point_of_contact_for` is decided and NOT built: a new `EDGE_TYPES` value must be
classed in `packages/conflicts/src/edge-classes.ts` in the same change, which was outside this stream's
file ownership.

## Public

**A firm can record a client's telephone number.** It could not before. `directory_email`,
`directory_phone` and `directory_address` had been in the schema since the baseline migration with
nothing able to write to them — phone and address had no domain module at all, and email had one
reachable only from inbound mail capture — so a record screen listed seven panes and none of them was
Contact. That is what this change fixes, and the rest of it is the shape the owner asked the record to
hold.

**A record now has a Contact pane** carrying email addresses, telephone and fax numbers and postal
addresses, more than one of each, with one default per channel.

**A contact point says whether the firm may use it and whether it is preferred, and those are two
different facts.** A person is routinely reachable at a number they would rather nobody rang, and
routinely asks to be written to while their email address stays perfectly usable. So a number the firm
was told not to use is recorded with the permission withdrawn and the reason beside it, rather than
deleted — deleting the number loses the instruction along with the value, and the next member types it
back in from the same letter and rings it. At most one contact point per record is the preferred one,
across all three channels together, because "write to me" is one answer about every channel.

**A fax is a fax by what answers the number, not by a word in a label.** What technology answers a
number and what context it is used in are separate, so a work fax is expressible and a delivery path
asking "may this be faxed" gets an answer instead of a string. The number is stored exactly as it was
written and is never reformatted; the split into country calling code, national number and extension
sits beside it and goes empty where the number could not be split, so a number written in a way no
parser expects is still recorded and still shown.

**An address is an address anywhere.** Which fields a country uses, what a reader there calls them and
what order they read in all vary, so the fields are the international set — recipient, organization,
two address lines, district, town, region, postal code, sorting code, country — and none of them is
required. Nothing assumes a state and a five-digit postal code, and an address the firm holds only half
of is stored as the half it holds rather than refused into a free-text note.

**Returned mail has somewhere to live, and it warns rather than blocks.** A contact point records what
the firm found the last time it tried to use it, including the carrier's own words when a letter came
back. A failure is shown beside the address and never refuses a send: a bounce is frequently temporary,
and a platform that refuses on a stale failure teaches its users that its warnings are noise.

**A date of birth is a date again.** It had been filed with the sealed identifiers — the social
security numbers and the driver's licences — which match only by exact index; a date of birth is too
low-entropy to index safely, so the code deliberately refused, and a firm could store one and then ask
it nothing. Every question a firm actually has about a date of birth is a range: is this client a
minor, has a limitation period tolled, whose birthday falls this month. It is now an ordinary
attribute of the person and those questions are answerable. Date of death came with it, against the
decedent field that has been pointing at nowhere since it was written, with a separate flag for the
state probate work meets constantly — known to have died, date unknown. Values already sealed under the
old date-of-birth type stay readable; nothing new is written there.

**No third party sees an address.** The owner asked what a mapping or address-validation provider would
buy. The recommendation, with the measured options and costs, is recorded as a decision rather than
adopted: a client's address leaving the firm's tenancy is a privacy decision the owner makes
explicitly, so this change ships the seam a provider drops into and no provider.
