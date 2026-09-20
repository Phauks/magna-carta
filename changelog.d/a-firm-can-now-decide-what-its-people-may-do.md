---
category: Added
audience: public
---

**The firm can administer its own members.** `GET /api/v1/roles` reads the five seeded roles with the permissions each carries and the count of active members holding it; `PUT /api/v1/members/{userId}/roles` sets a member's roles as a whole set and diffs server-side, so a role kept across the change is never momentarily absent from a concurrent authorization read; `POST /api/v1/members/{userId}/deactivation` and `/reactivation` flip `member.status`, which both authorization reads already join on, so a withdrawal takes effect on the member's next request with no second write. The invitation route takes an optional `roleName`, resolved against the firm before anything is written — the provisioning consumer would otherwise dead-letter an unknown role after answering 201.

The gap was not a missing screen: `POST /api/v1/members` sent `roleName: null`, and no endpoint could assign one afterwards. A firm could create people it could then not empower.

Two refusals sit in the routes rather than the screen. Self-administration is refused outright (403), and a firm keeps somebody who can administer it — which, given the first rule, falls out by construction (the actor holds `firm:manageMembers` and is never the subject), so the explicit check is a backstop against two administrators demoting each other at once. `apps/api-worker/src/routes/session/member-administration.ts` says which is which.

`apps/web/src/lib/settings/settings-permissions.ts` stops being a constant: each settings area maps to the registry key that governs it and the answer comes from the shared session reader, so every firm page's posture is the signed-in member's real capability. `apps/web/src/lib/members/permission-language.ts` says a key in the firm's words by deriving the phrase from the key, rather than transcribing two hundred sentences that would go stale.

## Public

**A firm can decide what its own people may do.** Settings · Users is the roster: invite a colleague and name the role they arrive holding, change what somebody holds when their job changes, and withdraw a member's access without erasing them — they stay on the roster, still the responsible attorney on the matters they carried and still the author of what they filed. Settings · Roles and Permissions states what each role actually allows, area by area, so a role can be read before it is given.

Two rules are enforced whatever screen you use. Nobody changes their own roles or takes away their own access: giving up your administration is something you ask a colleague to do, which leaves a record of who did it. And a firm always keeps somebody who can administer it.

Every firm settings page also now tells you the truth about whether you may edit it. That standing used to be fixed regardless of who was signed in; it is your own now.
