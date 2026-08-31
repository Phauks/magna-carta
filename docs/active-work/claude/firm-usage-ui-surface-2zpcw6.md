---
worktree: /home/user/magna-carta
area: The download register — a per-member shelf of what the platform produced, and the export snapshots that fill it
status: building
touches: packages/database/drizzle/per-firm, packages/access-control, packages/data-access, apps/api-worker/src/routes, apps/api-worker/src/downloads, apps/api-worker/src/conversions, apps/api-worker/openapi/openapi.json, packages/api-client, apps/web/src/lib/export, apps/web/src/lib/navigation/destinations.ts, apps/web/src/routes/(app)/downloads, roadmap.d/reports.md, changelog.d/
---

Building the download register: a per-member list of what the platform made for you, held for a
short retention window, downloadable again until it expires. The export framework and its server-side
Word/PDF renderer landed on this branch already; this stream gives what they produce a home.

Two things a concurrent stream should know. **This stream does not touch
`apps/web/src/lib/components/app-shell.svelte`** — the register is a sidebar destination and a page,
not new top-bar chrome, and both `slice-0-7b-app-shell` and `claude/focused-cori-b8z77b` have claims
over the shell. **It also stays out of `docs/conventions/design-corrections.md`** at
`claude/focused-cori-b8z77b`'s request; the owner ruling this stream is built on (notifications carry
matter work, downloads are not matter work) is recorded in this stream's spec and ADR fragment, and
belongs in the ruling ledger once that branch lands.
