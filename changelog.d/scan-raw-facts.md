---
category: Changed
---

**Malware scanner reports raw facts; the file verdict is decided in the application.** The scan
Container no longer combines its engines into a single verdict — it returns a `RawScanResult` (clamd
state, structural heuristic, the YARA matches each tagged with `{tier, score, isSuspicious}`, and
per-leg timings), and the application turns those facts into a `clean | flagged | unscanned` verdict
via `computeVerdict`. The full YARA corpus is baked and scanned once, so a later slice can re-tier a
firm's policy with no re-scan. The four prior quarantine verdicts (`infected` / `suspicious`) collapse
to one `scan-flagged` state. The per-firm content-dedup `scan_cache` now stores the raw result and is
keyed on the engine version derived from that same result, so a clean ingest commit repopulates the
cache and the scan-once dedup is reused by the access-triggered re-scan path. A deployed engine that
goes dark returns `clam: unavailable` with HTTP 200 and is raised to a retryable fault in the
application (never a fabricated clean); the only Container 503 is an in-process engine panic.
