---
worktree: /home/user/magna-carta
area: matter file upload — the failing presigned PUT, the ghost rows a failed upload left, and the Upload dialog rebuilt as intake beside source with a top-bar upload tray
status: building
touches: apps/web/src/lib/file-manager, apps/web/src/lib/documents/document-api.ts, apps/web/src/lib/components/app-shell.svelte, apps/web/src/lib/navigation/destinations.ts, apps/web/src/routes/(app)/uploads, tooling/upload-rulings, apps/api-worker/src/routes/uploads.ts, apps/api-worker/src/files/presign.ts, packages/file-manager/src, packages/database/src/per-firm-schema.ts, packages/database/drizzle/per-firm, docs/conventions/file-manager-rulings.md, docs/user/features/matter-documents.md
---

Fixes the production upload failure (the reservation answered two spellings of the content-type
header, which the browser merged into one doubled value R2 refused), aborts a reservation whose bytes
never landed so no zero-byte row survives a failed upload, and rebuilds the Upload dialog: intake
and destination controls on the left (matter, folder, date basis, document type), the chosen files on
the right as a nested, filterable table on the product's one grid, one Add control for files and
folders, transfers that continue after the dialog closes and report into a top-bar upload tray.
Adds `file_version.source_modified_at` and a content-hash index, the hash-first matches and
duplicates routes, byte progress over XMLHttpRequest, the multipart client, cancel, the rate and
time left, an Uploads page and a Playwright check over the dev gallery. Concurrent streams should stay out of
apps/web/src/lib/file-manager and the upload route until this lands.
