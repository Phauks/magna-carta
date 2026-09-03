---
worktree: C:/dev/magna-carta-worktrees/claude/r2-bucket-isolation-review-pckokv
area: The first production upload — CORS at provisioning, the Upload dialog that sends nothing until asked, Retry beside a failed download
status: review
touches: apps/api-worker/src/firm-resource-provider.ts, apps/api-worker/src/firm-provisioner.ts, apps/api-worker/src/files/browser-upload-cors.ts, apps/web/src/lib/file-manager, apps/web/src/lib/export, apps/web/src/routes/(app)/downloads, packages/design-system/src/lib/components/dropzone, docs/conventions/operations.md, docs/conventions/file-manager-rulings.md, changelog.d/
---

The stream that landed per-firm bucket isolation (#484) continues with what the first real upload
against a firm bucket found: the bucket had no CORS policy, so the browser's presigned PUT died at
the preflight. Provisioning now applies the policy to every new firm bucket; the pre-existing buckets
take it by hand (runbook section 15). On the web side the Upload dialog now opens first and sends
nothing until Upload is pressed (files, several files, or a whole folder, recreated under the chosen
location), "did not land" reads "Upload failed", and a failed download gets a Retry beside it.

Owns `apps/web/src/lib/file-manager/upload-dialog.svelte` and the upload section of
`file-manager.svelte`, the download tray and page, and the Dropzone's new `onEntries`.
