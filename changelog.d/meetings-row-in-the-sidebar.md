---
category: Fixed
audience: public
---

**The Meetings row reaches the rail.** The row is gated on `meetings:join`, and the rail and the palette asked `grantedPermissions()` in `apps/web/src/lib/tools/tool-permissions.ts`, a fixed mock list of tool permissions that never named it, so the row was filtered out for every member. That function now unions in the permissions the bootstrap session carries (registry-checked, additive only), and the `(app)` layout starts the shared single-flight session read so the gate does not wait on some screen asking first. Held by `apps/web/test/session-granted-destinations.test.ts`.

## Public

**Meetings appears under Communications.** Anyone allowed to join a meeting now sees Meetings in the sidebar and can find it from the command palette. Before, it was hidden from everyone.
