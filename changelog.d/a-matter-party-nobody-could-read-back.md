---
category: Added
audience: internal
---

**A party could be put on a matter through the API and never read back.** Fifteen directory
endpoints, and the only matter-party operation among them was create. `readMatterParties` was not
missing: it is production code the conflicts checker calls on every run, exported from the package
and covered by tests, and no route mounted it. Whatever a client wrote, it could not ask for.

Two more holes came out of the same seam. Nothing anywhere set `matter_party.deleted_at`, and five
separate readers filter on that column, so a party linked by mistake was permanent and the only
remedy was a hand-written statement against the firm's database. And the shared row type omitted
`capacity` even though the link write has always stored it, so callers reading a party through the
package saw an absence that was not real.

The matter Parties section is built on the repaired seam. It lists who is on the matter with the
role, the directory name resolved in the same read rather than a query per row, and the capacity
where one was recorded, and it can sever a link with a confirmation that says what severing does.
Severing is a soft delete on purpose: a conflicts report that named a party has to stay reproducible,
so the row is retained and marked rather than removed. The sever publishes no bus message where the
link publishes one, because removing a party can only ever retract a conflicts hit, never create a
new one, and a retracted hit still showing is the safe direction to be wrong in.

Adding a party from the screen waits on the directory picker, so that action renders disabled with
the one line saying what it waits on. The route behind it has always worked.
