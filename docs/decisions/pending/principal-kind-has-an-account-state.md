---
slug: principal-kind-has-an-account-state
status: Accepted
area: Auth & access control
date: 2026-11-20
summary: "Builds ADR-0304 with two corrections that account-first joining made necessary. `user.principal_kind` is `account | firmMember | portalUser`, defaulting to `account`; an account settles into one of the other two once, and neither of those ever changes. A firm member always has a firm and a portal client never does, enforced by triggers because SQLite cannot add a CHECK to a parent table that holds rows; an account that gains a firm becomes a firm member in the same statement. Route metadata gains `principals`, defaulting to everybody but the portal user, checked by the chokepoint before it resolves a firm. A client invitation must name a Directory person, and redeeming it writes a portal membership and provisions no member row."
---

**A person's kind starts as `account` and settles once.**

**Context:** ADR-0304 fixed a person's kind at account creation and tied it to the firm with `CHECK ((principal_kind = 'portalClient') = (firm_id IS NULL))`. Account-first joining (`docs/specs/2026-08-29-account-first-joining-design.md`) landed after it: an account now exists, with no firm, before anyone knows whether it will join as staff or as a client. Under the ADR's CHECK that account would have to be a portal client, which is wrong, and its kind would have to be chosen before the choice is made. Meanwhile the invitation routes still wrote a client with the inviting firm's id and provisioned a member row for them, which is the fail-open shape the ADR exists to remove.

**Decision.**

1. **Three kinds.** `account` (signed up, no firm), `firmMember` (has a firm), `portalUser` (never has a firm). `account` may become either of the others, once. The others never change. The third kind is named `portalUser`, not ADR-0304's `portalClient`, because the same account serves everybody a firm shares with from outside it: a client, opposing counsel, an expert.
2. **Triggers, not a CHECK.** `user` is referenced by other tables and holds rows, so it cannot be rebuilt and SQLite cannot add a CHECK in place. A `BEFORE INSERT` and a `BEFORE UPDATE` trigger refuse a firm member with no firm, a portal client with one, an unknown kind, and a settled kind changing. Two `AFTER` triggers make an `account` that gains a firm a `firmMember` in the same statement, so the staff joining paths stay as they were.
3. **Admission by kind.** Route metadata gains `principals`, defaulting to `["account", "firmMember"]`. The chokepoint answers any other kind with the reserved 404 before it resolves a firm. Only portal routes list `portalUser`, and registration refuses it anywhere else.
4. **A client is somebody the firm already has.** A client invitation names a Directory person, checked when it is issued and required by a trigger. Redeeming it writes `portal_membership` naming that person and provisions no member row.

**Consequences.** A portal user reaches only the routes under `/api/portal/v1/`, admitted through a portal lane that takes the firm from their own active membership. A client account made under the old code becomes a portal client with no firm and no membership, so it reaches nothing until the firm invites it again; no screen issued client invitations, so none are expected. A firmless session (an `account` or a portal client) is read without the session cookie cache, which the portal will pay on every request until its routes are measured. Builds on ADR-0304 and ADR-0036. Spec: `docs/specs/2026-11-20-client-portal-design.md`.
