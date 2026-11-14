---
category: Changed
audience: public
---

**A create panel holds its record's draft number, and gives it back on cancel.** The new `number_reservation` table and `@magna-carta/sequence-numbering/reservation` (`holdNumber`, `releaseNumber`) hold a value per panel for fifteen minutes, renewed by the panel; `planSchemeDraw` takes the caller's hold first, then the lowest given-back value in the scope, then the counter, so a held run keeps no gap. `POST` and `DELETE /api/v1/number-reservations` are the HTTP edge, and the matter, conflicts check, custody packet and call or text creates take a `numberReservation` token. The design system's `PreviewedNumber` became `DraftNumber`, with a `draft` standing rendered in italics, and the standing "A number is drawn when this is saved." sentence is gone. The invoice and time entry runs stay `previewed` (register `draftNumber`), so invoices are still numbered at finalize, gapless and in issue order. `conflicts.nextCheckNumber` is retired.

## Public

**A record being created shows the number it will be saved under, and cancelling gives it back.** The New Matter, New Check and New Packet windows and the call and text log now show the record's number in italics before it is saved, in place of the sentence "A number is drawn when this is saved." Two people creating the same kind of record at once are shown different numbers, and the record is saved under exactly the number shown. Closing the window without saving gives the number back for the next record, so the numbering keeps no gap; a window left open and abandoned gives its number back after fifteen minutes. Invoice numbers are still given only when a bill is finalized, so they stay gapless and in issue order.
