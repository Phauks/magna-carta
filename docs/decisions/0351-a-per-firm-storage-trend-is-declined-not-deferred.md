---
number: 351
slug: a-per-firm-storage-trend-is-declined-not-deferred
status: Proposed
date: 2026-08-15
area: Documents
summary: "The storage meter keeps no Analytics Engine trend, and the port declared for one is deleted rather than left standing. As shaped it could not have been implemented: it wrote a raw data point indexed by the firm id in clear, into the dataset every other firm handle is HMAC-pseudonymized before reaching, and it laid out its own blob columns beside the declared metric catalog that exists to be the only door into that dataset. The question behind it — how a firm's storage grows — is real and belongs in a periodic snapshot row in the firm's own database, where it is durable, firm-scoped, and readable by the surface that already reports current totals; Analytics Engine holds roughly ninety days and is a cross-firm aggregate store by policy, so it could not answer it even with the disclosure problem solved. A declared port nobody fills is worse than no port, because everything built on top of it assumes the data exists."
---

**A seam that could not have been filled as shaped is not a deferral, and leaving it declared invites
the next reader to build on data that will never be there.**

**Context:** `packages/file-manager/src/metering-statements.ts` carried a `MeterTelemetry` port — one
Analytics Engine data point per meter bucket, `indexes: [firmId]`, the storage class, artifact role and
key prefix in blobs, bytes and object count in doubles. It came from the File Manager's own design,
which asked for "AE data points (index = firm; class/role/prefix in blobs) for dashboards and trends".
Nothing ever implemented it, no caller ever passed an adapter, and the comment above it had been
updated to say so.

The design line predates the platform's telemetry posture, which has since become specific in three
ways the port contradicts:

- **A firm identifier does not reach that dataset in clear.** Where a firm handle travels to Analytics
  Engine at all it is HMAC-pseudonymized under a pepper first, and the event is dropped outright when
  the pepper is absent — fail-closed, because the dataset is a store the firm does not control and
  cannot have redacted after the fact. `indexes: [firmId]` inverts that in one line, and an Analytics
  Engine index is the sampling and aggregation key, so it is the most durable field to put it in.
- **The dataset has one door.** Every write goes through the declared metric catalog, which fixes blob
  one as the metric name, lays the rest out from the metric's declared dimension order, scrubs each
  value against a tripwire, and drops what it cannot place. That catalog exists precisely because an
  unguarded `writeDataPoint` was "the cheapest way to get privileged content into Analytics Engine,
  and the one no test would have caught". A second writer laying out its own blobs re-opens it.
- **Retention is short.** A capacity or billing history outlives Analytics Engine's window, so it is
  the wrong store for the question even with the two problems above solved.

The blobs themselves were, as it happens, clean — the prefix is the top-level R2 key segment and is
always `files` or `bulk`, and the class and role are enum tokens. The disclosure was the index, which
is the field that would have been hardest to notice and impossible to withdraw.

**Decision:** Delete the port and record in its place why no trend is kept. The D1 rollup stays the
authoritative and only reader; the R2 reconciliation pass corrects it; the operational rate signals
that genuinely belong in Analytics Engine (`storage.reconciliation.corrected`,
`storage.dimension.stamped`) already ride declared counters and are untouched.

**Consequences:** No storage trend exists, and the code now says that outright instead of implying one
is a binding away. If a firm's storage history is wanted, the shape is named: a periodic snapshot row
per firm in that firm's own database, read by the firm-usage surface that already reports current
totals — durable past ninety days, firm-scoped by construction, and behind the same access check as
the numbers beside it. The File Manager design's Analytics Engine line is superseded by this.
