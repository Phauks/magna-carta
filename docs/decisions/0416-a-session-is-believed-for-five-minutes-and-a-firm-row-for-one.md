---
number: 416
slug: a-session-is-believed-for-five-minutes-and-a-firm-row-for-one
status: Proposed
date: 2026-08-31
area: Platform
summary: "Every API request was paying two serial control-plane reads before any work started — Better Auth's session lookup and the firm-row read — measured in production at the bulk of a ~700ms request whose actual firm-database reads took ~25ms each. Per the owner's direction that a signed-in member is trusted to be here, the session now rides Better Auth's HMAC-signed cookie cache for five minutes at a time (the refresh Set-Cookie is forwarded by resolveSession so the cache renews past its first window), and the firm row — three values that never change after provisioning — is cached per isolate for one minute, provisioned rows only. What stays live on every request, deliberately: the member-active gate and RBAC against the firm's own database, the structural-absence gate for an uncached firm, and a fresh store read for any FIRMLESS session, because attaching a founder's firm is a direct control-plane write the cookie cache never sees. The accepted staleness is a server-side session revocation surviving up to five minutes on an already-issued cookie, and a hard-deleted firm's lingering session surviving up to one."
---

**A signed-in member is trusted to be here — the owner's ruling — so the platform stops re-proving
the session from the control plane on every request and starts believing its own signature for five
minutes at a time.**

**Context:** Production telemetry (2026-08-31) showed `/api/v1/me` spending ~730ms inside the app
while its two firm-database reads took ~25ms each: nearly the whole request was the serial front —
Better Auth's session lookup against control-plane D1, then the firm-row read against the same —
paid identically by every one of the half-dozen parallel requests a screen fires. The same serial
front was where the intermittent "Failed to get session" faults struck. The user-facing shape was a
noticeable pause on every navigation, worst when entering a matter, whose chrome blocks on exactly
one such request.

**Decision:** Two caches, each scoped to what its facts can bear.

**The session rides Better Auth's cookie cache, five minutes.** `session.cookieCache` signs the
session and user into a `session_data` cookie; while it is fresh, `getSession` answers without
touching the store. `resolveSession` forwards the library's refresh `Set-Cookie` headers onto the
API response — without that the cache would die five minutes after sign-in and never renew. One
fact is never believed from the cookie: a FIRMLESS answer, because founding a firm attaches
`user.firm_id` by a direct control-plane write the library never observes, and a cached "no firm"
would wall a founder out of the app they just created. A firmless answer is re-read against the
store before it is believed; firmless sessions are rare and short-lived, so they simply never ride
the cache.

**The firm row rides a per-isolate cache, one minute, provisioned rows only.** The three values the
firm context carries off the row — display name, machine name, bucket name — are written during
provisioning and never updated after; nothing in the codebase writes `name` or `display_name`
post-creation, and `bucket_name` flips exactly once, from NULL. A row still provisioning is never
cached, so a founder sees the bucket on the request after it exists; absence is never cached, so
the structural-absence gate stays live and the Durable Object is still never addressed for a firm
the control plane does not answer for.

**What stays per-request, deliberately.** The checks that answer for a person's standing in their
firm never ride either cache: the member-active gate and the RBAC permission reads go to the firm's
own database on every request, so a deactivated member is cut off immediately whatever their cookie
says. Sign-out on the device clears both cookies at once.

**The accepted staleness, named:** a session revoked server-side (sign-out-everywhere, an expired
row) stays believable on an already-issued cookie for up to five minutes, and a hard-deleted firm's
lingering session survives up to one. Both fall inside the owner's ruling; tightening either is a
`maxAge` edit, not a redesign.
