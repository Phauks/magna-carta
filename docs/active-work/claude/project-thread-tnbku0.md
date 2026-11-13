---
worktree: cloud session (claude/project-thread-tnbku0)
area: PDF Editor and PDF tools screens, then the e-signature signing flow
status: building
touches: apps/web/src/lib/pdf-editor, apps/web/src/routes/(app)/documents/[id]/pdf, apps/web/src/routes/(app)/documents/[id]/view, apps/web/src/lib/documents/editable-documents.ts, roadmap.d/documents.md, docs/user/features/pdf-editor.md
---

Builds the PDF tool screens Trevor approved from mockups on 2026-11-12 (redact first, then pages, Bates, watermark, secure, forms, and a PDF tab in the File Workbench), then the signing flow. It calls `@magna-carta/pdf` only; `crates/pdf-core` belongs to the PDF crate stream.
