---
worktree: /home/user/magna-carta
area: The Directory — the index's columns, and the record panel's name, contact, address and identifier entry
status: building
touches: apps/web/src/lib/directory, apps/web/src/routes/(app)/directory, apps/api-worker/src/routes/directory.ts, packages/directory/src/entity-listing.ts, packages/design-system/src/lib/components/address-fields, docs/conventions/design-corrections.md
---

The owner's directory round: the index carries more columns (the name parts, the record's default
email, number and place, and when it changed) and loses the filter popover that duplicated the Kind
column; the record panel records a person with no last name, offers the prefix and the suffixes
through the product's own dropdown-with-add, and holds one height whichever rail section is chosen.
Contact and Identifiers lose the box around their entry rows, a recorded contact point can be
corrected rather than only deleted, and the postal address moves to its own section over a new
design-system `AddressFields` whose shape follows the country.

Anything touching `packages/design-system/src/lib/components/address-fields/`, the directory's
sections under `apps/web/src/lib/directory/`, or the directory route's listing contract should wait
on this stream or coordinate.
