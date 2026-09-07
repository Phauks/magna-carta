---
worktree: C:/dev/magna-carta-worktrees/claude/build-info-header-databases-9g2sjd
area: The header version panel's Database section reports on BOTH databases a request touches
status: building
touches: apps/api-worker/src/routes/meta-database-health.ts, apps/api-worker/openapi/openapi.json, packages/api-client/src, apps/web/src/lib/versions, docs/user/features/seeing-what-version-you-are-on.md
---

The Database section timed and diagnosed the firm's database and gave the control plane a bare ping —
no round trip, no reason when it failed, nothing about the lineage it was running — even though every
request crosses the control plane first. This stream brings the platform leg to parity: both databases
answer the same connection and schema rows, the firm's bucket becomes a row of its own, and the panel
names each database so a reader can say which one is slow. The wire's `schema` field becomes
`firmSchema` and gains `controlPlaneSchema`, so the OpenAPI snapshot and the generated client are both
re-emitted here.
