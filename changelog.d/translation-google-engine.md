---
category: Added
audience: internal
---

**Translation runs on Google Cloud Translation.** New package
`@magna-carta/translation` (the port, the Google Basic v2 adapter, the contract), `POST /api/v1/translation/translate` and
`GET /api/v1/translation/languages` behind the new `tools:translation` (seeded to every default role),
with no firm switch: the owner ruled on 2026-11-20 that translation is its own service and not AI,
so the role permission is the one gate. The key is
`GOOGLE_TRANSLATE_API_KEY`, bound from the Secrets Store with a per-Worker fallback, and System Status
lists Translation under search and lookups. Each run writes a `translation.translated` row to the firm's log without
the text.
