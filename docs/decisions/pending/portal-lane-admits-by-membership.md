---
slug: portal-lane-admits-by-membership
status: Accepted
area: Auth & access control
date: 2026-11-20
summary: "A portal user reaches a firm through their own active portal membership, not through a grant they name. Portal routes live under `/api/portal/v1/`, declare `surface: \"portal\"`, `principals: [\"portalUser\"]` and a `portalScope` of `account` or `firm`, and a firm-scoped route names its firm in the path. The chokepoint's portal lane admits the request only for an active membership in an active firm, answers anything else with the reserved 404, stashes the person, the firm and their Directory person but never a user id, and keys the rate limit by the person. What they see inside the firm is the share's question, not the lane's."
---

**The firm comes from the membership; what is visible comes from the share.**

**Context:** The portal spec (`docs/specs/2026-11-20-client-portal-design.md`) first had each portal request name a grant and found the firm through a control-plane grant index. Sharing then grew beyond clients (opposing counsel, experts) and beyond view-only (comment, edit) and moved to its own thread of work, which owns the grant table. A portal user has a session but no firm and no member row, so neither the session's firm nor the member check that every staff route relies on can admit them.

**Decision.**

1. **Lane.** A route on `surface: "portal"` is admitted by a portal lane in the chokepoint, after the session, sign-in and kind checks and instead of the firm and permission steps. Registration holds such a route to `authenticated: true`, `permission: null`, `resource: "portalShare"`, `principals: ["portalUser"]` and a `portalScope`, and refuses `portalUser` or `portalScope` on any other surface.
2. **Firm from the path, checked against the membership.** A `firm`-scoped route names its firm as `{firmId}`. The lane admits it only when the caller holds an `active` `portal_membership` there and the firm row is `active`; a firm the caller has no membership in, a suspended membership, a suspended firm and a firm that does not exist all get the same 404.
3. **No user id.** The lane stashes `{ principalId, firmId, directoryEntityId }` and the firm context, never `chokepointUserId`, so a staff handler fails on its first line. Rate limiting is keyed by the person.
4. **No grant index.** Because the request does not name a grant, the control plane needs no index of grants to find the firm. Per-item access is read inside the firm database through the sharing read functions.

**Consequences.** One control-plane read per firm-scoped request (the membership joined to the firm). A share revoked inside the firm takes effect on the next request without touching the control plane. A membership suspended in the control plane closes every route in that firm at once. Builds on `docs/decisions/pending/principal-kind-has-an-account-state.md` and ADR-0036.
