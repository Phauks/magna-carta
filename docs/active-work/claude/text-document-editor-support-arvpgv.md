---
worktree: C:/dev/magna-carta-worktrees/claude/text-document-editor-support-arvpgv
area: Documents — archive EXTRACTION through one module: zip, tar and 7z members come out, every format dispatched, capped and accounted for in one place. Archive browsing for all four formats, zip extraction, the PDF reader and the text editor's encoding guard from this stream have landed.
status: building
touches: packages/file-manager/src/{archive-format,zip-central-directory,zip-member-extract,tar-listing,rar-listing}.ts, packages/seven-zip/, crates/seven-zip-core/, apps/api-worker/src/routes/files.ts, apps/api-worker/src/files/seven-zip-engine.ts, apps/api-worker/src/contracts/problem-types.ts, apps/web/src/lib/file-manager/, roadmap.d/documents.md, status.d/1-1-matters-locations-file-manager.md, STATUS.md, docs/user/features/matter-documents.md, tooling/bootstrap/index.mjs, vite.config.ts
---

`packages/file-manager/src/archive-members.ts` is now the ONE door into an archive's contents: the
format dispatch for both halves, one refusal vocabulary across every format, the firm's caps applied
before any format-specific code runs, the request's shared budget, and the record of what each
attempt cost and why it ended as it did. A format whose reader needs a compiled engine arrives as an
injected port (the `MalwareScanPort` seam), so the domain package still holds no WebAssembly binding.

Members now come out of a **tar** (stored whole, one ranged read, no decoder at all) and a **7z**
(`crates/seven-zip-core` decodes the one block the member sits in — solid blocks decode the members
ahead of it, which is what the block ceiling exists to bound). A **rar** lists and does not unpack:
there is no memory-safe decoder to build against, and the control says so rather than refusing after
the click.

The crate and its package were renamed from `seven-zip-listing-core` / `@magna-carta/seven-zip-listing`
in a commit of their own, before the code that made the old name false.

A concurrent stream touching `apps/api-worker/src/routes/files.ts`, the file manager's archive bar or
`matter-file-api.ts` should merge this first. `vite.config.ts`, `tooling/bootstrap/index.mjs` and the
root `tsconfig.*.json` carry the fourth WebAssembly artefact under its new name.
