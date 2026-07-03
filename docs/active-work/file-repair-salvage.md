# file-repair-salvage

**Branch:** `file-repair-salvage` · **Off:** main (ea2362e) · **Owner:** Trevor Goldsmith · **Started:** 2026-06-28

## Scope

**SP2** of the engine-host program: the **File Repair & Salvage** tool — recover content from
structurally corrupted / truncated / damaged files. First real consumer of the `engine-host` harness
(SP1, merged). Built comprehensively (not a lean v1): diagnose broadly, repair across the ZIP/OOXML
family, CFB/OLE2, PDF xref rebuild, and a carving universal-fallback.

Design: `docs/specs/2026-06-28-file-repair-salvage-design.md`. Research: `docs/research/file-corruption-recovery.md`.

## Files I expect to touch

- `crates/recovery-core/**` (Rust engine on the engine-host harness — **native only**; the WASM lane was
  dropped, so Plan 6 also removes the crate's vestigial wasm32-compile support — `getrandom/wasm_js` pin + gate step)
- `containers/recovery/**` (native container = the **single** repair lane; axum on the harness `/diagnose|/repair|/carve`)
- the main worker: `/api/tools/file-repair` (stateless) + `/api/tools/file-repair/attach` routes; repaired/carved
  output is re-scanned through the malware gate before it leaves (both paths)
- `packages/tools/src/{types.ts,catalog.ts}` — **rename** the `documents` subject group to `files` (it is already the
  file-utilities bucket) and add the `file-repair` manifest; all five file tools (incl. AI-Text Detection) stay grouped
- `packages/file-manager/**` (attach-to-matter: repair → 1 new version; carve → N new files; `file.repaired` audit)
- access-control registry (`tools:fileRepair` permission) + a per-firm seed migration
- `crates/Cargo.toml` (workspace member), `docs/conventions/` if a new rule emerges
- On build: `ROADMAP.md`, `STATUS.md`, `changelog.d/`, `docs/decisions/pending/`

Design (Plan 6, resolved): `docs/specs/2026-07-02-file-repair-salvage-plan-6-integration-design.md`.

## Coordination

Reuses the merged `engine-host` harness (SP1). Touches `packages/tools` (catalog), the access-control registry,
and a per-firm seed migration — **coordinate with the other tools-area streams** (`decryption-tool`,
`wellbeing-resources`) which likely add their own catalog rows + permissions + seed migrations:
- **Migration numbering:** latest per-firm is `0034_seed-tools-ai-text-detection`; my seed is next-free (`0035` on this
  branch) — but re-check + renumber against `main` right before writing it, since a tools-area stream may merge first.
- **`documents → files` rename** is a group-string change; whoever merges second rebases the trivial rename.
Does NOT touch pdf-core/decryption-core (that is SP3). The decryption-tool rename ("File Unlock & Password
Recovery") is a separate branch.
