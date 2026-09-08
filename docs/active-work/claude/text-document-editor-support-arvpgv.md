---
worktree: C:/dev/magna-carta-worktrees/claude/text-document-editor-support-arvpgv
area: Documents — archive browsing for every format the platform recognises (zip, tar, 7z, rar), listed from headers alone. Zip extraction, the PDF reader and the text editor's encoding guard from this stream have landed.
status: building
touches: packages/file-manager/src/{archive-format,zip-central-directory,zip-member-extract,tar-listing,rar-listing}.ts, packages/seven-zip/, crates/seven-zip-core/, apps/api-worker/src/routes/files.ts, apps/api-worker/src/files/seven-zip-archive-listing.ts, apps/api-worker/src/contracts/problem-types.ts, apps/web/src/lib/file-manager/, roadmap.d/documents.md, status.d/1-1-matters-locations-file-manager.md, STATUS.md, docs/user/features/matter-documents.md, tooling/bootstrap/index.mjs, vite.config.ts
---

An archive stops being opaque to a person, whatever packed it. Browsing one is decided from the
object's own first bytes and dispatched to a reader per format: the zip central directory, a tar's
512-byte header walk, both rar generations' block chains, and a 7z's end-of-file header through
`@magna-carta/seven-zip` (the new `seven-zip-core` crate to WebAssembly, over the
`sevenz-rust2` the repository already builds to WRITE bundles). Every one of them reads headers only
— two or three small ranged reads — so a multi-gigabyte archive lists as cheaply as a small one, and
nothing is ever inflated to answer what is inside.

Extraction stays zip-only and says so by name rather than claiming the other formats hold nothing.

A concurrent stream touching `zip-central-directory.ts`, `apps/api-worker/src/routes/files.ts`, the
file manager's archive bar or `matter-file-api.ts` should merge this first. `vite.config.ts`,
`tooling/bootstrap/index.mjs` and the root `tsconfig.*.json` gain the fourth WebAssembly artefact.
