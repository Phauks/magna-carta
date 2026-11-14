---
category: Added
audience: internal
---

**A record transfer can be driven through the API.** A new route family under `/api/v1/record-transfer` starts a run, takes a source file into the firm's bucket, shows a file's header and first three rows, and takes a request for a pass with its mapping rules. A pass is recorded in the new per-firm table `transfer_pass` and run on the firm's job queue, never on the request: the job reads the file, loads its rows, stores the report beside the file and ends the pass's row with the report's counts. A pass that cannot run says why (the file's bytes are not held, the file cannot be read as rows). A new permission, `firm:transferRecords`, gates all of it and is seeded to the Owner/Admin role alone. No screen calls these routes yet. Design: `docs/specs/2026-11-10-record-transfer-framework-design.md`.
