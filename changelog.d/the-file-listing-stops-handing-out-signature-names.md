---
category: Security
audience: internal
---

**A raw malware-signature name reached the file listing, untagged, on a route that is neither
permissioned nor audited — and reached cross-firm analytics on every quarantine.** Both now carry a
closed token instead.

`quarantineVersion` persists `scanDetail ?? reason`, and a malware quarantine passes the scan
engine's own signature as the detail, so `file_version.scan_detail` holds either a token the platform
authors (`size-mismatch`, `policy-type`, …) or engine-supplied free text — with nothing on the row to
say which. `FileSummary.quarantineReason` projected that column verbatim, so a client could not
render "this file type is not allowed" differently from `Win.Trojan.Foo-1234`, and the route it
arrived on (`files.list`) is `permission: null`, `audited: false`. The same string was a dimension on
the `ingest.verdict` telemetry event, whose own comment claimed structural redaction — true of every
slot except the one that existed.

`coarseScanReason` in `packages/file-manager/src/verdict.ts` now derives a **closed** `scanReason`
enum plus an `activeContent` boolean from that column, beside `scanDetailFor`, which is what writes
it. A platform-authored token passes through; `active-content` becomes the badge it always was rather
than a refusal reason; a composed withdrawal detail keeps its prefix and loses the engine's
enrichment; and anything else on a flagged or quarantined row collapses to one `scan-flagged`. Both
new fields are on `FileSummary` and `FileVersionItem`, and the `ingest.verdict` dimension takes the
coarse token. The raw name stays exactly where it is already audited: the download refusal and the
permissioned scan-diagnosis read.

Net exposure is down, not up. `quarantineReason` stays on the wire — narrowing a shipped field is
breaking, and `/v1` is additive-only — carrying a deprecation note pointing at `scanReason`; it goes
at the next API version, after which the listing carries no engine free text at all. Two reason
tokens the design did not anticipate were found in the tree and are in the vocabulary:
`content-drift` and `content-unverifiable`, written by the custody withdrawal when an
already-committed version's stored bytes stop matching their recorded hash.
