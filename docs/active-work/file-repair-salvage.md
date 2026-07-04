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

## Status — SP2 built (2026-07-03)

Both plans landed on this branch:
- **6a (stateless):** `containers/recovery` + `apps/recovery-worker` + `RECOVERY_SERVICE` + `documents→files` rename + `tools:fileRepair` (seed `0035`) + stateless routes with re-scan-and-withhold; single Container lane (WASM dropped); `engine-host` R2 client gated behind an opt-in `r2` feature so recovery links no `ring` C dep.
- **6b (attach-to-matter):** `file_repair_provenance` per-firm table (migration `0036`) + data-access statements + `{repair,carve}/attach` routes (server-side upload riding the ingest gate) + dual permission gate + `file.repaired`/`file.carved` audit + flagged→quarantine test + contract regen.

**Owed at merge (this branch is ~68 behind `main` — several latent failures already surfaced and were fixed on-branch; a `main` sync is overdue before merge):**
- **Sync `main` first.** The drift is the root of the latent test/typecheck breakage fixed on this branch (node-sqlite role seed, support-access mock). Sync + run a full `pnpm check` sweep to flush any remaining.
- **STATUS reconciliation:** `main` adopted the `status.d/<slice>.md` fragment convention (not on this branch); the direct `STATUS.md` edits here become a `status.d/file-repair.md` fragment at merge.
- **Migration `0036`:** absorbed by the in-flight migration-collapse (`monotonic-migration-ids` branch) at rebase, or renumbered if a tools/schema stream lands a `0036` first.
- **Fragments assembled on `main`:** `vp run changelog-build` + `vp run decisions-build` for the engine-host, `file-repair-single-container-lane`, `engine-host-r2-optional`, and `file-repair-attach` fragments.
- **Worker `tsc -b`:** the full worker typecheck is a ~10-15 min cold build locally (memory-heavy); CI/warm-env is the authoritative gate. Route code verified by tests + the 6a route's clean `tsc`; the carve route mirrors it.
