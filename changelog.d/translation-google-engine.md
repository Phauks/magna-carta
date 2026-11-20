---
category: Added
audience: internal
---

**Translation runs on Google Cloud Translation, behind a firm switch.** New package
`@magna-carta/translation` (the port, the Google Basic v2 adapter, the firm switch
`translation.enabled`, the contract), `POST /api/v1/translation/translate` and
`GET /api/v1/translation/languages` behind the new `tools:translation` (seeded to every default role),
and `GET`/`PATCH /api/v1/firm/translation-settings` behind `firm:manageAiSettings`. The key is
`GOOGLE_TRANSLATE_API_KEY`, bound from the Secrets Store with a per-Worker fallback, and System Status
lists Translation under AI. Each run writes a `translation.translated` row to the firm's log without
the text. The Translate screen follows once its layout is picked.
