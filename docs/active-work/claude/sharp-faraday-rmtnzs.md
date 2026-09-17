---
worktree: /home/user/magna-carta (remote session)
area: File icon precedence and the type-mismatch finding
status: review
touches: packages/design-system/src/lib/components/file-icon/, apps/web/src/lib/file-manager/file-analysis.ts, apps/web/src/lib/documents/editable-documents.ts, docs/conventions/file-manager-rulings.md, docs/user/features/matter-documents.md
---

The owner's 2026-09-17 ruling that the file icon states what the name claims and the analysis
states whether the claim holds. The design-system resolver flips to name-first for drawing and
gains a bytes-first sibling for handling decisions (the editor keeps reading the bytes); the
type-mismatch check reads the design system's vocabulary instead of its own ten-entry list. Opens
`R25` in `docs/conventions/file-manager-rulings.md`. A concurrent stream editing the file-icon
component or `file-analysis.ts` should merge this first.
