---
category: Added
audience: public
---

**The Search page has a filter panel.** Beside the results: Places (ticked boxes, each counted), Matters (every matter, my matters, one client's, or matters picked one by one, up to 25), Date (any time, last 30 days, this year, or between two days) and By (one member). Results come back as one list, newest first, each labelled with its place. `GET /api/v1/search` takes `matterId` (repeatable), `from`, `to` and `by`; days and a person are held in the statement against the date and the author each place records, before the limit, and a place that records no author answers `no-author`. On a phone the panel opens from a Filters button.

## Public

**Filter your searches.** The Search page now has filters beside the results: pick which places to look in, which matters (including just the ones you pick), a date range, and who wrote it. Results show as one list, newest first.
