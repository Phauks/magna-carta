# Matter File Manager — design

**Date:** 2026-07-09 · **Status:** approved, building

The matter's Files section is the crux of the product: the versioned file record every other
subsystem points at. The backend for it is complete and on main. The user-facing surface does not
exist, and three gaps stand between the two — a contract that cannot describe a folder, an ingest
pipeline whose outcome no client can observe, and an upload path that cannot run outside
production.

This document is the design for closing those gaps and building the surface.

## What exists today

`packages/file-manager` is built and on main: a per-matter folder tree (`folder`, self-referential,
cycle-checked, empty-only delete), `file` + `fileVersion` with soft-delete and immutable versions,
`uploadSession`, a quarantine status gate, and storage metering. The Worker exposes
`files.list/get/versions/update/delete/download/preview`, `folders.create/update/delete`, the
four-step direct-to-R2 upload ceremony, and `downloads.zip`. `packages/api-client` generates a
typed SDK plus TanStack Query option factories from a byte-exact OpenAPI snapshot.

`apps/web` renders a Files page from hardcoded fixtures. It has never made a typed API call.

## The three gaps

**Folders cannot be listed.** `folders.create`, `folders.update`, and `folders.delete` exist; there
is no `folders.list`. The server helper `listFoldersByMatter` (`packages/file-manager/src/queries.ts`)
is consumed only by ZIP path composition. A folder browser is impossible against the current
contract.

**Ingest outcome is unobservable.** After `uploads.complete` the version is `pending` until the
async queue commits it. `files.get` returns 404 for a pending-only file; `files.list` gates on
`current_version_id IS NOT NULL`; no endpoint projects the `status` column; there is no
`uploads.get`. A client cannot distinguish *still processing* from *quarantined as malware* from
*abandoned*. A file the scanner flags never appears, with no message to anyone. `quarantineVersion`
does write a `file.quarantined` audit row and emit a `file.quarantined` outbox message — but the
per-firm queue has no handler for that topic and acks it into an `unhandled_topic` counter.

**Upload cannot run locally.** `apps/worker/.dev.vars` deliberately omits `CLOUDFLARE_ACCOUNT_ID`,
so `presignerForEnv` selects the dev presigner, which mints `https://r2.dev.local/...`. That host
does not resolve. No bytes reach storage, no R2 event fires, ingest never runs. Separately, no R2
bucket CORS configuration exists in any environment, so a browser `PUT` to a presigned URL would
fail preflight even against real R2, and multipart could not read the `ETag` header it requires.

## Decisions

### Ingest outcome belongs in the file list

`files.list` gains an opt-in include for pending and quarantined rows. `FileSummary` gains `status`
and `quarantineReason`. `currentVersionId` stays clean-only.

This weakens no invariant. Every read path already carries its own `status = 'clean'` predicate
independently — download (`queries.ts` `selectCurrentCleanVersionStatement`), preview
(`selectCurrentCleanVersionForPreviewStatement`), `files.versions` (`listCleanVersions`), ZIP
(`listCleanCurrentVersionsByMatter`), and the Collabora launch and every WOPI `CheckFileInfo`
callback (`getFileWithCurrentCleanVersion`). The quarantine gate is enforced redundantly at each
consumer, as `packages/file-manager/CLAUDE.md` requires. A quarantined row surfacing in a list can
never reach bytes.

Nor can it render a download affordance. `current_version_id` is written to a non-null value by
exactly one statement, `bumpFileCurrentVersionStatement`, whose every caller pairs it with a clean
commit. A quarantined first upload has `currentVersionId: null` — there is nothing to link to. The
guarantee is structural, not a rule a future contributor must remember.

A separate quarantine route was considered and rejected: it answers the question on a page nobody
opens. A rejected file must say so where the user dropped it.

### The dev upload path is a Worker route, not a production flag

The dev presigner returns a URL at the Worker itself. A development-only route accepts the `PUT`,
writes to the Miniflare `R2` binding, and enqueues the ingest message directly, standing in for the
R2 event notification that local storage does not emit. The client performs the identical four-step
ceremony against both environments; nothing is stubbed on the client.

The route writes bytes to object storage, so it is guarded three ways, all of which must hold:

1. **It registers only when a development-only binding is present**, and that binding is not declared
   in the production wrangler configuration. Absence of a binding cannot be undone by setting an
   environment variable, which a boolean feature flag can.
2. **It sits behind the normal chokepoint** — session, then `files:upload` — so even reachable, it is
   not an unauthenticated write.
