---
worktree: C:/dev/magna-carta-worktrees/claude/text-document-editor-support-arvpgv
area: Documents — the one Open gesture opens a document's editor in a new tab; the editor screen at /documents/{id}/edit (Collabora frame for word-processing formats, an in-app text editor for plain text)
status: building
touches: apps/web/src/lib/file-manager/file-manager.svelte, apps/web/src/lib/documents/, apps/web/src/routes/(app)/documents/, apps/web/src/lib/screen/screen-header.ts, roadmap.d/documents.md, status.d/2-2-editing-versioning-storage-tiering.md, STATUS.md, ROADMAP.md, docs/user/features/matter-documents.md
---

Double-click, Enter and Open on a word-processing or plain-text document open its editor beside the
file manager, through the one new-tab gate. The screen behind that address posts the WOPI token to
the Collabora frame for office formats and runs an in-app text editor, saving through the upload
ceremony as a new version, for plain text. A concurrent stream editing `file-manager.svelte`'s
`activate()` or the document loop's inventory should merge this first.
