---
worktree: cloud session (claude/project-thread-jtxfhj)
area: conflicts check redesign (panel, check page, run cancel)
status: review
touches: packages/conflicts, apps/api-worker/src/http/routes/directory/conflicts.ts, apps/web/src/lib/conflicts, apps/web/src/routes/(app)/conflicts, packages/database (per-firm migration), docs/conventions/conflicts-rulings.md
---

Redesigns the conflicts check to the owner's 2026-11-09 mockups: the New Check panel, the check
page's Report and Runs tabs and three sections, result cards with filters, and cancelling a run.
Adds one per-firm migration (two nullable columns on `conflicts_check_run`).
