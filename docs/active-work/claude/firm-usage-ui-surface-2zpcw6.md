---
worktree: /home/user/magna-carta
area: The download register — a per-member shelf of what the platform produced, and the export snapshots that fill it
status: building
touches: apps/web/src/lib/export, apps/web/src/lib/components/app-shell.svelte, apps/web/src/lib/navigation/destinations.ts, apps/web/src/routes/(app)/downloads, docs/user, changelog.d/
---

The download register landed (the table, the routes, the retention sweep, the /downloads page). This
stream now adds the top-bar download tray on the owner's direction, seated beside the Time Keeper.

**It edits `apps/web/src/lib/components/app-shell.svelte`** — one import and one seated component, no
other change to the shell. `slice-0-7b-app-shell` declares that file but its branch resolves to no
ref and its work has landed, and `vp run worktrees` reports no live overlap on it; a stream that
picks the shell back up should know this line is here. Everything the tray does lives in
`$lib/export/download-tray.svelte`, so the shell seats it and does nothing else with it.

This stream stays out of `docs/conventions/design-corrections.md` at `claude/focused-cori-b8z77b`'s
request; the owner ruling it rests on (notifications carry matter work, downloads do not) is recorded
in this slice's spec and ADR fragment and belongs in the ruling ledger once that branch lands.
