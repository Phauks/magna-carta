---
worktree: /home/user/magna-carta
area: in-app video player (design-system VideoPlayer and Slider, watch page, Preview tab, inline-playable verdict)
status: review
touches: packages/design-system, packages/file-manager, apps/api-worker/src/files, apps/api-worker/src/http/routes/files/files.ts, apps/web/src/routes/(app)/documents/[id]/watch, apps/web/src/lib/file-manager/file-inspector.svelte, tooling/lint-back-navigation, status.d/2-3-inline-preview-safe-delivery-sandbox.md, roadmap.d/documents.md
---

Builds the video player with our own controls and judges each video's playability at its first
preview. Touches the preview grant route and the file inspector's Preview tab.
