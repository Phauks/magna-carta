---
category: Added
audience: public
---

**The time entry is served as a record, not a row.** The listing and detail reads carried eleven fields against a table that stores twice that, so the Time Sheet redesign had nothing to render where the design puts a rate, a code, an enterer or an invoice. `timeEntries.list` and `timeEntries.get` now serve the whole record through one shared read (`readTimeEntryRecord` / the listing queries in `@magna-carta/timekeeping`): the frozen rate snapshot (`rateE4`, `rateSource`, `rateCardId`), the UTBMS task and activity codes with their ids, codes and labels resolved, `source`, `invoiceId`, `createdAt` (the entered date, distinct from the work date), `createdByUserId` + `createdByName` (the enterer, resolved through the member mirror like the timekeeper's name, null where the member row is gone), `timekeeperName` on every read, and `attachmentCount`. Four new surfaces beside it, all per-firm-migrated (`20260901T130000_time-entry-record-surfaces`):

- **Internal memo** — a nullable `memo` column, settable on create and PATCH (null clears), served everywhere the entry is. It is the firm's own note and never client-facing; the audit trail records which fields an edit touched, never the text.
- **Entry number** — an immutable matter-scoped reference minted at capture through `@magna-carta/sequence-numbering` (counter per matter + allocation-key backstop): the matter's number, a dot, a zero-padded sequence (`2026-0147.0042`). Every capture path draws one (create, grid batch, timer stop-commit); existing entries stay honestly null. Served as `entryNumber` and echoed on the capture acks.
- **History** — `GET /api/v1/time-entries/{id}/events` serves the entry's recorded audit events oldest first (actor id + resolved name, redacted detail), the file-history shape; capture now records its source and an update the field names it touched, so the rail can say what happened.
- **Attachments** — a `time_entry_attachment` relation linking an entry to files already in its matter, with list/attach/detach routes. Attach refuses a file on another matter; detach removes the link and never the file; both acts are audited.

`POST /api/v1/time-entries/{id}/convert-to-cost` converts a mis-recorded charge: one idempotent act captures the cost (matter, narrative as description, the entry's amount, work date as incurred date) and voids the time entry so the value is never counted twice, with cross-referencing audit events on both records. It refuses an entry that is billed, void, claimed by a draft invoice, or carrying no amount, and requires `costs:track` on top of `time:track`. Convert-to-fee is deliberately not built: the fee work-in-progress store does not exist yet, and a fee route against invoice lines would bill a charge no one recorded.

## Public

**A time entry now shows everything the firm recorded about it.** The listing and the record window carry the resolved rate and where it came from, the billing codes with their names, who entered the entry and when (which delegated entry makes a different person and day from whose work it was), the invoice a billed entry rides, and the entry's own reference number.

**Every new entry gets a permanent number.** It is the matter's number plus the entry's place in that matter's sequence — `2026-0147.0042` — assigned when the entry is written down and never changed or reused; a voided entry keeps its number. Entries recorded before numbering existed show no number rather than an invented one.

**Entries carry an internal memo, files, and their own history.** The memo is for the firm alone — it never appears on a bill or anywhere a client can see, and the record of an edit never quotes it. Files already in the matter can be attached to an entry and removed again without touching the file itself. The entry's history lists what happened to it — entered, edited, approved, kicked back, voided, files attached — with who and when.

**An entry recorded in the wrong ledger can be converted to a cost.** One action creates the cost carrying the entry's description and amount and voids the time entry, so the charge exists exactly once; both records note each other. An entry already on a bill, already void, or without an amount refuses with the reason.
