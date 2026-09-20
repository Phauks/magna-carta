---
category: Changed
audience: internal
---

The document editor's container class no longer carries `max_instances: 10`.

Ten was the number of documents the whole fleet could have open at once, across every firm, and the eleventh open would have failed at the container stage of the staged-open screen with nothing to say why. A fixed per-class cap is a cliff a growing fleet walks off; the bound is now the account's concurrent-instance limit, as it already is for six of the eight container workers here. The Host-label check in `apps/edit-worker/src/document-routing.ts` is what keeps an invented label from booting a container, and it is unchanged.

The size comment beside it is corrected. It named a "custom ~2.5 GiB instance" as the target, which the platform cannot configure — a custom type needs at least 1 vCPU and 3 GiB per vCPU — and it quoted a 1.16 GiB idle floor for which no measurement was ever recorded. The comment now says what is and is not known, and points at the sizing method in `docs/research/2026-09-18-local-first-document-editing.md`.
