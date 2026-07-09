---
category: Security
---

Every `/api/v1` response now carries an explicit `Cache-Control`: the chokepoint stamps `private, no-store` on any reply that leaves it without one — handler replies, the authentication/authorization/rate-limit short-circuits, and idempotency replays alike. An edge cache in front of the Worker keys on the request path and not on the session cookie that carries the firm, and a response with no `Cache-Control` is cached anyway under heuristic freshness; the stamp makes a firm's response structurally uncacheable rather than relying on no cache layer ever being switched on. A route that sets its own `Cache-Control` keeps it.
