---
slice: Meetings — slice 1, members-only meetings from a calendar event
group: cross-cutting
order: 45
research: n/a
spec: done by="Claude"
plan: done
built: in-progress
ui: in-progress
load-profile: n/a
tested: in-progress
branch: claude/focused-edison-ylxfiy
active-work: docs/active-work/claude/focused-edison-ylxfiy.md
next: External guests on a signed one-time join link, then recording behind the jurisdiction consent gate, dial-in once the telephony port has an adapter, and the active-speaker layout that lifts the twelve-participant cap
link-spec: docs/specs/2026-09-18-meetings-design.md
link-plan:
adrs:
blocked-by:
---

A member starts a meeting on a calendar event and other members join from the same place: media goes browser to Cloudflare Realtime selective forwarding unit, signaling is a `MeetingRoom` Durable Object per meeting, and the record keeps who was in the room and when and nothing that was said.
