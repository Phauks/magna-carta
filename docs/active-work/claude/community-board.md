---
branch: claude/community-board
worktree: .claude/worktrees/community-board
area: Community surfaces slice 2 — the community board backend (control-plane schema, @magna-carta/community, apps/community-worker)
status: building
touches: packages/database/src/control-plane-schema.ts, packages/database/drizzle/control-plane/, packages/identifiers/src/registry.ts, packages/identifiers/src/types.ts, packages/community/, apps/community-worker/, changelog.d/community-board-backend.md, docs/decisions/pending/community-board-is-a-named-cross-firm-exception.md, status.d/community-2-board-backend.md, docs/user/features/community-board.md, roadmap.d/community.md
---

Surfaces two and three of the community design, which that design reconciles into **one board with
two post kinds** (request and question). This stream is the **backend only** — schema, data access,
contract, routes, tests. No screens: `apps/web` is untouched and is a separate dispatch.

## What this stream owns

- **Control-plane schema.** Six new tables plus the post-number sequence pair, all in
  `packages/database/src/control-plane-schema.ts` and one control-plane migration. No per-firm table
  is added and no per-firm migration index is consumed.
- **`packages/community`** — a new, self-contained `@magna-carta/community`: the board's types, its
  category taxonomy, the format-only confidentiality detector, the distinct-firm ranking, the
  data-access statements, and the public projections that are the identity chokepoint.
- **`apps/community-worker`** — a new deployable serving the board: public reads, authenticated
  writes, operator moderation. It binds the control-plane database and a KV namespace and nothing
  else — no per-firm binding exists for it to reach.
- **The tenancy decision.** `docs/decisions/pending/community-board-is-a-named-cross-firm-exception.md`
  argues the cross-firm exception to the firm-scoped data-access rule on its own terms, which the
  slice-1 decision deliberately left open.

## What other streams should know

- **`packages/identifiers` registry gains eight prefixes.** Any stream adding an entity prefix in the
  same window will collide on one line of `ENTITY_PREFIXES` and one line of `types.ts`.
- **One control-plane migration** (`20260813T...`), journal idx 5, and a refreshed control-plane
  snapshot. A concurrent control-plane schema change must rebase, not hand-merge the snapshot.
- **`apps/worker` is untouched.** No route is added there, so the OpenAPI snapshot, the generated
  client, the conformance suite, and the permission registries are all unchanged by this stream.

## Not in this stream

Screens; the changelog back-link and the subscriber-carry notification email; the RSS feed; the
roadmap projection page; attachments (off by design at launch); Turnstile enforcement wiring; the
public host's DNS and route attachment. The follow-on plan is
`docs/specs/2026-08-13-community-board-remaining-slices-plan.md`.
