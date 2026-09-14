---
worktree: C:/dev/magna-carta-worktrees/claude/friendly-keller-53p30x
area: The Build Information panel — the issue reporter's mount, and a link to the source
status: review
touches: apps/web/src/lib/versions, apps/web/src/lib/components, apps/web/test, apps/web/e2e, docs/user/features
---

The panel's Report an Issue opened a dialog mounted inside the popover it was closing, so both went
at once. The dialog moves to the shell behind one module-level flag
(`$lib/components/issue-report.svelte.ts`), which also collapses the profile menu's and the command
palette's separate copies into it. The same round adds the repository link to the panel's header.
Anything else touching `version-report.svelte`, `app-shell.svelte`, `profile-menu.svelte` or
`command-palette.svelte` overlaps.
