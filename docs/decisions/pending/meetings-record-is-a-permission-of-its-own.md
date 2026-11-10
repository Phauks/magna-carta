---
slug: meetings-record-is-a-permission-of-its-own
status: Proposed
area: Meetings
date: 2026-10-02
summary: "Recording a meeting takes a third permission key, meetings:record, beside meetings:join and meetings:host, binding resource firm. Hosting runs a room and every one of its acts ends with the meeting; a recording is a durable, discoverable, privileged artifact that outlives it. The key is seeded to exactly the roles that hold meetings:host (Owner/Admin, Attorney, Paralegal) so nothing changes for any firm on the day it lands. Stopping is the same key — or a live host grant on the meeting, recorded as stop_reason host, because a member running the room can end it anyway. Reading recordings is meetings:join through the event's visibility; reading who was told is meetings:host."
---

**Recording is its own permission, `meetings:record`, seeded to the hosting seats.**

**Context:** the recording design ([`docs/specs/2026-09-20-meetings-recording-and-transcription-design.md`](../../specs/2026-09-20-meetings-recording-and-transcription-design.md)) asks whether starting a recording is a power of hosting.

**Decision.** A third key, binding `resource: "firm"` for the reason the meeting keys do (a firm event
has no matter). It is separable now and not later: taking a capability back out of `meetings:host`
after firms had granted it would be a migration and a conversation with every firm. It is seeded by
the migration that adds the recording tables to exactly Owner/Admin, Attorney and Paralegal — the seats
that hold `meetings:host` — so no firm's behaviour changes on the merge. Stop is the same key, and a
member holding a live grant on this meeting may stop without it (`stop_reason: 'host'`), because ending
the meeting already stops the recording. The stop route is gated on `meetings:join` at the chokepoint
for that reason, with the key read in the handler and the grant asked by the service. Listing a
meeting's recordings is `meetings:join`; reading the consent record is `meetings:host`.

**Consequences.** A firm that wants recording narrower than hosting removes the key from a role; the
route tests prove an Attorney without it cannot start a recording and can stop one in a room they
run.
