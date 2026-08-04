---
branch: claude/fix-editing-wopi-guards
worktree: .claude/worktrees/agent-a8ff7248559709315
area: Two defect fixes in document editing — WOPI working-copy ownership, and document-key validation before a container boots
status: review
touches: apps/worker/src/editing/wopi-routes.ts, apps/worker/src/editing/wopi-host.ts, apps/worker/src/editing/edit-session-route.ts, apps/worker/test/editing/, apps/magna-carta-edit/src/document-routing.ts, apps/magna-carta-edit/test/, changelog.d/
---

Bug-fix only: no schema, no API surface, no OpenAPI snapshot change (the `/wopi/*` routes are raw).
Two changes. First, the WOPI file-access handlers now decide between the mutable `current` working copy
and the immutable version the token names by **session ownership** rather than by capability —
`WopiFileDeps` gains `liveSessionId`, `checkFileInfo` and `getFile` share one predicate, and `getFile`
no longer falls back from one object to the other. Second, `documentKeyFromHost` in the edit worker
validates the Host label against the shape the launch route mints (52 lowercase hex characters) before
anything addresses a container.

Nothing here touches the document-session Durable Object's state shape, the checkout/check-in flow, or
the file-manager package, so a stream working in `packages/file-manager` does not collide. A stream
changing how `deriveDocumentKey` builds the key in `apps/worker/src/editing/edit-session-route.ts`
must change `DOCUMENT_KEY_PATTERN` in `apps/magna-carta-edit/src/document-routing.ts` with it — the
two are now a contract and both carry a comment saying so.
