---
worktree: /home/user/magna-carta
area: In-app document editing — the editor frame's embedding policy, the open-a-document waiting state, and the header that screen would carry
status: review
touches: apps/edit-worker, apps/api-worker/src/editing, apps/web/src/lib/documents, apps/web/src/routes/developer-console/document-editor-headers, apps/web/src/lib/developer/dev-fixtures.ts, packages/telemetry/src/scrub.ts, changelog.d
---

Two defects, reported from a real open of a `.docx`, and one design question that arrived with them.

The defects are fixed and committed. The editor frame was refused because the policy coolwsd sends
names only its own origin and the internal WOPI host, never the app origin doing the framing — so no
document could open through this path; the app origins are now added to that policy by the worker in
front of the container. And nothing on the screen said an open was being attempted: the waiting state
ended when the launch call answered, long before the editor was on screen. It now runs until the
editor reports the document up, which needed the launching origin carried in the token so
`CheckFileInfo` can return it as `PostMessageOrigin`.

The design question is the editor screen's own header: the owner wants the app's rail and top bar off
that screen, replaced by one band carrying both. That work is a decision surface, not a change to the
editor — three candidate bands rendered from the shipping components at
`/developer-console/document-editor-headers`, each with its normal, read-only, saving and
lost-connection states and the reasoning beside it. The real edit route, the app shell and the screen
header are untouched; the only file outside that new directory is the developer fixtures registry,
which is how the surface is found. Nothing there should be built into the editor until the owner
picks a variant.

Third round: the editor worker gains the standard error boundary it never had (a throw becomes a 500
with an Error ID and one redacted event; a WebSocket the container declines is recorded with the
status the browser cannot see), and the telemetry scrubber learns the bearer-token shapes the editor
puts in every URL. `packages/telemetry/src/scrub.ts` is the one cross-cutting file this stream
touches; `vp run worktrees` shows no other stream on it.
