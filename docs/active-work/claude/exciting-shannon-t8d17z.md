---
worktree: /home/user/magna-carta (remote session)
area: Staging ground for the owner's next rounds — the Upload dialog, the Settings surface and Conflicts; notes and research recorded, no code taken
status: designing
touches: docs/conventions/file-manager-rulings.md, docs/conventions/settings-rulings.md, docs/conventions/conflicts-rulings.md, docs/conventions/matter-rulings.md
---

The owner is staging notes for further rounds on the matter file manager's Upload dialog, on the
Settings surface and on Conflicts, and has asked explicitly that no work start until they say so.
This stream has recorded the 2026-09-09 notes as `R22` in the file-manager rulings ledger and opened
`docs/conventions/settings-rulings.md`, `docs/conventions/conflicts-rulings.md` and
`docs/conventions/matter-rulings.md`, each with the owner's 2026-09-11 notes as its `R1` — every
row `open` in all four — together with the research
each round will need, and has touched no application code. When the work starts it lands in
`apps/web/src/lib/file-manager/`, `apps/web/src/routes/(app)/settings/`,
`apps/web/src/lib/settings/`, `apps/web/src/lib/conflicts/`, `packages/conflicts/`,
`apps/web/src/lib/matters/numbering-scheme-editor.svelte` and two design-system floating surfaces,
with backend consequences in the duplicate-hash rows, in whatever Offices needs, and in the
conflicts engine's bounds.

`claude/file-manager-breadcrumb-reflow-fu0pqp` lists the file-manager ledger in its `touches`, and
the two do not overlap in rows. No conflicts stream is in flight: both branches that built that
surface have landed (#575 and #556), and `docs/active-work/claude/conflicts-check-ui-0i4kir.md` is
a dead note on `main` owed a `vp run retire-note`.
