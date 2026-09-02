---
worktree: /home/user/magna-carta (remote session)
area: Directory linking — one picker/identity/parties family for every surface that names a person or organization, built first against the matter's parties and client
status: building
touches: docs/specs/2026-09-02-directory-linking-design.md, packages/design-system/src/lib/components/{entity-identity,entity-picker,record-parties}, tooling/lint-one-ui/registry.json, apps/web/src/lib/directory, apps/web/src/lib/matters, apps/web/src/routes/(app)/matters/[id]/parties, apps/web/src/routes/(app)/directory, roadmap.d/core-domain.md, changelog.d/
---

Analysis and plan are in the spec. Slice 1 is in build on this branch: the three design-system components, the matter Parties page on them, and the route renamed to `/directory`. The order after it is: the three design-system
components and the matter parties tab (slice 1), then the client as a `matter_party` row with the
existing backfill given a production caller (slice 2), then the conflicts, custodian and costs pickers
replaced and deleted (slice 3). Slice 3 waits on `custodian-refinements-19iycw` landing because that
stream owns `apps/web/src/lib/custodian`. Concurrent streams adding a person picker anywhere should
stop and use this family instead.
