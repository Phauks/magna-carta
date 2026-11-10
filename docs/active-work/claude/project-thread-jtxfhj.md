---
worktree: cloud session (claude/project-thread-jtxfhj)
area: conflicts check reads names through the record index
status: review
touches: packages/conflicts, apps/api-worker/src/conflicts, apps/api-worker/src/http/routes/directory/conflicts.ts, apps/web/src/lib/conflicts, apps/web/src/routes/(app)/conflicts, packages/database (per-firm migration), docs/conventions/conflicts-rulings.md
---

Second part of the conflicts check redesign: the check searches calls, texts, email, tasks and
Magnus conversations for its parties, records where each result was found, and the New Check panel
and check page turn those places on. Adds one per-firm migration (a nullable `found_in_json` column
on `conflicts_hit`). Third part: Files, read through each matter's file contents index (dormant until the search
service is bound), agreed with the "Build indexing and discovery" thread.

Follow-up: Messaging, Tasks and Magnus name matching moves from LIKE scans to the record index
(#751), in `packages/conflicts/src/content-search.ts`.
