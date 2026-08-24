---
worktree: claude/file-manager-round-eight
area: file-manager (mockup + ruling harness)
status: in-review
touches:
  - docs/conventions/file-manager-rulings.md
  - tooling/file-manager-rulings/index.mjs
  - changelog.d/
---

# Round eight of the matter file manager

Twenty-two revisions from the owner's round-eight review, plus the icons ruling that binds the
application and not only the mockup.

**Icons.** Every glyph on the screen is now real Lucide geometry, extracted from the installed
`@lucide/svelte` package rather than authored by hand. The owner's rule is that we do not draw
glyphs; where Lucide has no icon for a thing, the answer is the nearest Lucide icon. This closes
I15, which had been sitting as an owner question.

**A defect I introduced and caught.** The extractor's width regex matched `stroke-width="2"`, so
twenty-eight icons that had taken their size from CSS were pinned to two pixels. Sizing went back
to CSS.

**A defect two earlier rounds failed to fix.** The colour swatches were told to be square twice and
stayed rounded, because `.menu button` sets a corner radius and outranks a bare `.swatch`. The rule
is now scoped to `.menu`, and the check compares the computed radius against zero rather than
merely against "not a circle".

**Deleted files** stopped being a bespoke list and became the matter's own table, because that is
what they are: sortable by deletion time, right-clickable, multi-selectable, with three columns only
this view shows. Its explanatory paragraphs are struck and its row buttons are gone — Restore lives
in the right-click menu, where it cannot overlap the badge beside it.

**Owner answers recorded:** a checkout is not a lock (editing runs through Durable Objects, so
others can still edit), and a document should be able to show who has it open — logged as P16,
designed here and not built.

Harness: 59 checks became 79, and five that had gone stale against the old shapes were repaired
rather than deleted. All 79 pass.
