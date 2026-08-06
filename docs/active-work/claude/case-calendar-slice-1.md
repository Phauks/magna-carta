---
branch: claude/case-calendar-slice-1
worktree: C:/dev/magna-carta-worktrees/claude/case-calendar-slice-1
area: Case calendar and matter timeline — the recorded event/deadline model plus the federated read layer
status: review
touches: packages/calendar, packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm, packages/data-access/src/pii-registry.ts, packages/data-access/src/cursor-pagination.ts, packages/identifiers, packages/access-control/src/registry.ts, packages/locations, packages/document-assembly/src/resolve.ts, apps/worker/src/routes/calendar.ts, apps/worker/src/per-firm-migrations.ts, apps/worker/src/contracts/problem-types.ts, apps/worker/openapi/openapi.json, packages/api-client, changelog.d, status.d, roadmap.d/calendar.md, docs/user
---

Builds the case calendar's backend: two recorded per-firm tables (`matter_event`, `matter_deadline`)
with the event-type catalog and participant table beside them, one `location.time_zone` column, and
the federated read layer that joins the recorded rows with the subsystem tables that already record
what the firm did — through a source registry, one text-comparable ISO-8601 sort key, one shared
cursor, and one required visible-matter predicate composed into SQL before every `LIMIT`. Nothing is
projected, copied, or backfilled, and no code path computes a deadline date from a court rule.

Migration tag `20260806T000000_case-calendar` assumes journal head idx 34
(`20260805T220000_auto-file-rules`) with the billing branch taking `20260805T230000` at idx 35; this
stream retags to the next dense idx if it is second to merge. It also touches the permission
inventories (`packages/access-control/src/registry.ts`, the role seed migration,
`packages/database/test/node-sqlite.test.ts`, and the worker's `me`/`auth-provisioning-e2e` role
expectations) for `calendar:read` and `calendar:manage`, and the OpenAPI snapshot + typed client —
all three of which the billing stream also moves, so whichever lands second regenerates.
