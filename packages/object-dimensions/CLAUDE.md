# @magna-carta/object-dimensions — CLAUDE.md

**Purpose.** The one home for the dimensions stamped into R2 object custom metadata: which matter an
object belongs to, and what class of object it is. Pure TypeScript — no D1, no `env`, no network, no
bucket handle. Every R2 write path in the platform builds its `customMetadata` (or its `x-amz-meta-*`
headers) here.

**White paper:** _Tenancy and data isolation_, _Core domain_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md).

## Key files / entry points

- `src/dimensions.ts` — the whole package: the two dimension names, the closed object-class vocabulary,
  the two builders (`matterScopedObjectDimensions` / `firmScopedObjectDimensions`), the header
  projection for the S3 write path, and the readers (`matterOfObject`, `objectClassOf`,
  `objectIsStamped`).

## Invariants that apply here

- **The object key stays scope-free; the metadata carries the scope.** `files/{fileId}/{versionId}` is
  opaque on purpose — a rename or a matter reassignment must move no bytes. That is why the matter lives
  in the object's metadata and not in its key, and why nothing here derives one from the other.
- **A matter-scoped class is not expressible without a matter.** The two builders are separate functions
  with separate class unions rather than one function with an optional matter, so "a working document
  with no matter" cannot be written by accident.
- **Every value is server-derived.** No dimension value ever originates in a request body. Values are
  identifier handles and vocabulary tokens; `requireStampableValue` refuses anything that is empty,
  over-long, or not printable ASCII, because these values travel as HTTP headers on the presigned
  upload path.
- **The names are a compatibility contract with the objects already in every firm's bucket.** Renaming
  a dimension or a class token orphans that dimension on everything already written and costs a full
  metadata rewrite to repair. Add tokens; do not rename them.
- **Reserved names are enforced, not documented.** `client` and `confidentiality_scope`, and the
  `work-product` / `transcript` / `received-material` classes, are declared here and written by nothing.
  The source scan in `apps/api-worker/test/r2-object-dimension-scan.test.ts` fails if a writer emits one.

## Dependencies & contracts

- Depends only on `@magna-carta/identifiers` (for `MatterId`). Consumed by `@magna-carta/file-manager`
  (which returns the stamp for the version it reserves), `apps/api-worker`, and `apps/email-worker`.
- The backfill sweep (`apps/api-worker/src/background/files/dimension-backfill-sweep.ts`) is the repair path for
  objects written before a stamp existed; it reads through `objectIsStamped` and writes through the
  same two builders, so a stamped-late object is byte-identical in metadata to a stamped-at-write one.

## Gotchas

- A presigned PUT signs the metadata headers, so a client that omits one gets a signature failure rather
  than an unstamped object. That is deliberate — the stamp cannot be silently dropped — but it means the
  firm bucket's CORS `AllowedHeaders` must list them (the deploy runbook,
  [`docs/conventions/operations.md`](../../docs/conventions/operations.md)).
- R2 lower-cases metadata names on the S3 path. Keep every name lower-case here so the binding path and
  the S3 path produce the same record.
