---
branch: claude/fix-metadata-scrub-hardening
worktree: C:/dev/magna-carta-worktrees/claude-fix-metadata-scrub-hardening
area: Harden the metadata inspector and scrubber against residue a "make safe to send" pass leaves behind
status: review
touches: packages/metadata, apps/worker/src/routes/metadata.ts, apps/worker/test/metadata-route.test.ts, apps/worker/openapi/openapi.json, docs/user/features/metadata-inspector-scrubber.md
---

# claude/fix-metadata-scrub-hardening

**Scope:** Close the completeness gaps in `@magna-carta/metadata`. Format detection now probes the
archive through the shared guard instead of inflating it, the inflated-size cap is set against the
isolate's real memory ceiling, the tracked-changes scrub covers the whole revision vocabulary (move
range markers, every property-change record, table row and cell revisions, revision save
identifiers), whole part classes that were passing through untouched and unreported (the page-one
preview image, custom XML data, the mail-merge and template settings) are scrubbed and reported, and
JPEG scrub truncates at the end of the image instead of copying appended data forward.

**Status:** Built and tested; package suite and the worker metadata route tests green. Awaiting
review.

**Expected files:** everything under `packages/metadata/`, the worker's metadata route and its test,
the OpenAPI snapshot (the route's request schema gained a bound and a pattern), the user guide, and a
changelog fragment.

**Note for concurrent streams:** the OpenAPI snapshot is regenerated in this branch. Anyone else
touching a route contract should re-emit after merging rather than resolving that file by hand.
