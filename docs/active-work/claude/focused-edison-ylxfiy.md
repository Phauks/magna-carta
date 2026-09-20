---
worktree: (none — this stream runs in the primary checkout)
area: Meetings slice 3 — large rooms to 300 participants (simulcast, subscription policy, roster deltas, relayed presence, paged gallery), and the roadmap measured against Zoom's enterprise plans
status: building
touches: packages/meetings/src/types.ts, apps/api-worker/src/meetings/, apps/api-worker/test/meeting-room.test.ts, apps/web/src/lib/meetings/, apps/web/src/routes/(app)/meetings/[id]/, roadmap.d/meetings.md, docs/now.md, status.d/meetings.md, STATUS.md, docs/user/features/meetings.md, changelog.d/
---

Lifts the meeting cap from twelve to three hundred and makes a room of that size work: cameras
publish simulcast, each browser pulls only the tiles it shows and the people talking, the room sends
roster deltas rather than full rosters, and who is speaking is relayed as presence. Design:
section 11 of `docs/specs/2026-09-18-meetings-design.md`; the Zoom gap analysis is section 12 and
the new ledger nodes in `roadmap.d/meetings.md`. New frames are additive; the meetings files are
the only ones touched.
