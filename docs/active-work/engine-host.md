# engine-host

**Branch:** `engine-host` · **Off:** main (647e8b1) · **Owner:** Trevor Goldsmith · **Started:** 2026-06-28

## Scope

A shared **hosting harness** for the pure-Rust document engines — the runtime seam every engine
re-implements (the wasm32 JS-marshalling edge, the `axum` container skeleton, a magic-byte `Format`
type, and the pure-Rust feature discipline). First sub-project (SP1) of a three-part program:

1. **SP1 (this branch)** — build the `magna-carta-engine-host` crate + a `docs/conventions/` standard.
   New code only; touches no existing engine.
2. **SP2 (later, own branch)** — build the **File Repair & Salvage** tool on the harness (first consumer).
3. **SP3 (later, own branch, coordinated)** — retrofit `pdf-core`, `decryption-core`, and the
   `scan`/`bundle`/`raster` containers onto the harness, one at a time, behind green tests.

Design: `docs/specs/2026-06-28-engine-host-framework-design.md`. Research backing for SP2:
`docs/research/file-corruption-recovery.md`.

## Files I expect to touch (SP1)

- `crates/engine-host/**` (new crate), `crates/Cargo.toml` (workspace members)
- `docs/conventions/<engine-host-seam>.md` (new convention)
- `docs/specs/2026-06-28-engine-host-framework-design.md`, `docs/research/file-corruption-recovery.md`
- On build: `ROADMAP.md`, `STATUS.md`, `CHANGELOG.md` fragment, `docs/decisions/pending/` ADR fragment

## Coordination

SP3 will edit `crates/pdf-core` (active on `pdf-engine-roadmap`/`pdf-secure-encrypt`),
`crates/decryption-core` (active on `decryption-tool`), and `containers/bundle` (active on
`enhanced-bundling-plan2`). SP1/SP2 do **not** — no collision until the retrofit, which is sequenced
last and coordinated with those streams then.
