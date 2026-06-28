# file-repair-salvage

**Branch:** `file-repair-salvage` · **Off:** main (ea2362e) · **Owner:** Trevor Goldsmith · **Started:** 2026-06-28

## Scope

**SP2** of the engine-host program: the **File Repair & Salvage** tool — recover content from
structurally corrupted / truncated / damaged files. First real consumer of the `engine-host` harness
(SP1, merged). Built comprehensively (not a lean v1): diagnose broadly, repair across the ZIP/OOXML
family, CFB/OLE2, PDF xref rebuild, and a carving universal-fallback.

Design: `docs/specs/2026-06-28-file-repair-salvage-design.md`. Research: `docs/research/file-corruption-recovery.md`.

## Files I expect to touch

- `crates/recovery-core/**` (new Rust engine on the engine-host harness; WASM + native targets)
- `containers/recovery/**` (new native heavy-lane container, axum on the harness)
- `apps/scan-worker/**` or the main worker: `/api/v1/file-repair/*` routes (diagnose/repair/attach)
- `packages/tools/src/{types.ts,catalog.ts}` (new `files` subject group; `file-repair` manifest; migrate
  the file-tool family `documents` → `files`)
- `packages/file-manager/**` (derived-version commit + `file.repaired` audit for attach-to-matter)
- access-control registry (`tools:fileRepair` permission) + a per-firm seed migration
- `crates/Cargo.toml` (workspace member), `docs/conventions/` if a new rule emerges
- On build: `ROADMAP.md`, `STATUS.md`, `changelog.d/`, `docs/decisions/pending/`

## Coordination

Reuses the merged `engine-host` harness (SP1). Touches `packages/tools` (catalog) — coordinate the
`documents → files` group migration with any in-flight tools work. Does NOT touch pdf-core/decryption-core
(that is SP3). The decryption-tool rename ("File Unlock & Password Recovery") is a separate branch.
