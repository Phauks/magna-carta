---
worktree: (none — this stream runs in the primary checkout)
area: Meetings — in-app video conferencing (Cloudflare Realtime SFU + a per-meeting signaling Durable Object), slice 1: members-only meetings started from a calendar event
status: building
touches: packages/meetings, packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm/, packages/identifiers, packages/data-access/src/pii-registry.ts, packages/access-control/src/registry.ts, apps/api-worker/src/meetings/, apps/api-worker/src/routes/meetings.ts, apps/api-worker/src/app.ts, apps/api-worker/src/index.ts, apps/api-worker/wrangler.jsonc, apps/web/src/lib/meetings/, apps/web/src/routes/(app)/meetings/, apps/web/src/routes/(app)/calendar/, apps/web/src/routes/(app)/matters/[id]/calendar/, roadmap.d/meetings.md, docs/now.md, status.d/meetings.md, STATUS.md, docs/user/, docs/operating-costs.md, changelog.d/, docs/decisions/pending/
---

Builds meetings into the product: a member starts a meeting on a calendar event, other members join,
everyone sees and hears each other and can share a screen, and attendance is recorded. Media goes
browser to Cloudflare Realtime SFU; the Worker only signals through a `MeetingRoom` Durable Object.
Design: `docs/specs/2026-09-18-meetings-design.md`; roadmap: `roadmap.d/meetings.md`.

New files almost everywhere, so little to collide on. The shared surfaces touched are one appended
per-firm migration (re-stamp on merge), two identifier types, two permission keys, one Durable Object
binding and migration tag in `wrangler.jsonc`, and a Start/Join control on the calendar event detail.
