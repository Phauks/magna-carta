---
worktree: /home/user/magna-carta (remote session)
area: Staging ground for the owner's next rounds — the Upload dialog and the Settings surface; notes and research recorded, no code taken
status: designing
touches: docs/conventions/file-manager-rulings.md, docs/conventions/settings-rulings.md
---

The owner is staging notes for further rounds on the matter file manager's Upload dialog and on the
Settings surface, and has asked explicitly that no work start until they say so. This stream has
recorded the 2026-09-09 notes as `R22` in the file-manager rulings ledger and opened
`docs/conventions/settings-rulings.md` with the 2026-09-11 notes as its `R1` — every row `open` in
both — together with the research each round will need, and has touched no application code. When
the work starts it lands in `apps/web/src/lib/file-manager/`, `apps/web/src/routes/(app)/settings/`,
`apps/web/src/lib/settings/`, `apps/web/src/lib/matters/numbering-scheme-editor.svelte` and two
design-system floating surfaces, with backend consequences in the duplicate-hash rows and in
whatever Offices needs. A concurrent stream should expect the tail of the file-manager ledger to
have grown; `claude/file-manager-breadcrumb-reflow-fu0pqp` also lists that file in its `touches`,
and the two do not overlap in rows.
