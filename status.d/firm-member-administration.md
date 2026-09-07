---
slice: Firm member administration — roles, deactivation, an invitation that lands holding something, and the real settings permission check
group: cross-cutting
order: 41
research: n/a
spec: done
plan: done
built: done
ui: done
load-profile: n/a
tested: done
branch: claude/settings-implementation-plan-asr0l6
active-work: docs/active-work/claude/settings-implementation-plan-asr0l6.md
next: authoring custom roles and per-member direct grants over the schema that already carries both; then the settings surface's remaining wiring in the order the plan sets — File Safety, Notifications, Beta Access and Firm Profile, Billing
link-spec: docs/specs/2026-09-07-settings-completion-implementation-plan.md
link-plan: docs/specs/2026-09-07-settings-completion-implementation-plan.md
adrs:
blocked-by:
---

The firm can administer its own people. `GET /api/v1/roles` reads the five seeded roles with the permissions each carries and how many active members hold it; `PUT /api/v1/members/{userId}/roles` sets what a member holds as a whole set and diffs it server-side; `POST /api/v1/members/{userId}/deactivation` and `/reactivation` withdraw and restore access without touching the record; and the invitation route accepts a role by name so a new member arrives holding something rather than nothing. Two refusals are enforced in the routes: nobody administers themselves, and a firm keeps somebody who can administer it. `/settings/users` becomes the roster with its three acts, `/settings/roles` states what each role allows in the firm's own words, and `canEditFirmSettings` stops being a constant — every firm page's posture is now the signed-in member's real capability.
