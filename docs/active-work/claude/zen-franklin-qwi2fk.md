---
worktree: C:/dev/magna-carta-worktrees/claude/zen-franklin-qwi2fk
area: Modal headers — one typed record reference in the subtitle slot, a call-site scan over the heading and that reference, and the next-number preview generalized off the call log
status: designing
touches: packages/design-system/src/lib/components/action-dialog, packages/design-system/src/lib/components/record-window, packages/design-system/src/lib/components/record-reference, apps/web/src/lib, tooling/lint-modal-headers, package.json, docs/specs, docs/conventions/design-corrections.md, docs/decisions/pending, changelog.d, status.d
---

The subtitle slot on `ActionDialog` and `RecordWindow` is contracted to name what is being acted on
and to carry the record's own reference number, and the owner ruled twice on 2026-09-08 that it is
not the place for a paragraph about the subsystem. Nothing enforces either, so 18 of 54 subtitles
are prose, four billing panels mash a number and a sentence together behind three different
separators, and the preview-before-save the owner asked for reached exactly one file. This stream
gives the reference a type the design system renders, scans the call sites for the heading's form
and that reference's presence, and lifts the next-number read off the call log.

Do not step on: the `ActionDialog`/`RecordWindow` prop contracts, the app's modal call sites, or
`package.json`'s lint script block.
