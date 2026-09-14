---
worktree: C:/dev/magna-carta-worktrees/claude/zen-franklin-qwi2fk
area: Modal headers — one typed record reference in the subtitle slot, a call-site scan over the heading and that reference, the next-number preview generalized off the call log; then the intake sequence, so every rung of a matter's life draws a number of its own
status: review
touches: packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm, packages/matters/src, packages/intake/src, packages/communications/src, apps/api-worker/src/routes, apps/api-worker/openapi, packages/api-client, packages/design-system/src/lib/components/action-dialog, packages/design-system/src/lib/components/record-window, packages/design-system/src/lib/components/record-reference, apps/web/src/lib, tooling/lint-modal-headers, package.json, docs/specs, docs/conventions/design-corrections.md, docs/decisions/pending, changelog.d, status.d
---

The subtitle slot on `ActionDialog` and `RecordWindow` is contracted to name what is being acted on
and to carry the record's own reference number, and the owner ruled twice on 2026-09-08 that it is
not the place for a paragraph about the subsystem. Nothing enforces either, so 18 of 54 subtitles
are prose, four billing panels mash a number and a sentence together behind three different
separators, and the preview-before-save the owner asked for reached exactly one file. This stream
gives the reference a type the design system renders, scans the call sites for the heading's form
and that reference's presence, and lifts the next-number read off the call log.

All three modal-header pieces are built, and the owner's follow-on ruling of 2026-09-14 — everything has a number, intake included — is built on top: a third numbering sequence, its migration and backfill, the contract, and the surfaces that quote a matter.

All three pieces are built. One gate is red and it is not this branch's to settle: `lint:affected-scope` holds the deferred fan-out sink to 1.5x the heaviest non-sink, and `@magna-carta/api-worker` (2022 files) against `@magna-carta/web` (1349) is now 1.4988. The merge base was 1344, four files of headroom; this branch needs five. The tool's own comment forbids widening the threshold to make a red run green, so the distribution needs re-measuring by the owner.

Do not step on: the `ActionDialog`/`RecordWindow` prop contracts, the app's modal call sites, or
`package.json`'s lint script block. Overlaps `claude/custodian-refinements-19iycw` on the three
custodian panels (their subtitles moved to the typed subject) and on `design-corrections.md`.
