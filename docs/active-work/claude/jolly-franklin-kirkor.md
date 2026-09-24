---
worktree: /home/user/magna-carta
area: In-app document editing — the editor frame's embedding policy, the open-a-document waiting state, and the header that screen would carry
status: review
touches: apps/edit-worker, containers/collabora, apps/api-worker/src/editing, apps/api-worker/src/exports, apps/api-worker/src/routes/files.ts, packages/data-access/src/pii-registry.ts, tooling/lint-list-pagination, apps/api-worker/src/routes/downloads.ts, apps/api-worker/src/costs/recoverable-charge-consumer.ts, packages/document-assembly, packages/object-dimensions, packages/telemetry/src/metrics.ts, roadmap.d/documents.md, apps/api-worker/src/routes/files.ts, apps/api-worker/src/routes/editing-policy.ts, apps/api-worker/src/app.ts, packages/access-control, packages/database, packages/file-manager, packages/data-access/src/member-statements.ts, apps/web/src/routes/(app)/settings/editing, roadmap.d/settings.md, packages/data-access/src/pii-registry.ts, apps/web/src/lib/file-manager, docs/specs, docs/decisions/pending, docs/operating-costs.md, apps/web/src/lib/documents, apps/web/src/routes/(app)/+layout.svelte, apps/web/src/routes/(app)/documents/[id]/edit, apps/web/src/routes/(app)/settings/opening-files, apps/web/src/lib/settings/settings-sections.ts, apps/web/src/routes/developer-console, apps/web/src/lib/developer/dev-fixtures.ts, packages/design-system/src/lib/components/file-icon, packages/telemetry/src/scrub.ts, packages/api-client, docs/user/admin, changelog.d
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

Fourth round: with the socket connected, coolwsd refused the WOPI host. The allow-list moves from the
image's `aliasgroup1` environment variable to `--o:` overrides in `extra_params` — the channel every
other setting in the Dockerfile already uses and the one this deployment proves works — with the mode
key spelled the way coolwsd's parser reads it. The edit worker gains its area note.

Fifth round: the host trusted, coolwsd's `CheckFileInfo` came back 520 — the container library's own
refusal for a host it intercepted but found no handler for. The handler was declared as a static
class field, which under ES2022 class-field semantics defines an own property that shadows the
library's static setter, so the registry its proxy reads was never filled. It is now assigned in a
static block, and a test runs the library's real proxy dispatch against the class, which answers 520
for the shipped code and forwards to the app worker for the fix. To run it, the edit worker's suite
inlines the library and stubs `cloudflare:workers`.

Sixth round, with the document opening: four asks from the first real editing session. The open is
staged (the host records the editor's callbacks per member and a new progress route serves them;
the screen names each stage and a stall names where). The editor is the whole screen (the edit
page declares `shell: "none"`, the app layout honours it). Spreadsheets, presentations and
drawings open in the editor from one file-type register, rendered at Settings · Opening Files.
Saving works: CheckFileInfo advertises the lock contract the host enforces, a successor container
takes over a stale lock, and the image no longer opens the editor's welcome dialog per document.
`packages/design-system` gains one export (`extensionsOfCategory`); `(app)/+layout.svelte` gains
the shell-less branch — both cross-cutting, both small, `vp run worktrees` shows no other stream
on them.

Seventh round, from the SDK pages the owner supplied as PDFs (the site itself is behind a bot
check): the opening wait becomes one centered panel over the frame with the stall sentence and
Retry inside it; the back-to-matter button goes on the editor's bar through its message protocol
(`editor-controls.ts`), with the editor's Close routed to the same exit; PutFile answers the
documented JSON body; CheckFileInfo names the member; the frame allows full screen; the image
sets `mount_jail_tree=false`. `packages/data-access/src/member-statements.ts` gains one read.

Eighth round, the next layer of the history spec: the firm policy that every document records its
changes. One setting (`editing.record_changes`, on by default) behind a new permission
(`firm:manageEditingPolicy`, seeded to Owner/Admin), a GET/PATCH route on the scan-policy pattern,
a page at Settings · Documents · Editing over the shared server-backed draft, the WOPI host
answering `DisableChangeTrackingRecord: false` on every CheckFileInfo while the policy is on (and
omitting it when off), the launch carrying `recordsChanges`, and the editor screen hiding the
marks once the document is up. `packages/access-control/src/registry.ts` and
`apps/web/src/lib/settings/settings-sections.ts` are the cross-cutting files this round touches,
one line each; `vp run worktrees` shows no other stream on them.

Ninth round, the accept-on-export step the owner decided on 2026-09-18: a `.docx` version the
editor cuts owes an export copy with every tracked change accepted, made on the per-firm queue
and served from every download lane through one resolver. `packages/document-assembly` gains the
accept pass beside its OOXML tools; `file_version` gains three columns by ADD COLUMN;
`packages/object-dimensions` gains the `export-copy` class; `packages/telemetry/src/metrics.ts`
gains three counters; `recoverable-charge-consumer.ts` gains two dispatch rows. `vp run worktrees`
shows no other stream on the cross-cutting ones.

Tenth round, section 3.4 of the history spec: the marks read into `file_version_change` when a
version's export copy is made, attributed to members, the per-author summary on every history
row and the changes by author opened from Version History (`files.versionChanges`).
`packages/data-access/src/pii-registry.ts` and `tooling/lint-list-pagination` each gain one
entry; `vp run worktrees` shows no other stream on them.
