---
worktree: C:/dev/magna-carta-worktrees/claude/text-document-editor-support-arvpgv
area: Documents — zip extraction: the selective member engine, the route that files a member through the ingest gate, and the archive controls that had been disabled waiting on it. The PDF reader and the text editor's encoding guard from this stream have landed.
status: building
touches: packages/file-manager/src/zip-central-directory.ts, packages/file-manager/src/zip-member-extract.ts, apps/api-worker/src/routes/files.ts, apps/web/src/lib/file-manager/, roadmap.d/documents.md, status.d/1-1-matters-locations-file-manager.md, STATUS.md, docs/user/features/matter-documents.md
---

A zip stops being opaque to a person. Browsing one already read its central directory; extraction
now reads one member's own bytes by ranged read, inflates them through the runtime's own
decompressor, checks them against the length and the CRC-32 the archive recorded, and files the
member through the ordinary ingest gate so it is sniffed and scanned fresh. The central-directory
entry gained the four fields extraction needs, so a concurrent stream touching
`zip-central-directory.ts` should merge this first. The same is true of the file manager's archive
bar and `matter-file-api.ts`.
