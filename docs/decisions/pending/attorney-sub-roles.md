---
slug: attorney-sub-roles
status: Accepted
area: Auth & access control
date: 2026-11-09
summary: "A role can name a parent and so be a sub-role of it; Partner and Associate are seeded under Attorney. A member who holds a sub-role also holds the parent as its own member_role row, so every read that joins member_role to role_permission (the resolver, notification recipients, trust authority reads and triggers) sees the parent's permissions without knowing sub-roles exist, and a sub-role's own grants are only what it adds. Sub-roles add and never subtract, one level deep, at most one per parent per member; the set-roles route refuses a set that breaks either rule, and the invite path assigns the parent alongside. Time is priced by the sub-role's rate, then the parent's, then the card default, below the per-timekeeper rate. The Owner/Admin role is renamed Admin, handle unchanged."
---

**Partner and Associate are sub-roles of Attorney, and a sub-role is materialized as an extra
assignment rather than resolved through inheritance.**

**Context:** The owner asked for "sub-granular roles for attorney, partner and associate, as these may
have different benefits and access" (2026-11-09). Roles were flat permission bundles: a member holds
any number and may do what any of them allows. Nothing modelled one role being a kind of another.

**Decision:** `role.parent_role_id` names a parent. Holding a sub-role means holding the parent too,
as a second `member_role` row. Considered and rejected: resolving inheritance at read time. Six
places join `member_role` to `role_permission` directly, including SQL triggers that guard trust
money, and each would have had to learn the parent walk; one missed is a Partner who cannot do what
an Attorney can. Materializing keeps all six correct by construction and leaves one rule to enforce,
in the one route that writes role sets. Also rejected: deny rules so a sub-role could hold less than
its parent. A member's permissions are a union, and a subtracting role would make "what can this
person do" depend on which roles cancel which. A firm that wants Associates to have less moves that
permission out of Attorney and into Partner.

**Consequences:** Partner's seeded additions are the firm-wide supervisory reads and approvals
between Attorney and Admin (`reports:financial`, `reports:productivity`, `time:viewFirm`,
`time:approve`, `costs:approve`, `matters:reopen`); trust operating funds and rate management stay
with Admin. Associate adds nothing yet. The rate lookup at capture stops taking an arbitrary
`member_role` row (`LIMIT 1`, no order) and orders sub-role, then a role with sub-roles, then name.
Authoring roles and sub-roles in the product remains unbuilt. The administering role's name changes
from Owner/Admin to Admin because it was never tied to ownership; its handle does not change.
