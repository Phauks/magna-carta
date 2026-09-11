---
worktree: /home/user/magna-carta (remote session)
area: Staging ground for the owner's next rounds — the Upload dialog, the Settings surface and Conflicts; notes and research recorded, no code taken
status: designing
touches: docs/conventions/file-manager-rulings.md, docs/conventions/settings-rulings.md, docs/conventions/conflicts-rulings.md, docs/conventions/matter-rulings.md, docs/conventions/time-tab-rulings.md, docs/conventions/design-corrections.md
---

The owner is staging notes for further rounds on the matter file manager's Upload dialog, on the
Settings surface and on Conflicts, and has asked explicitly that no work start until they say so.
This stream has recorded the 2026-09-09 notes as `R22` in the file-manager rulings ledger and opened
`docs/conventions/settings-rulings.md`, `docs/conventions/conflicts-rulings.md` and
`docs/conventions/matter-rulings.md`, each with the owner's 2026-09-11 notes as its `R1`; added
`R12` to `docs/conventions/time-tab-rulings.md` for the firm's money screens; and recorded the
messaging correction in `docs/conventions/design-corrections.md` — every ruling row `open` — together with the research
each round will need, and has touched no application code. When the work starts it lands in
`apps/web/src/lib/file-manager/`, `apps/web/src/routes/(app)/settings/`,
`apps/web/src/lib/settings/`, `apps/web/src/lib/conflicts/`, `packages/conflicts/`,
`apps/web/src/lib/matters/numbering-scheme-editor.svelte` and two design-system floating surfaces,
with backend consequences in the duplicate-hash rows, in whatever Offices needs, and in the
conflicts engine's bounds.

**The registry is almost entirely dead notes, and this stream verified it rather than trusting it.**
Of the 55 notes in `docs/active-work/`, 48 name branches whose work has landed, two name workspace
branches holding no commits of their own, and two are legacy notes with no branch behind them. Only
five streams are actually live, and none of them touches anything staged here:
`custodian-refinements-19iycw`, `firm-usage-ui-surface-2zpcw6`, `passive-dev-orchestrator-m7f9jw`,
`tasks-feature-planning-ihaq2r`, and this one. Every note this staging would otherwise have had to
route around — `file-manager-breadcrumb-reflow-fu0pqp` (#567), `conflicts-check-ui-0i4kir` (#556),
`conflicts-check-redesign-w7pl40` (#575), `billing-uui-consolidation-5l2kiu` (#576) — is a dead note
owed a `vp run retire-note`. Each landing was established by walking `main` forward from the merge
base to the first commit that absorbs the branch without changing it, with branches contributing no
commits of their own excluded first, which is the rule `tooling/branch-landing/` implements.
