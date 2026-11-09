---
category: Fixed
audience: internal
---

**The caller-lookup contract passes the API conformance checks again.** The free lookup is recorded as a read-shaped POST, and the money-namespace idempotency rule now skips the POSTs that write nothing. The kept caller ID is one component shape across both routes. The two matter-close test files now send a JSON content type only when a body is sent, as the web client does.
