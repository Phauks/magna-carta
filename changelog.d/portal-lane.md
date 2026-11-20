---
category: Security
audience: internal
---

**The client portal has its own entrance on the server.** Routes under `/api/portal/v1/` are reached only by a portal user, through a portal lane in the chokepoint that admits a firm-scoped request only when the person holds an active portal membership in that firm and the firm is active. Every other caller and firm gets the same "not found", the lane never hands a handler a user id, and the rate limit is per person. The first two routes answer the signed-in person and the firms that share with them (`GET /api/portal/v1/account`) and one of those firms (`GET /api/portal/v1/firms/{firmId}`).
