---
category: Added
audience: internal
---

**A transferred record remembers where it came from.** The per-firm database gains `transfer_run` (one run of a record transfer: the source system, the operator's label, who started it, and how it ended) and `source_record_link` (one row tying a record in the source system to the record here that it became). A new package, `@magna-carta/record-transfer`, holds the statement builders and the short list of tables a link may name. Nothing writes to either table yet: this is the foundation the LEAP transfer is built on, and the first piece of it. Design: `docs/specs/2026-11-10-record-transfer-framework-design.md`.
