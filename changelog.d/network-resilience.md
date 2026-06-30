---
category: Added
---

**Network-resilience standard.** A forward-binding convention for behaving well on slow, metered,
high-latency, and intermittent connections — resumable transfer through the established R2 seam
(multipart-resumable upload, presigned-GET download, HTTP Range serving) over any monolithic in-app
fetch, no hardcoded timeouts that cache-bust a transfer still making progress, last-known-value
rendering with honest transfer status, and a per-route cold-load transfer budget. The backend transfer
paths already realise the resumable seam, so the standard codifies the reference and names the forward
seams (a shared client transport chokepoint, a load-profile transfer-weight measurement, the budget
fitness function) rather than retrofitting shipped code.
