---
category: Fixed
audience: internal
---

A matter still spelled `prospective` stopped its firm's database from migrating, and took every read and write in the firm down with it.

The matter status rename widened `matter_status_check` to the new vocabulary — `intake`, `consultation`, `open`, `closed` — and copied `status` into the rebuilt table verbatim, on the reasoning that no firm held a matter yet and nothing could still carry the old spelling. A deployed firm held one. The replacement's CHECK rejected the row, the copy threw, and the migration rolled back — cleanly, and then again on the next request, forever.

The blast radius is the part worth recording. The per-firm lineage is applied in the FirmDatabase durable object's constructor, under `blockConcurrencyWhile`, ahead of any read or write it serves. A migration that cannot complete therefore does not degrade a screen; it makes the firm's whole database unreachable. The reported symptom was an unrelated `GET /api/v1/meta/versions` failing, because by then every firm-scoped route was failing.

The copy now maps `prospective` to `consultation` — the same rung under its new name — and leaves every other status alone. The correction had to go into the migration itself: the runner stops at the first failure, so no later migration is ever reached, and the durable object cannot be opened out of band to repair the row by hand. It is safe to correct in place because the applied ledger is keyed by tag with no content hash, so a database that already applied the migration skips it and never re-reads the file.

The regression test seeds the old vocabulary and runs the lineage over it, which is the case that was never covered: the chain always did apply to an empty database, and that is exactly why the fault reached production.
