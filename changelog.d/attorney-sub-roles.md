---
category: Added
audience: public
---

**Roles can have sub-roles; Partner and Associate are seeded under Attorney, and Owner/Admin is
renamed Admin.** `role.parent_role_id` names a parent. A member who holds a sub-role also holds the
parent as its own `member_role` row, so every read that joins `member_role` to `role_permission`
sees the parent's permissions unchanged, and a sub-role's grants are only what it adds. The
set-roles route refuses a sub-role without its parent and two sub-roles of one parent (problem type
`role-family`); the invite consumer assigns the parent alongside. Partner adds `reports:financial`,
`reports:productivity`, `time:viewFirm`, `time:approve`, `costs:approve` and `matters:reopen`;
Associate adds nothing yet. Rate capture now picks the timekeeper's role deterministically
(`readTimekeeperRateRole` in `packages/timekeeping/src/rate-resolution.ts`: sub-role, then a role
with sub-roles, then name) instead of an unordered `LIMIT 1`, and a sub-role with no rate falls back
to its parent's before the card default. Roles and Permissions and Users list each sub-role under its
parent (`apps/web/src/lib/members/role-families.ts`).

## Public

**Partner and Associate, as kinds of Attorney.** Every firm now has two sub-roles under Attorney. A
Partner or an Associate can do everything an Attorney can and counts as an attorney everywhere.
Partners can also see the firm's financial and productivity reports and every timekeeper's time,
approve time and costs, and reopen a closed matter. A rate card can give Partners and Associates
their own default rate, and a rate set for one person still wins. On Users, ticking Partner ticks
Attorney too, and a member holds one of the two. The Owner/Admin role is now called Admin, and
anybody can hold it alongside any other role.
