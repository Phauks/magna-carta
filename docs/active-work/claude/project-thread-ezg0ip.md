---
worktree: claude/project-thread-ezg0ip (cloud session)
area: Meetings — personal rooms, guests by address, end-to-end encryption
status: building
touches: crates/mls-core, packages/mls, packages/meetings, apps/api-worker/src/http/routes/communications, apps/web/src/lib/meetings, packages/database (one per-firm migration), roadmap.d/meetings.md, status.d/meetings.md, STATUS.md
---

Personal meeting rooms and guests typed by name and address (built, in review because of the
migration), then the end-to-end encryption build: the MLS engine and the SFrame cipher first, then
the room's relay, the frame transform and the pause banner. Anything touching
`apps/api-worker/src/meetings/room/` or `packages/meeting-protocol` should look here first.
