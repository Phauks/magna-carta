---
worktree: C:/dev/magna-carta-worktrees/claude/zen-hamilton-5itdl5
area: Numbering — the second round on Settings › Numbering, and the last three fixed runs become schemes
status: review
touches: packages/sequence-numbering, packages/billing, packages/timekeeping, packages/communications, packages/database, apps/api-worker/src/routes/numbering.ts, apps/web/src/lib/matters, apps/web/src/routes/(app)/settings/numbering, tooling/lint-settings-scroll, docs/conventions/settings-rulings.md, docs/conventions/ui-design.md, docs/user/admin/numbering.md
---

The owner's walk of the numbering screen, and what it asked for underneath. On the screen: the
second scrollbar is gone and a scan holds it gone, each sequence is a fold whose heading carries its
current number, the parts table gained a delete control beside reordering at the row's end, its
parts read alphabetically, a cell a purpose cannot customize states what it will populate with, and
the starter templates moved under "Load an example" so they no longer read as the only shapes a firm
may have. Underneath: invoice, time entry and call-and-text numbers join the register as schemes,
which needed three parts (month, day, matter number) and two register fields (`scopeSource`,
`scopeDistinguishedBy`). Every default renders byte-for-byte what its run rendered before.

Concurrent streams: this edits `docs/conventions/settings-rulings.md` and `docs/conventions/ui-design.md`,
and adds `tooling/lint-settings-scroll/` with an ALLOWANCES registry that every settings route
passes through — a stream adding a settings page will meet it.
