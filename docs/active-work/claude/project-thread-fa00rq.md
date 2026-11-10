---
worktree: (none — this stream runs in a remote checkout)
area: The community board on community.magnacarta.esq — the @magna-carta/community package, its control-plane tables, then its worker and screens
status: building
touches: packages/community, packages/database/src/control-plane-schema.ts, packages/database/drizzle/control-plane, apps/api-worker/src/control-plane-migrations.ts, packages/identifiers/src, roadmap.d/community.md, changelog.d/
---

Builds the community board from `docs/specs/2026-08-11-community-surfaces-design.md`, home page
layout option A (a ranked list with a product-area rail), picked by the owner on 2026-11-10. The
first pull request lands the domain package and five additive control-plane tables; the board's own
worker (`apps/community-worker`), the sign-in handoff to the community host, and the screens follow.

What a concurrent stream should know: the control-plane lineage gains one migration
(`community-board`), so a stream adding a control-plane migration should re-stamp after merging.
