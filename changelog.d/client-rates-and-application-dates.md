---
category: Fixed
audience: public
---

**Client-tier rates now price time, and billing refuses an application dated before its bill.**
Every path that resolves a time entry's rate (capture, an edit that changes the rate inputs, the
timer's stop, and re-rating unbilled drafts) now passes the matter's client party, read by
`readMatterClientId` in `packages/timekeeping/src/rate-resolution.ts`; before this each passed no
client, so the client tier of a rate card was never reached. `composeInvoiceApplication` now takes
the bill's issue date and refuses an application dated before it
(`application-before-invoice-issued`) and a reversal dated before what it reverses
(`application-reversal-before-original`); write-offs, credit notes, client credits and transfers
from trust refuse the same before composing anything, so the as-of aging and the client statement
always agree.

## Public

**A rate set for a client on a rate card now applies to that client's time.** It sits between a
rate set on the matter and a rate set for the timekeeper. A payment, credit, write-off or transfer
from trust can no longer be dated before the bill it is set against was issued, and undoing one can
no longer be dated before the thing it undoes.
