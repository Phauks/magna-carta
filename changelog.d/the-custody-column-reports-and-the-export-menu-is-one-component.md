---
category: Added
audience: public
---

The Firm Usage By Location table's Custodian Items column now reports: a bounded recursive walk in
`@magna-carta/custodian` (`selectCustodyItemCountsByFirmLocationStatement`, covered by the
schema-name-sync fitness test) rolls held items up to the office their container-tree root binds
to, with external roots collected on a Held Offsite row and checked-out items counted nowhere. The
export seam gains `$lib/export/export-menu.svelte`, the one Download menu every exporting surface
uses (a format is one added entry), and the pending export decision now carries the .xlsx library
evaluation: exceljs rejected on unfixed advisories and inactivity, write-excel-file recommended.
Also fixed on this branch: the test pool deadlocked on the new lazy entrypoint's request-time
dynamic import, hanging every SELF.fetch test — the worker test setup now warms the module cache.

## Public

**Firm Usage now counts what Custodian holds, office by office.** The By Location table shows how
many original items the firm keeps in safekeeping at each office, with anything stored at an
external site, such as a bank vault, on its own Held Offsite row. An item that is checked out
counts nowhere, because the shelf really is empty. The downloaded report carries the same figures.
