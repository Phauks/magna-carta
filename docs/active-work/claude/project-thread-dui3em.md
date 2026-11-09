---
worktree: /home/user/magna-carta (cloud session)
area: AI model roster — current models in the catalog, the provider's live model list beside it, the AI settings double scrollbar
status: review
touches: packages/inference, apps/api-worker/src/routes/firm-ai-settings.ts, apps/api-worker/src/inference, apps/web/src/lib/ai, apps/web/src/routes/(app)/settings/ai, apps/web/src/lib/settings/components/settings-scroll-region.svelte, docs/user/admin/ai-and-the-assistant.md, roadmap.d/ai.md
---

Brings the curated model catalog up to the current Anthropic generation (catalog version 4), adds a
cached, read-only check against Anthropic's model list that is reported beside the roster and never
widens it, and makes the settings scroll region the containing block for positioned descendants so
the AI settings page stops scrolling twice. `SettingsScrollRegion` is shared by every settings page.
