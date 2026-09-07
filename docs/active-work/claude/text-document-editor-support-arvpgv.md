---
worktree: C:/dev/magna-carta-worktrees/claude/text-document-editor-support-arvpgv
area: Documents — the PDF reader, drawn locally by the firm's own engine compiled to WebAssembly, and the guard that stops the text editor opening bytes it would corrupt on save
status: building
touches: apps/web/src/lib/documents/, apps/web/src/lib/file-manager/file-manager.svelte, apps/web/src/routes/(app)/documents/, apps/web/package.json, roadmap.d/documents.md, status.d/2-3-inline-preview-safe-delivery-sandbox.md, STATUS.md, ROADMAP.md, docs/user/features/matter-documents.md
---

Opening a PDF from the file manager now draws it, in a new tab, from `crates/pdf-core` compiled to
WebAssembly and run in a Web Worker: the bytes are rasterized locally by the firm's own memory-safe
engine and only pixels reach the page, so no PDF ever meets a parser that could run what is inside
it. The same round fixes a defect in the text editor, which decoded leniently and would have written
a lossy re-encoding into the next version of any document not already UTF-8.

A concurrent stream touching `openDestinationOf`, the file manager's `activate()`, or anything under
`apps/web/src/lib/documents/` should merge this first.
