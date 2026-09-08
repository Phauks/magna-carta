---
category: Changed
audience: public
---

**The Directory's round of owner corrections — the index's columns, and the record panel.**

The index carries twelve columns instead of three. Beside the name and the kind sit the record's
default email address, its default number and the city of its default address; the parts a name was
assembled from (first, middle, last), an organization's legal name, the region and country, and when
the record last changed are declared and start hidden, offered from the header menu's Columns
submenu. The three contact facts are the DEFAULT row per channel — one email, one number, one place,
the row a message goes to when nobody named an address — read for the page in one query rather than
joined into the union the listing walks (`packages/directory/src/entity-listing.ts`). A sealed
identifier is not among them and will not be: reading one is a permission-gated, audited decrypt, and
a page of fifty rows cannot ask that. The filter popover above the table is gone; the Kind column's
own set filter was already doing its whole job, and the way back to the whole book is
`DataTable.ClearFilters` in the header row.

On the record panel: a person is recorded with a first name and nothing more required — a mononym is
an ordinary name, the domain already indexes one from the given name, and the missing last name is
stated as a warning above the commit rather than as a refusal. The name fields read First, Middle and
Last. The prefix and the suffixes moved off free-text inputs onto the product's own
combobox-with-add over the spellings a firm writes, and a person may hold as many suffixes as they
have. The Contact and Identifiers entry rows lost the box around them and are the last row of their
own list; the identifier row wraps instead of running off the right edge of the panel. A recorded
email, number or address can now be corrected in place instead of only deleted and retyped. The
postal address moved out of the Contact kind dropdown onto its own rail section, over a new
`AddressFields` design-system component whose field set, labels and order follow the country
(`packages/design-system/src/lib/components/address-fields/address-format.ts` is the per-country
table; adding a country is one entry). And both panels hold one height for the screen they open on,
so pressing a rail item no longer resizes the panel out from under the reader.

## Public

The Directory's list shows far more than a name and a date. Email, telephone and city sit beside
every record, and the header menu offers first, middle and last name, legal name, region, country and
when a record last changed — so the book can be sorted by surname, narrowed to one city, or scanned
for who the firm holds a number for, without opening a record at a time.

Recording somebody is easier to get right. A person with only one name can be recorded — their first
name is what the firm files and searches them under, and the screen says so rather than refusing.
Titles and post-nominals are picked from a list you can add to, and a person can carry more than one
suffix. An email address, telephone number or postal address that was entered wrongly can be
corrected in place instead of deleted and typed again. And an address is entered on its own section,
in the shape the country actually uses: an Irish address asks for a county and an Eircode, a German
one puts the postal code before the town, and neither is asked for a state.
