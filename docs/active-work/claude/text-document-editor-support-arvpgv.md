---
worktree: C:/dev/magna-carta-worktrees/claude/text-document-editor-support-arvpgv
area: Documents — File Unlock & Password Recovery now reachable: a real Unlock capability on the File Workbench, its recovery job screen, and a locked PDF's own reader unlocking a known password client-side. Archive extraction through one module (zip, tar, 7z), archive browsing for all four formats, the PDF reader and the text editor's encoding guard from this stream have landed.
status: building
touches: packages/file-manager/src/{archive-format,zip-central-directory,zip-member-extract,tar-listing,rar-listing}.ts, packages/seven-zip/, crates/seven-zip-core/, apps/api-worker/src/routes/files.ts, apps/api-worker/src/files/seven-zip-engine.ts, apps/api-worker/src/contracts/problem-types.ts, apps/web/src/lib/file-manager/, apps/web/src/lib/tools/file-workbench/, apps/web/src/lib/documents/pdf-pages.ts, apps/web/src/lib/documents/pdf-render.worker.ts, apps/web/src/lib/screen/screen-header.ts, apps/web/src/routes/(app)/documents/[id]/view/+page.svelte, apps/web/src/routes/(app)/tools/file-workbench/recovery/, roadmap.d/documents.md, status.d/1-1-matters-locations-file-manager.md, status.d/decryption-file-unlock-password-recovery.md, STATUS.md, docs/user/features/matter-documents.md, docs/user/features/file-unlock-password-recovery.md, docs/user/features/README.md, tooling/bootstrap/index.mjs, vite.config.ts
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

**File Unlock & Password Recovery went from a fully-built, unreachable backend to a real screen.**
`@magna-carta/decryption`'s inspect/unlock routes and the recovery Durable-Object coordinator have
been on `main` for a while with nothing calling them: the File Workbench's Unlock tab was a `stage:
"soon"` placeholder, and the app held no route at all for a recovery job. Neither gap was in this
stream's original scope; both turned out to be the actual blocker on "connect the password-breaking
functionality to a password wall".

`WorkbenchFile` gained a `readBytes()` seam (closes over the browser's own `File`, so a capability
that has to send bytes somewhere can, without the workbench uploading anything on arrival) — the same
gap `metadata.ts`'s own `awaiting` note names, so the next capability that graduates past `stage:
"soon"` has this already built. Unlock itself is real now: attest, unlock with a known password (one
request, answered inline), or start a recovery search, which hands off to
`/tools/file-workbench/recovery/[jobId]` — addressed by the job rather than the file, because a
search that runs for hours has to outlive a workbench tab that does not.

**The PDF reader connects to the SAME password functionality a different way.** `@magna-carta/pdf`
already carried `inspectSecurity`/`decryptDocument` — a second, PDF-native unlock engine, client-side,
never wired to anything. It runs in the exact worker that already rasterizes pages, so the reader's
password wall costs no server round trip for a known password, and links to the Workbench's Unlock
tab for a password it does not have.

A concurrent stream touching `apps/web/src/lib/tools/file-workbench/workbench-file.ts` or
`ephemeral-source.svelte.ts` should merge this first — every `WorkbenchFile` test fixture in the repo
now needs a `readBytes` field.
