---
category: Security
audience: internal
---

**Client accounts are kept apart from staff accounts.** `user.principal_kind` (`account`, `firmMember`, `portalClient`) and `portal_membership` arrive in the `portal-client-kind` control-plane migration, with triggers that keep a portal client firmless and a settled kind fixed. A client invitation (`POST /api/v1/invitations`, `kind: clientOfFirm`) must now name a Directory person (`directoryEntityId`), and redeeming one, signed in or not, makes a portal client with a membership and provisions no member row; before this, a client was written with the inviting firm's id and given a member row. Route metadata gains `principals`, and the chokepoint answers a portal client the reserved 404 on every route that does not list the kind. Accounts made from client invitations under the old code become portal clients with no firm.
