---
worktree: /home/user/magna-carta (remote session)
area: Staging ground for the next Upload dialog round — the owner's notes recorded, no code taken
status: designing
touches: docs/conventions/file-manager-rulings.md
---

The owner is staging notes for a further round on the matter file manager's Upload dialog and has
asked explicitly that no work be started until they say so. This stream has therefore recorded the
2026-09-09 notes as `R22` in the rulings ledger — every row `open` — and touched nothing else. The
work itself, when it starts, lands in `apps/web/src/lib/file-manager/upload-dialog.svelte` and
`upload-source-table.svelte`, with a backend consequence in the duplicate-hash rows (`P16`). A
concurrent stream should expect the tail of `docs/conventions/file-manager-rulings.md` to have
grown; `claude/file-manager-breadcrumb-reflow-fu0pqp` also lists that file in its `touches`, and the
two do not overlap in rows.
