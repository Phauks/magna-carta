---
category: Fixed
audience: internal
---

The version and database-health reads no longer go dark when the firm database is the thing that is broken.

Both are firm-scoped, and the chokepoint resolves a firm by checking that the session's member row is active — a read against the firm's own database. When that database cannot be reached at all, the check does not answer, it throws, and every firm-scoped route answers 500. That includes the two routes whose entire subject is whether the firm database can be reached. An unreachable database took out the panel built to say the database is unreachable, and the reported symptom became an unrelated version read failing.

`RouteMeta` gains `firmDatabaseOutage`, defaulting to `"reject"` so every route that has not thought about it still fails closed: membership could not be verified, so no firm data is served. A route declaring `"tolerate"` is admitted with the context the control plane alone could build, and no permissions. Registration refuses that declaration alongside a named capability — permissions are read from the same unreachable database, so a route claiming one could not be honoured — which makes the misconfiguration a startup failure rather than a discovery during the outage it was written for.

Nothing is relaxed while the database is up: the member-active check runs exactly as before and a deactivated member is still absent. Nothing leaks while it is down: the reads that would carry firm data are the reads that cannot complete. The health handler already caught every probe and reported `unreachable` per check — it simply never got to run.
