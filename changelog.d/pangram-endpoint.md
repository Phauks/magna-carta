---
category: Changed
---

AI-Text Detection — the Pangram endpoint reconciliation is complete. The AI-Text Detection adapter now supports both the async external-API task-poll flow (`text.external-api.pangram.com`, `POST /task` → poll `GET /task/{id}`) and the synchronous endpoint (`text.api.pangram.com/v3`), selectable by configuration (async is the default). No user-visible behavior change; internal correctness fixes ensure the provenance (`version` → `vendorVersion`) is accurate and the async poll delay is injected, keeping the core package timer-free.
