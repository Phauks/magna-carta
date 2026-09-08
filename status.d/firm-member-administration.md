---
slice: The settings surface, wired — every stubbed section given the server behind it, from firm members and their rights through to how the firm measures the time it bills
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
next: Retiring settings-page.svelte and the local-storage committed-value layer, which now have no call sites - blocked only on giving the read-only member's Request a change affordance a home on the server-backed pages. Also open: authoring custom roles and per-member direct grants over the schema that already carries both; Documents & templates and Integrations; Diagnostics, which wants a design before an endpoint; the account surface's remaining seams; and the histogram-plotted control the suspicion threshold wants
link-spec: docs/specs/2026-09-07-settings-completion-implementation-plan.md
link-plan: docs/specs/2026-09-07-settings-completion-implementation-plan.md
adrs:
blocked-by:
---

The firm can administer its own people. `GET /api/v1/roles` reads the five seeded roles with the permissions each carries and how many active members hold it; `PUT /api/v1/members/{userId}/roles` sets what a member holds as a whole set and diffs it server-side; `POST /api/v1/members/{userId}/deactivation` and `/reactivation` withdraw and restore access without touching the record; and the invitation route accepts a role by name so a new member arrives holding something rather than nothing. Two refusals are enforced in the routes: nobody administers themselves, and a firm keeps somebody who can administer it. `/settings/users` becomes the roster with its three acts, `/settings/roles` states what each role allows in the firm's own words, and `canEditFirmSettings` stops being a constant — every firm page's posture is now the signed-in member's real capability. A member's OWN name follows: five parts on the control-plane user row with the printed line rendered from them, `GET`/`PUT /api/v1/me/name` behind the new `firm:editOwnProfile` (seeded to every role, because one's own name is not a privilege), the firm roster mirrored on every save, the parts carried through registration, and Account · Profile live over all of it. Prefix and suffix are one control across the Directory and the account alike: a suggestion list that takes several honorifics and anything typed. File Safety & Scanning follows: four real settings over GET/PATCH /api/v1/firm/scan-policy, staged through a new shared server-backed draft (apps/web/src/lib/settings/server-backed-draft.svelte.ts) that the calendar's own draft now goes through as well, so the settings surface has one implementation of server-backed staging rather than one per page. Then Notifications, both tiers at once: the member's per-category matrix under My Settings and the firm's own tier under Practice, each a table rather than a page of rows, with the composition between them left where it already lives on the server. Then Beta Access, which needed no new endpoint at all — the channel was always in the session bootstrap and the write has existed behind firm:manageReleaseChannel since release channels landed, so the page became one decision (instant, with its own consent dialog) rather than the two rows that were one fact asked twice. Firm Profile closes the band: PUT /api/v1/firm/profile behind a new firm:manageProfile seeded to Owner/Admin alone, writing firm.display_name and never the unique provisioning handle behind it, with no GET because the session already answers what the firm is called. Billing finishes the surface: GET/PATCH /api/v1/firm/time-policy behind time:manageSettings, reading and writing the FIRM tier of the increment and the rounding direction while a matter's or a timekeeper's own override stands untouched above it. With that, SETTING_DEFINITIONS - the local-storage registry every preview row used to live in - is empty, and the mode-purity fitness check was re-pointed at the whole surface with a non-vacuity guard so it keeps its teeth.
