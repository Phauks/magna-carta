# file-type-verifier

**Scope:** New Tools-area utility — **File Type Verifier**. Identifies a file's true content type (Magika), flags extension mismatch, and recommends an extension when missing/wrong. Implemented as a second capability of the untrusted-byte **scan subsystem** (co-located in the scan Container), per `docs/conventions/operations.md` §12.

**Stage:** designing (spec written: `docs/specs/2026-06-26-file-type-verifier-design.md`).

**Files expected to touch:**

- `packages/file-type/**` (new pure package — raw type, report builder, label/extension table)
- `containers/scan/**` (new Rust `identify` module + router route wrapping the Magika crate; model baked at build)
- `apps/scan-worker/src/**` (`/identify` route + `forward-identify.ts`)
- `apps/worker/**` (`POST /api/v1/file-type/verify` route through the chokepoint + permission-seeding migration)
- `packages/tools/src/catalog.ts` (one manifest row)
- `packages/access-control/src/registry.ts` (`tools:fileTypeVerifier`)
- `ROADMAP.md`, `STATUS.md`, `changelog.d/`, `docs/decisions/pending/` (on build)

**Overlap to coordinate:** `access-triggered-rescan` is in flight and touches the scan subsystem (`apps/scan-worker`, `containers/scan`) — coordinate before editing the scan Container/router.
