---
slice: The settings surface, wired — firm members and their rights, a member's own name as parts, and the firm's scan policy
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
next: Notifications (the largest missing surface, and its backend is complete on both tiers); then Beta Access and Firm Profile, which each want one read endpoint the server does not expose yet, and Billing, which wants a firm time-settings write route. Also open: authoring custom roles and per-member direct grants over the schema that already carries both; the account surface's remaining seams; and the histogram-plotted control the suspicion threshold wants
link-spec: docs/specs/2026-09-07-settings-completion-implementation-plan.md
link-plan: docs/specs/2026-09-07-settings-completion-implementation-plan.md
adrs:
blocked-by:
---

The firm can administer its own people. `GET /api/v1/roles` reads the five seeded roles with the permissions each carries and how many active members hold it; `PUT /api/v1/members/{userId}/roles` sets what a member holds as a whole set and diffs it server-side; `POST /api/v1/members/{userId}/deactivation` and `/reactivation` withdraw and restore access without touching the record; and the invitation route accepts a role by name so a new member arrives holding something rather than nothing. Two refusals are enforced in the routes: nobody administers themselves, and a firm keeps somebody who can administer it. `/settings/users` becomes the roster with its three acts, `/settings/roles` states what each role allows in the firm's own words, and `canEditFirmSettings` stops being a constant — every firm page's posture is now the signed-in member's real capability. A member's OWN name follows: five parts on the control-plane user row with the printed line rendered from them, `GET`/`PUT /api/v1/me/name` behind the new `firm:editOwnProfile` (seeded to every role, because one's own name is not a privilege), the firm roster mirrored on every save, the parts carried through registration, and Account · Profile live over all of it. Prefix and suffix are one control across the Directory and the account alike: a suggestion list that takes several honorifics and anything typed. File Safety & Scanning follows: four real settings over GET/PATCH /api/v1/firm/scan-policy, staged through a new shared server-backed draft (apps/web/src/lib/settings/server-backed-draft.svelte.ts) that the calendar's own draft now goes through as well, so the settings surface has one implementation of server-backed staging rather than one per page.
