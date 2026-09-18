---
worktree: C:/dev/magna-carta-worktrees/claude/zen-hamilton-5itdl5
area: One numbering register — the scheme engine into @magna-carta/sequence-numbering; conflicts checks and custody packets onto it; Settings › Numbering
status: review
touches: packages/sequence-numbering, packages/matters/src/numbering, packages/conflicts/src/check-run.ts, packages/custodian/src/packet-service.ts, packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm, apps/api-worker/src/routes/numbering.ts, apps/api-worker/src/routes/conflicts.ts, apps/web/src/lib/matters/numbering-*, apps/web/src/routes/(app)/settings/numbering, docs/user/admin/numbering.md, roadmap.d/core-domain.md
---

Consolidates every sequence the firm draws onto one register in `@magna-carta/sequence-numbering`
(purposes, segments, render, scheme service, draw planner), moves conflicts check numbers off
`MAX + 1` and custody numbers off their dead fixed-shape model onto it, widens the numbering API
with a listing, and replaces Settings › Matter Numbering with Settings › Numbering. Adds one
per-firm migration (`20260918T195508_conflicts-check-numbering-scheme`). A concurrent stream
touching the matter draw, the conflicts open path, the custody packet draw or the numbering
settings screen should merge this first.
