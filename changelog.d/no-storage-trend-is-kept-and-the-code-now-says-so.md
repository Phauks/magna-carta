---
category: Removed
audience: internal
---

**The storage meter's Analytics Engine trend port is deleted, and the reason a trend is not kept
replaces it. It was not a binding away from working — as declared it wrote a raw data point indexed
by the firm id in clear, into the one dataset every other firm handle is HMAC-pseudonymized before
reaching, laying out its own blob columns beside the declared metric catalog that exists to be that
dataset's only door.**

`packages/file-manager/src/metering-statements.ts` carried a `MeterTelemetry` port and an
`emitMeterDataPoint` that nothing implemented and no caller ever passed an adapter to, under a comment
explaining that it was unfilled. Reading what it would have written is what settled it. `indexes:
[firmId]` puts a tenant identifier in the Analytics Engine index — the sampling and aggregation key,
the most durable field on the row — where `packages/telemetry/src/pseudonymize.ts` HMACs the same
handle under a pepper and drops the event entirely when the pepper is absent, because the dataset is a
cross-firm aggregate store the firm does not control and cannot have redacted afterwards. The blobs
were clean by luck rather than design: the prefix is the top-level R2 key segment and is always
`files` or `bulk`, the class and role are enum tokens. Beside that, blob one on that dataset is the
metric name by contract and every other writer goes through the metric catalog, which scrubs each
dimension and drops what it cannot place — a second writer with its own layout is the unguarded door
that catalog was built to close.

What the trend was for is real: the `storage_meter` rows are a current rollup and hold no history, so
nothing can answer how a firm's storage grew. Analytics Engine cannot answer it either — roughly
ninety days of retention, and cross-firm aggregate by policy — so the shape is named in the code
instead: a periodic snapshot row per firm in that firm's own database, read by the firm-usage surface
that already reports current totals. Nothing downstream loses anything, because nothing consumed it:
`readStorageUsage` and the `/api/v1/firm-usage` route read D1 and only D1, and the operational rate
signals that do belong in Analytics Engine (`storage.reconciliation.corrected`,
`storage.dimension.stamped`) already ride declared counters. The reconciliation pass's header, which
still claimed "the analytics trend seam consumes the corrected meter on its own path", is corrected.
