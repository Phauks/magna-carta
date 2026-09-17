---
category: Fixed
audience: public
---

**All 134 guard-shaped statements triaged; the lint is now a hard gate.** Fifty-one are `guarded()` — discovery's document claim and terminal writes, the custody destruction decisions and status fences, matter hold/release, the deadline and conversation transitions, the trust reconciliation freeze, the folder-move cycle check, the time-entry draft edit and refile. Eighty-nine carry `fitness:unguarded-write` with a stated reason, in seven recurring shapes (at-least-once replay, claim-or-nothing, mirror columns, set-shaped updates, riding a guarded sibling, probes that match nothing in the happy case, partial progress by design). `GuardedWriteRefusedError` maps centrally to a 409 in the telemetry error handler, so every marked write answers sensibly without per-route wiring; the fee and cost ledgers still catch it first for their own refusal. Three chokepoint bypasses were found and closed — two in notifications, one in the conflicts recheck sweep — where `database.batch()` was called directly and would have dropped a guard silently.

## Public

More edits that lose a race now say so rather than appearing to work. Claiming a discovery document, deciding a destruction request, moving a folder, putting a matter on hold, freezing a trust reconciliation and editing a draft time entry all now refuse when the record moved underneath the request, instead of reporting success and leaving things as they were. Nothing is recorded against a record for a change that did not happen.
