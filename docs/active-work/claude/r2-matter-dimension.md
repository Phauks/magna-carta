# claude/r2-matter-dimension

**Scope:** Stamp the matter dimension (and the object class beside it) into R2 object custom metadata on
every write of a matter-associated object into a firm's bucket; a convergent backfill sweep for objects
already written without it; and a source-scan fitness function that fails a future R2 write path which
forgets the stamp.

Named as a build-now prerequisite by the AI Search assessment and consumed by the AI Search integration
design, whose derived-feed writer **copies** the matter dimension off the authoritative object rather than
re-deriving it from the database.

## Files this stream touches

Created:

- `packages/object-dimensions/**` — the new leaf package: the dimension names, the object-class
  vocabulary, the two builders (matter-scoped / firm-scoped), and the readers.
- `apps/worker/src/files/object-stamping.ts` — the copy-preserving-dimensions helper.
- `apps/worker/src/files/dimension-backfill-sweep.ts` — the convergent backfill.
- `apps/worker/test/r2-object-dimension-scan.test.ts` — the fitness scan.
- `apps/worker/test/dimension-backfill-sweep.test.ts`
- `changelog.d/r2-matter-dimension.md`, `docs/decisions/pending/r2-object-matter-dimension.md`

Edited:

- `packages/file-manager/src/file-service.ts`, `src/queries.ts`, `package.json`, `CLAUDE.md`
- `apps/worker/src/files/presign.ts` (presigned PUT + multipart create carry the metadata headers)
- `apps/worker/src/routes/{uploads,dev-r2-upload,dev-seed,conversions,templates,locations,shipping,emails,file-repair}.ts`
- `apps/worker/src/editing/{checkout-routes,document-session,wopi-routes}.ts`
- `apps/worker/src/emails/{capture-consumer,attachment-extraction}.ts`
- `apps/worker/src/conversions/conversion-consumer.ts`, `src/downloads/bundle-consumer.ts`
- `apps/worker/src/assemblies/assembly-consumer.ts`, `src/index.ts` (the daily pass)
- `apps/email-worker/src/index.ts`
- `docs/conventions/operations.md` (the bucket CORS allowed-header list)

Not touched: `CHANGELOG.md`, `STATUS.md`, `STATUS.json`, `ROADMAP.md`, the white paper,
`docs/Decision-Log.md`, any per-firm migration, `apps/worker/openapi/openapi.json` (the upload
response's `headers` field is already an open string map, so the contract does not move).

## Overlap watch

- `apps/worker/src/search/` — read only, as the precedent for a convergent sweep. Nothing edited there;
  the split write happens inside the index engine service and is out of this stream's reach.
- `packages/file-manager/` — this stream owns it for the duration. `InitiatedUpload` and
  `InitiatedCheckin` gain a `dimensions` field; nothing is removed or re-signed.
- `apps/worker/src/routes/` — many one-line edits, each adding `customMetadata` to an existing `put`.
  A concurrent stream adding a new R2 write path will now fail the fitness scan until it stamps.
