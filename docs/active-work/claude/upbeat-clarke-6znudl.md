---
worktree: C:/dev/magna-carta-worktrees/claude/upbeat-clarke-6znudl
area: The Upload panel — one Add control, per-file document types, hashing ahead of the send, a bar that holds its width
status: review
touches: apps/web/src/lib/file-manager, apps/web/src/routes/(app)/uploads, apps/web/src/routes/developer-console/upload-states, packages/design-system/src/lib/components/dropzone, packages/design-tokens, docs/conventions/operations.md, docs/conventions/design-corrections.md, docs/user/files
---

The owner's upload review round of 2026-09-08, plus the diagnosis of the failed upload behind it.
The Add menu becomes one press; the batch-wide document type becomes a column set per file; "On
Arrival" becomes a folded Advanced Settings; the digest is read from the moment a file is chosen
rather than when its lane reaches it; the pace line's room is reserved so the progress bar holds
still. A new module, `upload-digests.svelte.ts`, owns the reads, and `UploadQueueDependencies`
swapped its `hash` seam for a `digest` one — anything standing in for the queue's network takes the
new shape. The design-tokens package gains one dimension (`size.transfer-pace`), so its generated
output and goldens moved.
