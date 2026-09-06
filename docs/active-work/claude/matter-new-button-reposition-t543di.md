---
worktree: C:/dev/magna-carta-worktrees/claude/matter-new-button-reposition-t543di
area: One create control on every screen — the design system's CreateControl, in the matter header beside the search and in the docket, directory and custody mastheads
status: review
touches: packages/design-system/src/lib/components/create-control, packages/design-tokens (size.create-control), apps/web/src/lib/matters (sections.ts, create-action.svelte.ts, matter-create-control.svelte, matter-header.svelte), apps/web/src/routes/(app)/matters, apps/web/src/routes/(app)/directory, apps/web/src/routes/(app)/custodian, apps/web/src/lib/{billing,costs,time,file-manager,custodian}, tooling/lint-matter-create-control, docs/conventions/design-corrections.md, docs/conventions/file-manager-rulings.md, docs/user/features
---

Moves the "+ New" affordance out of every matter section's own action row and into the matter
header beside the search, as one fixed-width control whose label is the section registry's answer
("New Fee", "New File") and whose behaviour the section's page claims while mounted. The control is a
design-system component so the docket, the directory and the custody register carry the same one;
the custody register also gains the search beside it. A new gate, `lint:matter-create-control`,
refuses a section that does not answer and a rival create button on any screen that carries the
control. A concurrent stream editing a ledger's action row, the file-manager toolbar, or the
directory/custodian mastheads will collide here.
