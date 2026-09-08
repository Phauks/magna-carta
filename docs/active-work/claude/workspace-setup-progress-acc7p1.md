---
worktree: /home/user/magna-carta
area: The Building Your Workspace wait — named provisioning steps, and holding the door until the owner's member record has landed
status: review
touches: apps/api-worker/src/joining-state.ts, apps/api-worker/src/routes/me.ts, apps/web/src/lib/auth, apps/web/src/routes/welcome, apps/web/src/routes/(app)/+layout.ts, apps/api-worker/openapi/openapi.json, packages/api-client
---

Two halves of one report. The waiting screen now names the steps it is waiting on — the bootstrap
reports how far the build has got, read from the firm's own row rather than tracked anywhere — and
the wait runs one step past the firm existing, because a firm is activated before the member record
mirroring its owner into the firm's own database has landed and going in during that gap gives
somebody a workspace where every screen refuses.

**It changes `GET /api/v1/me`** (an optional `joining.build`, an optional `membership`), so the
committed OpenAPI snapshot and the generated `@magna-carta/api-client` are re-emitted in the same
commit. That regeneration also picks up pre-existing drift in the client for the
`conflicts.setFirmPolicy` operation, which was added to the contract without the client being
regenerated — it is in this diff because the client is a build output of the whole contract, not
because this stream touched conflicts.

**It edits both joining guards** (`apps/web/src/routes/(app)/+layout.ts` and
`apps/web/src/routes/welcome/+page.ts`), which are mirrors of each other: a stream that changes one
must change the other, or the two send the same person back and forth.
