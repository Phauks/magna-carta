---
worktree: (none — this stream runs in the primary checkout)
area: Meetings slices 3-5 — large rooms to 300 participants, host controls as a grant on the meeting, and the waiting room (one lobby per meeting)
status: building
touches: packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm/, packages/meetings/, packages/meeting-protocol/, packages/api-client/, apps/api-worker/src/meetings/, apps/api-worker/src/routes/meeting-lobby.ts, apps/api-worker/src/routes/meetings.ts, apps/api-worker/src/routes/meeting-hosting.ts, apps/api-worker/openapi/openapi.json, apps/api-worker/test/, apps/web/src/lib/meetings/, apps/web/src/routes/(app)/meetings/[id]/, roadmap.d/meetings.md, docs/now.md, status.d/meetings.md, STATUS.md, docs/user/features/meetings.md, changelog.d/
---

Lifts the meeting cap from twelve to three hundred and makes a room of that size work: cameras
publish simulcast, each browser pulls only the tiles it shows and the people talking, the room sends
roster deltas rather than full rosters, and who is speaking is relayed as presence. Design:
section 11 of `docs/specs/2026-09-18-meetings-design.md`; the Zoom gap analysis is section 12 and
the new ledger nodes in `roadmap.d/meetings.md`. New frames are additive; the meetings files are
the only ones touched.

Host controls and the waiting room follow, against
`docs/specs/2026-09-20-meetings-host-controls-and-waiting-room-design.md`. The server halves of both
are built; the screens are the web half and are built by a concurrent stream in `apps/web` and
`docs/user`. The lobby's schema change is additive (`meeting.lobby`,
`meeting_attendance.waiting_from` / `admitted_at`) and the new frames are additive, so the only file
both halves would touch is the emitted contract — which the backend emits first.
