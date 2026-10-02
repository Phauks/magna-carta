---
number: 410
slug: firm-usage-is-quantitative-tables-computed-on-request
status: Accepted
date: 2026-08-31
area: Integrations
summary: "The Firm Usage screen is segmented tables of raw figures, computed when the page is opened and stored nowhere. The owner rejected the dashboard-tile treatment for this surface: no stat tiles, no percentage bars, no note columns — every fact is a labeled number in a table row, because the audience is the firm reading its own records, not a visitor being sold a summary. The one route composes per-domain reads (each domain owns the read of its own tables) and grew the rollups the tables need: matters by the firm's own type catalog, the file versioning breakdown with sizes, per-location matters and staffing, Directory and member counts, and the three AI meters that were metered but surfaced nowhere. Growth is by seams: a new meter lands as a new table row, custodian holdings are a reserved column, and per-firm compute stays a deferred credentialed read — each rendered honestly as absent rather than omitted or zeroed."
---

**A diagnostics surface for the firm's own administrator reports figures, not decoration, and a
figure that cannot be produced yet is named as absent rather than dropped or shown as zero.**

**Context:** ADR-0103 shipped `GET /api/v1/firm-usage` backend-only: storage by class and five entity
counts, awaiting a screen. The owner's direction for the screen (2026-08-31): information is
calculated when accessed; each matter type is its own row; files get their own table covering
versions, deletions, and sizes; folders are not interesting; the view sorts by location and reserves
seams for custodian data; people and organizations are reported; tables beat tiles; no percentage
bars; no explanatory captions or note columns — a quantitative view only, designed as seams for easy
growth and modularity.

**Decision:**

- **Computed on request, stored nowhere.** Every figure is a live read at the moment the page opens;
  there is no cache, snapshot, or refresh job. A page nobody opens costs nothing, and one that is
  opened cannot be stale. This keeps faith with the declined storage trend
  (a-per-firm-storage-trend-is-declined-not-deferred): history, if ever wanted, is a periodic
  snapshot row, never a byproduct of this surface.
- **One route, per-domain reads.** The response grew additively; each new block is a read owned by
  its domain package (`matters`, `file-manager`, `locations`, `directory`, `data-access`, `search`),
  composed in the one place they assemble. The three AI meters that were written but read by no
  route now surface here, which retires a recorded roadmap drift.
- **Tables only, raw figures only.** No stat tiles, charts, meters, captions, or note columns. Where
  a note carried data (request counts, query kinds), the datum became its own row.
- **Seams render as absence, honestly.** Custodian holdings are a reserved column reading "Not yet
  reported"; per-firm compute is a table under a Soon badge with the one line naming what it waits
  on (the Cloudflare Analytics API credential, per the ADR-0103 deferral); the managed search
  storage gap stays a named row reading "Not yet measured", never a zero.
- **System matters are excluded from the new rollups**, the same rule the caseload list applies; the
  original `counts` block keeps its shipped semantics untouched.
