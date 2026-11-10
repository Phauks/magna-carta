---
worktree: cloud session (claude/project-thread-jtxfhj)
area: conflicts check searches Messaging, Tasks and Magnus
status: review
touches: packages/conflicts, apps/api-worker/src/http/routes/directory/conflicts.ts, apps/web/src/lib/conflicts, apps/web/src/routes/(app)/conflicts, packages/database (per-firm migration), docs/conventions/conflicts-rulings.md
---

Second part of the conflicts check redesign: the check searches calls, texts, email, tasks and
Magnus conversations for its parties, records where each result was found, and the New Check panel
and check page turn those places on. Adds one per-firm migration (a nullable `found_in_json` column
on `conflicts_hit`). Files waits on the shared indexing design in the "Build indexing and discovery"
thread.