3. **It validates the object key against the upload session** that minted it, so it can only write the
   exact object `uploads.initiate` created, never an arbitrary key.

**What this route cannot prove.** It is same-origin, so it exercises no CORS. The most likely
production failure — a bucket with no `AllowedOrigins`, or multipart unable to read the `ETag`
response header — is invisible to every local test run against it. The dev route is therefore not the
acceptance gate for upload.

**The acceptance gate is one real upload against a real bucket in a preview environment**, including
a file large enough to take the multipart path and exercise `uploads.signPart`. Until that passes,
CORS is unverified no matter how green the local suite is.

### Views are modular; the shell is shared

Files presents four regions around one content view. The breadcrumb and the content view are always
present. The folder tree and the details/versions panel toggle. The upload tray is not a user
toggle — it appears while work is in flight and retires when the queue drains.

Four content views read one selection: **list** (the dense sortable table), **tiles** (an icon grid),
**timeline** (chronological, flattening folders), and **gallery**. Gallery renders true thumbnails
for image types, whose presigned object *is* the image, and a large file-type icon otherwise; it
carries an `alpha` maturity badge until a rendition pipeline exists. It does not pretend to preview
what it cannot render.

The persistence pattern behind view and region preferences is already reimplemented five times —
`tools-view-preference.svelte.ts`, `developer-preferences.svelte.ts`, `sidebar-preferences.svelte.ts`,
`appearance-axes.svelte.ts`, `developer-console-storage.ts` — each with its own `typeof localStorage`
guard, swallowing `persist()`, normalize-on-read, and `storage`-event cross-tab follower. It is
extracted to one primitive and those call sites migrate to it.

The multi-view shell — regions record, view registry, shared selection — is built as a shared module
with `/tools` ported onto it as a second consumer, and Files as the third.

## Streams

The work splits by whether it touches `apps/web`. The app shell lives only on
`slice-0-7b-app-shell`; `main` has no `apps/web` routes. The two streams below depend on neither and
branch from `main`.

### Stream one — contract and infrastructure (`file-manager-contract`)

- `GET /api/v1/folders?matterId=` returning the folder tree, over the existing `listFoldersByMatter`.
- `FileSummary` gains `versionNumber`, `sizeBytes`, `sniffedContentType`, `updatedAt`, `scanVerdict`,
  `status`, `quarantineReason`; `files.list` gains the opt-in status include. One list call paints the
  table — no per-row fan-out to `files.versions`.
- `GET /api/v1/uploads/{id}` returning session status, version status, and quarantine reason.
- A consumer for the `file.quarantined` outbox topic.
- The development R2 upload route and the dev presigner change.
- R2 bucket CORS: the configuration, and its runbook step in `docs/conventions/operations.md`.
- `emit-openapi` and `generate-client` in the same commit as the route changes; the byte-exact
  snapshot test gates it.

### Stream two — design-system primitives (`file-manager-primitives`)

`Dropzone`, `Breadcrumb`, `Tree`, `ContextMenu`, `FileIcon`. Each ships with a Storybook entry,
`play`-function behaviour tests, and visual-regression baselines. `packages/design-system` does not
depend on the app shell.

### Stream three — `apps/web` (blocked on `slice-0-7b-app-shell` landing)

The data plane and mock transport (already planned in
`docs/specs/2026-07-08-matter-data-seam-and-mock-mode-plan.md`), authentication and a
`seed-dev-firm` script, the persisted-preference primitive and its five migrations, the multi-view
shell and the `/tools` port, and the Files surface itself: browse, upload, organize, versions, and
download including the 409 flagged-malware acknowledgement.

## Testing

`apps/web` has no test infrastructure today; stream three establishes it. The new design-system
primitives are covered by stories-as-tests under the Storybook Vitest addon, where axe violations
fail rather than warn, plus visual-regression baselines from the pinned Playwright container. The
contract stream extends the Worker's Miniflare integration tests: `folders.list` shape,
`FileSummary` enrichment, `uploads.get` across every version status, the quarantine include, and the
outbox consumer.

The end-to-end proof is a Playwright run that signs in through the seeded firm, uploads a real file
through the development R2 route, and observes the row transition from processing to clean — and a
second that uploads an EICAR test file and observes it transition to rejected, with a reason.

## Out of scope

Inline preview (the `PreviewGrant` player needs `FILES_ORIGIN` bound), Collabora editing, the ZIP
bundle UI, and thumbnail renditions. Each has its own blocker and its own slice.
