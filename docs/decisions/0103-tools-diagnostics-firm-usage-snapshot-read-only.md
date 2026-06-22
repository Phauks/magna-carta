---
number: 103
slug: tools-diagnostics-firm-usage-snapshot-read-only
status: Accepted
date: 2026-06-17
area: Tools / Diagnostics
---

**Firm usage snapshot: a read-only, per-firm usage view assembled from our own D1.** **Decision:** storage (summed from the `storage_meter` rollup) + entity counts (matters by status, non-deleted files, clean versions, folders, locations), read per-firm from D1 with no API token; each domain package owns the read of its own tables (no cross-domain query). **Deferred seams:** per-firm compute/activity (Workers CPU time, request volume) needs the Cloudflare Analytics Engine query + an API-token credential — designed as a seam, not built; the aggregate `FirmUsageSnapshot` type + worker read route land with the consumer; the UI rides the design-system shell. Builds on ADR-0101 (the Tools layer), ADR-0078/0083 (storage metering + load-profile accretion), ADR-0003 (tenancy), ADR-0068 (access control). Spec: [`docs/specs/2026-06-17-firm-usage-diagnostics-design.md`](specs/2026-06-17-firm-usage-diagnostics-design.md).
