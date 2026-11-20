---
category: Security
audience: internal
---

**Client accounts are kept apart from staff accounts.** `user.principal_kind` (`account`, `firmMember`, `portalUser`) and `portal_membership` arrive in the `portal-client-kind` control-plane migration, with triggers that keep a portal user firmless and a settled kind fixed. A client invitation (`POST /api/v1/invitations`, `kind: clientOfFirm`) must now name a Directory person (`directoryEntityId`), and redeeming one, signed in or not, makes a portal user with a membership and provisions no member row; before this, a client was written with the inviting firm's id and given a member row. Route metadata gains `principals`, and the chokepoint answers a portal user the reserved 404 on every route that is not a portal route. Accounts made from client invitations under the old code become portal users with no firm.
