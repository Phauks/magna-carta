---
category: Changed
audience: public
---

**The serial front of every API request loses its two control-plane reads.** The session now rides
Better Auth's HMAC-signed cookie cache for five minutes at a time (`resolveSession` forwards the
refresh `Set-Cookie` so the cache renews past its first window, and a FIRMLESS answer is always
re-read against the store — founding a firm attaches `user.firm_id` by a direct write the library
never sees), and the firm row is cached per isolate for one minute, provisioned rows only — its
three carried values never change after provisioning. The member-active gate and RBAC still read
the firm's own database on every request. The trade and its bounds are the pending decision
`a-session-is-believed-for-five-minutes-and-a-firm-row-for-one`.

## Public

**Everything answers faster.** Moving between screens — and into a matter — no longer waits on the
platform re-checking your sign-in from scratch on every single request: your session is verified
once and then trusted for a few minutes at a time, so pages start with the work instead of the
paperwork. Permissions and membership are still checked live on every request.
