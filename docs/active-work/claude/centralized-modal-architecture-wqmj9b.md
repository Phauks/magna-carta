---
worktree: /home/user/magna-carta (remote session)
area: A reading kind for ActionDialog, and the matter-status window migrated onto it
status: building
touches: packages/design-system/src/lib/components/action-dialog/, packages/design-system/src/stories/action-dialog.stories.svelte, apps/web/src/lib/matters/matter-status-dialog.svelte, tooling/lint-one-ui/rules.mjs, docs/specs/2026-09-01-consolidated-modal-architecture-design.md, changelog.d/, docs/decisions/pending/
---

`main` is red on `lint:one-ui`: #473 landed `matter-status-dialog.svelte` composing `Dialog.Content`
by hand, which the `hand-composed-modal` rule refuses and nothing before merge ran. Migrated rather
than allowanced — it postdates the shell — onto a new `kind="reading"`, because its design (no
commit in the bar; the step seated beside the fact) fit neither existing shell. A concurrent stream
should stay out of the action-dialog component directory and
`apps/web/src/lib/matters/matter-status-dialog.svelte` until this lands.
