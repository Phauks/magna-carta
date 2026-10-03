---
worktree: (none — this stream runs in the primary checkout)
area: Meetings — external guests, polls and the question queue, media effects, and recording (the announcement, the recorder, then compose, transcript, captions and summary)
status: building
touches: packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm/, packages/identifiers/src/, packages/data-access/src/pii-registry.ts, packages/meetings/, packages/meeting-protocol/, packages/telemetry/src/events.ts, packages/api-client/, packages/design-system/src/lib/styles/, apps/api-worker/package.json, apps/api-worker/tsconfig.build.json, apps/api-worker/tsconfig.test.json, apps/api-worker/src/app.ts, apps/api-worker/src/per-firm-migrations.ts, apps/api-worker/src/signed-token.ts, apps/api-worker/src/support/support-session-token.ts, apps/api-worker/src/chokepoint/, apps/api-worker/src/contracts/problem-types.ts, apps/api-worker/src/contracts/route-meta.ts, apps/api-worker/src/routes/meetings-guest.ts, apps/api-worker/CLAUDE.md, pnpm-lock.yaml, apps/api-worker/src/meetings/, apps/api-worker/src/routes/meeting-chat.ts, apps/api-worker/src/routes/meeting-lobby.ts, apps/api-worker/src/routes/meetings.ts, apps/api-worker/src/routes/meeting-hosting.ts, apps/api-worker/src/routes/meeting-inspect.ts, apps/api-worker/openapi/openapi.json, apps/api-worker/test/, apps/web/src/lib/meetings/, apps/web/src/lib/calendar/, apps/web/src/routes/(app)/meetings/[id]/, apps/web/test/, tooling/lint-modal-headers/modal-headers.mjs, docs/specs/, docs/decisions/pending/, roadmap.d/meetings.md, docs/now.md, status.d/meetings.md, STATUS.md, docs/user/features/meetings.md, changelog.d/, packages/access-control/src/registry.ts, packages/object-dimensions/src/dimensions.ts, apps/api-worker/wrangler.jsonc, apps/api-worker/src/index.ts, apps/api-worker/src/routes/meeting-sink.ts, apps/api-worker/src/routes/meeting-polls.ts, apps/api-worker/src/routes/meeting-questions.ts, apps/web/src/lib/tools/safe-browse/live-screen.svelte, apps/web/src/routes/join/, apps/web/static/_headers, docs/operating-costs.md, packages/inference/, apps/api-worker/src/inference/call-site.ts, apps/api-worker/src/event-dispatch.ts, apps/api-worker/src/routes/meeting-summary.ts, apps/api-worker/src/routes/tasks.ts, packages/tasks/src/task-service.ts, packages/tasks/package.json, packages/tasks/tsconfig.build.json, packages/tasks/tsconfig.test.json, packages/tasks/CLAUDE.md, apps/api-worker/src/routes/meeting-settings.ts, apps/web/src/lib/settings/, apps/web/src/routes/(app)/settings/meetings/, docs/user/admin/README.md
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

The security review of the branch closed the wave: every frame a socket sends spends from a token
bucket carried on the socket, the four frames that each cost a routing-service call have windows of
their own, a hostless room is claimed only from inside it, a reconnect is welcomed with the role the
room holds rather than the one the upgrade read, and an operator's read into a live room is audited.
Two questions stay open for the owner in the host-controls design's amendments: a socket that
outlives its session, and a transcript readable without ever having joined.

External guests follow, against `docs/specs/2026-09-20-meetings-external-guests-design.md`. The
server half is built: two additive per-firm tables (`meeting_guest_invitation`,
`meeting_guest_stay`), presence unioned over both stay tables, a step-zero guest lane at the
chokepoint (`guestLane` on the route meta — the shared surface every route depends on, additive and
inert for a route that does not declare it), the signed credentials on the support session's format,
four host routes and six guest routes in `routes/meetings-guest.ts`, and per-viewer redaction of every
room frame that names a user. The worker now depends on `@magna-carta/design-system` for its
formatters (the invitation mail's date and time), which is one lockfile importer line. The arrival
page, the host's Guests panel and the guest mark in the lobby are the web half, by a concurrent
stream in `apps/web` and `docs/user`.
