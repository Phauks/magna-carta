---
number: 450
slug: a-session-audit-names-the-row-that-went-and-freshness-gates-nothing
status: Proposed
date: 2026-09-09
area: Auth & access control
summary: "Ending a session got a surface at both ends — the profile menu's Sign out, and an Account -> Active Sessions section over Better Auth's list and revoke routes — and two configuration decisions came out of building it. Better Auth's session-freshness dial (session.freshAge) is set to 0, because in the pinned 1.6.22 it gates exactly two endpoints, /list-sessions and the unreachable /unlink-account, and gates none of the writes anybody would want it for: revocation, password change and account deletion all run through sensitiveSessionMiddleware, which never consults it. Left at the library default of one day it would have answered 403 SESSION_NOT_FRESH to the signed-in-devices screen for any session older than a day — precisely the long-lived 'keep me signed in' session that screen exists to let somebody find and end — while still permitting the revocation itself, which is seeing less than you may do rather than a security posture. And the new logout / session.revoked audit events are decided by the endpoint a session was deleted under AND by whether the deleted row is the one that endpoint was asked to remove, because better-call resolves a nested endpoint's path as `context.path || path`: the getSession that the revoke endpoints' own session middleware performs inherits the outer path, and a caller whose session has expired has it swept there, filing a revocation for a request that then 401s having revoked nothing."
---

**A session can be ended from inside the application, and two things about how the platform records
and gates that are decisions rather than defaults.**

**Context:** `Sign out` had been an inert seam since before authentication shipped, and nothing let a
member see or end a session on another device. Building both surfaces meant touching two dials on
the pinned Better Auth 1.6.22 whose defaults are wrong for this deployment in ways that are invisible
until a specific person hits them.

**Decision 1 — the freshness dial is off, because it gates a read and none of the writes.**
`freshSessionMiddleware` is mounted on exactly two endpoints in the pinned version: `/list-sessions`
and `/unlink-account` (unreachable here — no social provider is configured). Revoking a session,
changing a password and deleting an account all use `sensitiveSessionMiddleware`, which re-reads the
session store and does **not** consult `freshAge`. So the dial as applied protects the least
sensitive of those acts and none of the rest. At its default of one day it would have made the
signed-in-devices screen answer 403 for anybody signed in longer than a day — the exact session the
screen is for — while leaving revocation available. `session.freshAge` is therefore `0`.

This is **not** the step-up re-authentication the account surface is designed around. That is a
deliberate re-prompt in front of a named act, it is still to be built, and when it lands it goes in
front of the acts rather than in front of a list.

**Decision 2 — an audit row names the session that actually went.** `logout` and `session.revoked`
join the control-plane auth audit. Deciding them from the deletion alone would be wrong: expiry
sweeps and the two-factor plugin's mid-session rotation both delete session rows through the same
hook, and neither is somebody leaving. Deciding them from the endpoint alone was **also** wrong, and
this is the part worth recording, because it is invisible from the call site: `better-call` resolves
a nested endpoint's path as `context.path || path`, so the `getSession` performed by the revoke
endpoints' own session middleware arrives at the delete hook wearing the outer endpoint's name. A
caller whose session has expired has it swept there, and an endpoint-only gate filed
`session.revoked` for a request that then answered 401 having revoked nothing.

Each path now also says which row it means: `/sign-out` the caller's own (no nested `getSession`
runs under it), `/revoke-session` the row whose token the request named, and
`/revoke-other-sessions` any row that is not the caller's own — with an unresolvable caller skipped
rather than guessed at, since during the sweep the endpoint's session is not established at all.
`/revoke-sessions` is deliberately unmapped: it deletes through the many-row path, which never
reaches this hook.

**Consequences:** the signed-in-devices screen works for the sessions it exists to manage; the audit
trail gains two events that mean what they say. The accepted cost of decision 1 is that
`/list-sessions` is reachable by any live session regardless of age, which is the same standing every
other read in the application already has. The risk carried by decision 2 is that it is pinned by one
test (`apps/api-worker/test/auth-audit.test.ts`): a library upgrade that changes nested-path
resolution fails there rather than silently reinstating false rows.

**Rejected:** raising `freshAge` to a larger window (it would still expire, and still gate only the
read); dropping the audit events rather than gating them precisely (a sign-out that leaves no trace
is the gap the control-plane `auth_audit` exists to close); and identifying a swept session by
re-reading its expiry inside the hook, which costs a read on the hot path and still cannot separate
a sweep from a revocation of an already-expired session.
