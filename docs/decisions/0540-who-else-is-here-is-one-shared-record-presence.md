---
number: 540
slug: who-else-is-here-is-one-shared-record-presence
status: Accepted
date: 2026-11-20
area: Collaboration
summary: "Who else has a record open is one shared feature: a per-firm record_presence table touched every few seconds by the screen, read back as the members seen in the last 30 seconds, served under each record's own path with the permission that reads the record. Trust reconciliation is its first user."
---

**The owner asked on 2026-11-20 for a "someone else is working here" marker on the reconciliation
screen, tied to the app's central who-else-is-here feature.** There was no such feature: the only
presence was the roster inside a meeting room (`apps/api-worker/src/meetings/room/room-presence.ts`),
which belongs to a live call and its relay, not to a record. So this builds the central one.

**Decision.**

- **One table, any record.** `record_presence` in the per-firm database holds a member, a record kind,
  a record id and the instant they last touched it. A screen touches while the record is in view and
  deletes its row on leaving; whoever touched in the last 30 seconds is here. A touch also clears the
  record's rows older than an hour, so the table holds nothing worth keeping.
- **Served under the record, with the record's own permission.** A module mounts the two routes
  (`POST` and `DELETE {record}/presence`) through `registerRecordPresenceRoutes`
  (`apps/api-worker/src/http/routes/shared/record-presence.ts`), naming the permission that reads the
  record and how to tell the record exists. Asking who has a record open is therefore never easier
  than reading it. Neither route is audited: a touch every few seconds would bury the firm's log.
- **Polling, not a socket.** The screens it serves already read again every few seconds, so a touch
  rides beside that read. A Durable Object per record would give instant updates at the cost of a new
  binding and a socket per screen; nothing asked for faster than a few seconds.

**Considered.** Reusing the meeting-room roster: it lives in a meeting's relay and ends with the call.
A Durable Object per record: faster, but a new class and binding for a marker that tolerates a
few seconds' lag.
