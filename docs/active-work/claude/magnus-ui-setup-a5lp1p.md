---
worktree: C:/dev/magna-carta-worktrees/claude/magnus-ui-setup-a5lp1p
area: The Magnus interface — the assistant's two surfaces (the sidebar destination and the matter section) over the shipped backend
status: building
touches: packages/design-system, apps/web/src/lib/magnus, apps/web/src/routes/(app)/magnus, apps/web/src/routes/(app)/matters/[id]/magnus, apps/web/src/lib/navigation/destinations.ts, apps/web/src/lib/matters/sections.ts, apps/api-worker/src/routes/magnus.ts, packages/magnus, roadmap.d/ai.md, STATUS.md, docs/specs
---

Builds the interface for the assistant whose backend already ships: a conversation surface in the
design system, and the two places a member reaches it from. The two differ in what they are, not in
what they can do — the sidebar destination is the member's own workspace across everything, the
matter section is one matter's file of transcripts — so both compose one surface and differ only in
scope and framing. Also adds the matter filter the list endpoint lacks.

Do not step on: `packages/design-system/src/lib/components/conversation/**` (new), the two Magnus
route directories, or the Magnus entries in the destination and matter-section registries.
