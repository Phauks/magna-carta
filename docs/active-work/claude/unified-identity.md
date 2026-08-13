---
branch: claude/unified-identity
worktree: .claude/worktrees/unified-identity
area: Unified identity and authentication methods — passkeys, one-time links, firm identity providers, client-portal identity (design only, no application code)
status: designing
touches: docs/specs/, docs/decisions/pending/, changelog.d/, docs/active-work/
---

Design-only stream answering the owner's scope call on the four authentication methods, designed as
**one surface** rather than four bolt-ons. Produces a design spec, a six-slice implementation plan, and
six ADR fragments. **No application code, no schema, no migration** — nothing under `packages/`,
`apps/`, or `packages/database/drizzle/` is touched on this branch, so it cannot collide with a build
stream.

The design turns on one sentence: a method proves you are the principal, and never decides who the
principal is or what they may then do. Three nouns carry it — a **principal** with an immutable kind, a
**method register** projected over Better Auth's four credential tables, and an **assurance** level with
an authentication instant stamped on the session. Recovery gets the most attention, because recovery is
where account takeover lives: every recovery path is treated as an authentication method with the
ceremony removed, and the mechanism is a hold that announces to every channel, delays, is cancellable
by anyone who still holds the account, and revokes every method enrolled since the request.

**Two live gaps in the tree are named and answered.** The community board
(`claude/community-board`) has to refuse portal principals by counting invitation rows, and its own
comment asks for exactly what slice 1 builds — that stream's `isPortalPrincipal` becomes one session
field once slice 1 lands, so the two should coordinate before either edits
`apps/community-worker/src/session.ts`. And `attempt-ladder.ts` still says the server publishes no
attempt budget, which stopped being true when the middleware shipped.

Fifteen questions are flagged for the owner rather than decided — every one changes the platform's
security posture (whether a passkey may stand alone, whether a link may establish a session, whether a
firm may weaken a platform default, the recovery hold windows, whether platform-administered recovery
exists at all, the single sign-on enforcement modes and break-glass, the federated session cap, the
step-up list, and whether one mailbox that is staff at one firm and a client of another gets one
account or two).
