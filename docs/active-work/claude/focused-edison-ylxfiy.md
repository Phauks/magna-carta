---
worktree: (none — this stream runs in the primary checkout)
area: Meetings slices 3-5 — large rooms to 300 participants, host controls as a grant on the meeting, and the waiting room (one lobby per meeting)
status: building
touches: packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm/, packages/meetings/, packages/meeting-protocol/, packages/telemetry/src/events.ts, packages/api-client/, packages/design-system/src/lib/styles/, apps/api-worker/src/meetings/, apps/api-worker/src/routes/meeting-chat.ts, apps/api-worker/src/routes/meeting-lobby.ts, apps/api-worker/src/routes/meetings.ts, apps/api-worker/src/routes/meeting-hosting.ts, apps/api-worker/src/routes/meeting-inspect.ts, apps/api-worker/openapi/openapi.json, apps/api-worker/test/, apps/web/src/lib/meetings/, apps/web/src/routes/(app)/meetings/[id]/, tooling/lint-modal-headers/modal-headers.mjs, roadmap.d/meetings.md, docs/now.md, status.d/meetings.md, STATUS.md, docs/user/features/meetings.md, changelog.d/
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

In-meeting chat, a raised hand and reactions follow, against section 14 of the first design and
`docs/specs/2026-09-20-meetings-reactions-and-polls-design.md`. Chat's record already existed; what
this adds is the ROOM's relay of it — two additive frames and two RPCs the routes call after their
own writes commit — plus the convergence the relay cannot carry, a `redacted` array on the list for
a reader whose forward walk can never reach a redaction behind its own cursor. The hand and the six
reactions reach no record at all: no table, no migration, no audit row. Both halves of the frames
fitness function are now green, because the web stream landed its side in the same window. Also
here: the corrections from the adversarial review of the hosting and door slices — a hand-over
leaving the outgoing host a co-host, a resignable grant, a claim that counts only a present host,
the door enforced in the insert's own predicate, the `waiting:` key a removal used to leave behind,
and the no-op lock or lobby write that used to broadcast anyway.
