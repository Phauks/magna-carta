---
slice: 4·5 — In/Out Log (front desk drop off and pick up)
group: phase-4
order: 5
research: n/a
spec: done
plan: n/a
built: done by="Opus 5.5"
ui: done by="Opus 5.5"
load-profile: todo
tested: done by="Opus 5.5"
branch: claude/project-thread-r2d6y6
active-work:
next: Notify the people an entry is To on Drop Off (needs a notification type); show entries on a matter and on a Directory record
link-spec: docs/specs/2026-11-19-in-out-log-design.md
link-plan:
adrs:
blocked-by:
---

Built end to end: the `@magna-carta/in-out-log` package over four per-firm tables, six routes behind `inOutLog:read` and `inOutLog:manage`, and the `/in-out-log` screen with Waiting for Pickup and Log tabs, a Drop Off window holding a draft `IO-` number, a Pick Up window, Delete for a mistake, and Move to Custodian through Custodian's own New Packet window.
