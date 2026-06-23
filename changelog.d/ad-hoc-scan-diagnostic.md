---
category: Added
---

**Ad-hoc malware-scan diagnostic** (`POST /api/v1/scan/diagnose`): a firm member can stream a file's bytes straight through the scan engine and get back a verdict — `clean` / `infected` / `unscanned` / `suspicious`, plus the signature, reason, or active-content flag — **without** uploading it to a matter or storing anything. The body streams unbuffered to the engine; the inspectable-size cap is enforced from `Content-Length` before the scan runs. Gated on a new firm-level capability `firm:scanFile` (seeded to every default role in per-firm migration `0017`, mirroring `firm:reportIncident`); because the scan stores nothing, the request's audit row (`file.scan_diagnosed`, verdict only — never the file's bytes or name) is the record of who ran a scan. Returns an honest `unscanned` until the scan Container is activated (the engine-less adapter never reports a false `clean`).
