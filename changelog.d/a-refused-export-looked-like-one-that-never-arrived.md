---
category: Fixed
audience: public
---

An export could be downloaded successfully and never appear on the download shelf, with nothing
anywhere saying why. Two defects, and the second is the one that mattered.

**The register's schema requires a finite number on a two-faced cell, and rejects the WHOLE document
otherwise** — so a single unmeasured figure cost the member the entire shelf item. The same class of
defect the spreadsheet renderer already guards against in `cellPlan`, arriving one layer along:
`storedFromExport` now falls back to the printed text face when the number is not real, which loses
nothing a reader can see. `packages/export-document` gains a test pinning what the schema accepts,
and the client pins the fallback.

**The failure was silent by construction, which is why it went unnoticed.** `keepExportOnShelf`
swallowed every outcome so that a shelf failure could never cost a member the download they already
had. That reasoning holds — it still never throws and never blocks — but swallowing made a refused
document indistinguishable from one that simply never arrived, with no Error ID and nothing to act
on. It now returns the outcome, and the export menu reports a refusal with the server's own words
and its Error ID.

## Public

**Fixed: a report you downloaded could go missing from Downloads.** Certain reports were rejected
when the platform tried to keep a copy, and nothing told you it had happened — the download worked,
and the item simply never appeared. Those reports are kept correctly now, and in the rare case one
still cannot be, the page says so and gives you an Error ID to quote.
