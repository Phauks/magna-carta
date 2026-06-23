---
branch: tools-file-integrity
worktree: C:/dev/magna-carta-worktrees/tools-file-integrity
area: Tools — File Hash & Integrity (all-TypeScript, pure core)
status: designing
touches: docs/specs/2026-06-23-file-hash-integrity-design.md, packages/file-integrity/** (new), packages/tools/src/types.ts (ContextTag union: add "file"), packages/tools/src/catalog.ts (one row), packages/access-control/src/registry.ts (one permission: tools:fileIntegrity), apps/worker/src/routes/file-integrity.ts (new) + app.ts registration, apps/worker migrations (role seed), STATUS.md, ROADMAP.md, changelog.d/file-hash-integrity.md, docs/decisions/pending/file-hash-integrity-architecture.md
---

A new ethereal Tools-area tool in the `documents` subject group: compute a file's cryptographic digests
(MD5, SHA-1, SHA-256, SHA-384, SHA-512 in one streaming pass) and verify a stored file still matches the
SHA-256 baseline recorded at ingest. Built core-first so a matter-action ("verify in place", "attach an
integrity receipt") can consume the same core later.

Scope of THIS stream: the pure `@magna-carta/file-integrity` core (`hashAll` fan-out, `compareToBaseline`,
`buildReceipt`) + two worker routes (`/api/v1/file-integrity/hash`, `/api/v1/file-integrity/verify`) + one
catalog row + the new `file` context tag (first per-file contextual action) + `tools:fileIntegrity`
permission + role seed. Server-side compute on every surface (forensic attestability + MD5). Per-file verify
records a `file.integrityVerified` row to the per-firm `audit_log`. Hash receipt (.txt/.json) in v1.

Touch-overlap coordination: `packages/tools/src/catalog.ts`, `packages/access-control/src/registry.ts`,
`STATUS.md`, `ROADMAP.md` are also touched by tools-metadata-scrubber (one-row / one-permission additions —
low collision, but sync main before editing). `packages/tools/src/types.ts` ContextTag union edit is unique
to this stream.

Deferred (see spec §8): async large-file verify (Queue), client-side standalone hashing, signed receipts,
PDF receipt, SHA-3/BLAKE. ingest-core.ts is NOT modified (read-only precedent).

Design: `docs/specs/2026-06-23-file-hash-integrity-design.md`.
Principle: memory `tools-area-ethereal-principle.md` (Tools = matter-grade work without committing to a matter).
