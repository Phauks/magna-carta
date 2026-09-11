---
worktree: C:/dev/magna-carta-worktrees/claude/gifted-dijkstra-3xf9uy
area: The signed-out auth surface — registration, confirmation, reset and the back controls
status: review
touches: apps/web/src/lib/auth, apps/web/src/routes/login, apps/web/src/routes/register, apps/web/src/routes/welcome, apps/api-worker/src/routes/registrations.ts, apps/api-worker/src/auth.ts, apps/api-worker/openapi/openapi.json, packages/api-client, docs/conventions/design-corrections.md, docs/user/features
---

The owner's 2026-09-09 pass over the deployed sign-in surface. Registration drops the name fields and
gains a verify-password field; confirming a registration now mints the session on the response, so
nobody is sent back round to the front door; the reset-request screen loses its explanatory line;
every back control names its destination instead of saying "Back to …"; and Check Your Email plus the
confirmation-code screen gain the panel's own back control.

Anything touching `apps/api-worker/src/routes/registrations.ts`, the committed OpenAPI snapshot or the
generated API client will collide — the confirmation response gained a `signedIn` value for `next` and
`name` became optional on the registration request.
