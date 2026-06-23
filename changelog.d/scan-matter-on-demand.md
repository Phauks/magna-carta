---
category: Added
---

**On-demand "scan this matter now"** (`POST /api/v1/scan/matter/{id}`): a member can proactively queue a background malware re-scan of a matter's files instead of waiting for each to be opened. Only **stale** files are queued — a current version already scanned under the firm's current engine is skipped in SQL, so a matter already up to date enqueues nothing; nothing is re-scanned when no current engine version is recorded. The scans run off the request path on the **bulk lane** (the same in-place re-scan branch the access trigger uses, cache-first). The per-request fan-out is capped (the owner runs 20k+-file matters); the response reports `{ enqueued, capped }`, and any file beyond the cap is still re-scanned on next access — nothing is silently skipped. Gated on `files:upload`; the request is audited (`matter.files_rescan_requested`, with the enqueued count).
