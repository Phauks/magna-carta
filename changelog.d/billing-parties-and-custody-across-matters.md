---
category: Added
audience: public
---

**Billing, parties and custody answer a search across matters.** The three sources declare an
`acrossMatters` reading of the `names` kind in `packages/matter-search/src/sources/all.ts`, each
over its own table: parties through the directory's names and then the party rows of the entities
named, with capacity in a second statement that leaves out what the first answered; billing through
one join of `invoice_line` to its invoice; custody over the packet table. Two places are still
searched inside a matter only, the words inside files and calendar. Measured with
`packages/matter-search/scripts/measure-across-matters.mts`; the invoice-line read has a recorded
ceiling and remedy in `docs/specs/2026-11-10-indexing-and-discovery-design.md`. No migration and no
contract change.

## Public

**The Search page finds invoices, parties and custody packets on every matter you can see.** Type a
name to see each matter that person or organization is a party on, a few words from an invoice line
or an invoice number to find the invoice, or a packet name or custody number to find the packet.
Each result names its matter and opens in that matter's own section, and you see only the places
your role includes.
