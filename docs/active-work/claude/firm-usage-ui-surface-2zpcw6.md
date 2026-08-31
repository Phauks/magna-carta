---
worktree: /home/user/magna-carta
area: Firm Usage tool — route extension + first screen
status: building
touches: apps/api-worker/src/routes/firm-usage.ts, apps/api-worker/openapi/openapi.json, packages/api-client, packages/matters/src/queries.ts, packages/file-manager/src/usage.ts, packages/locations/src/statements.ts, packages/directory, packages/data-access/src/member-statements.ts, apps/web/src/routes/(app)/tools/firm-usage/, apps/web/src/lib/tools/tool-presentation.ts, status.d/tools-area.md, roadmap.d/integrations.md, roadmap.d/documents.md, docs/user/
---

Builds the Firm Usage screen (the diagnostics tool that has been backend-only since ADR-0103) and
extends `GET /api/v1/firm-usage` with the rollups the owner-approved design shows: matters by type
and by location, the file versioning breakdown with sizes, Directory and member counts, and the
three AI meters that were written but never read by any route. Regenerates the OpenAPI snapshot and
the API client, so any concurrent contract change should merge `main` before re-emitting.
