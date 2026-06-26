# decryption-tool

**Stream:** File Decryption & Recovery — a new ethereal Tools-area utility (subject group `documents`).
**Started:** 2026-06-26 · **Owner:** Trevor Goldsmith

## Scope

Design + build a general-purpose file decryption / password-recovery tool: unlock a locked file
when you have the password (strip-with-key), and recover an unknown password when you do not, across
many encrypted-container formats (PDF, ZIP, OOXML; 7-Zip next). Core-first behind a `FormatAdapter`
trait; a `RecoveryBackend` port with a light→heavy escalation ladder (Cloudflare CPU → desktop GPU →
cloud GPU → external-forensic seam); every job under an authorization + audit boundary.

This stream's first deliverable is the **design spec only**
(`docs/specs/2026-06-26-decryption-tool-design.md`). Build is sliced (see the spec's slice plan).

## Files expected to touch (design + slice 1)

- `docs/specs/2026-06-26-decryption-tool-design.md` (this design) + later implementation plan(s)
- `crates/decryption-core/**` (new pure-Rust core)
- `packages/decryption/**` (new `@magna-carta/decryption` WASM + TS wrapper)
- `apps/recovery-worker/**` (new Container, slice 2)
- `packages/tools/src/catalog.ts` (one new row), `packages/access-control` (one new permission)
- `apps/worker/**` (routes, per-firm migration, conformance lists), OpenAPI + api-client regen
- Cross-cutting (sync `main` first): `STATUS.md` (own row), `ROADMAP.md`, `changelog.d/`, `docs/decisions/pending/`
