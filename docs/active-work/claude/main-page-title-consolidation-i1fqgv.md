---
worktree: claude/main-page-title-consolidation-i1fqgv
area: apps/web — screen headers and the navigation registry
status: active
touches:
  - apps/web/src/routes/(app)
  - apps/web/src/lib/navigation/destinations.ts
  - apps/web/src/lib/matters/task-list.svelte
  - docs/conventions/design-corrections.md
  - docs/user/features/tasks.md
---

# Main-page title consolidation

Every main page states itself the same way: `ScreenHeader` with a title and nothing else — the
Matters shape. The standing rule "a heading carries no explanatory sub-text" was issued against
list screens only (design-corrections, 2026-08-30) and never reached the rest, so eyebrows and
descriptive sub-lines survived on Home, Notifications, Downloads, Conflicts Check and Tools.

Also renames the `my-work` destination to `tasks` ("Tasks", owner's ruling) and gives that screen
a real `ScreenHeader` — it had no `h1` at all.

Settings is deliberately NOT in scope: `settings-masthead.svelte` makes its descriptor a required
prop and marks it owner-directed. Left for a separate ruling.
