# slice-4-1-conflicts

**Branch:** `slice-4-1-conflicts` · **Off:** main (ef4b403) · **Owner:** Trevor Goldsmith · **Started:** 2026-07-09

## Scope

The Phase-4 conflicts matching engine — a new `@magna-carta/conflicts` package plus its worker routes and three append-only per-firm tables. Consumes the Directory conflicts corpus built in slice 1·3; does not change the Directory write path.

In scope: the check orchestration, the typed source registry with a firm-set floor, evidence tiering, graph expansion, identity-join imputation, the immutable conflicts log, and the disposition write-path.

Out of scope: reviewer adjudication UX (owner deferred), Beider-Morse, the Rust/WASM scorer core, the Content source class (email + document text), the prior-firm lateral table, auto-fire triggers and the Cron re-scan, and ethical-wall enforcement.

Design: [`docs/specs/2026-07-09-slice-4-1-conflicts-design.md`](../specs/2026-07-09-slice-4-1-conflicts-design.md) · ADR fragment: [`docs/decisions/pending/conflicts-evidence-tiers-source-registry.md`](../decisions/pending/conflicts-evidence-tiers-source-registry.md)

## Status

Design written. Implementation plan not yet written. Implementation not started.

The headline decision: **no scorer.** Every candidate the blocking channels surface is shown, ranked by evidence tier, never suppressed by a threshold. Strictness is redefined from a score cutoff into a recall knob. This closes research open decisions H.3 and H.5 and diverges from research §D — recorded in the ADR fragment.

Resolves the firm-personnel question ADR-0085 reserved for this cycle: personnel are a **source** matched by identity join, not a Directory node type.

## Files expected to be touched

- `packages/conflicts/**` (new) — the domain package, mirroring `packages/directory`
- `packages/database/src/per-firm-schema.ts` — three new tables (`conflicts_check`, `conflicts_hit`, `conflicts_disposition`)
- `packages/database/drizzle/per-firm/` + `apps/worker/src/per-firm-migrations.ts` — the migration, including the raw-SQL append-only triggers (drizzle-kit cannot model triggers; same constraint as the Directory FTS5 migration `0008_directory`)
- `apps/worker/src/routes/conflicts.ts` (new), `apps/worker/src/app.ts`
- `packages/access-control/src/registry.ts` — the `conflicts:run` / `conflicts:dispose` permissions + role seed
- Generated, committed: `apps/worker/openapi/openapi.json`, `packages/api-client/src/*`, `**/tsconfig.build.json`
- `ROADMAP.md`, `status.d/`, `changelog.d/`, `docs/decisions/pending/`
- `packages/directory/CLAUDE.md` — **stale gotcha fix**: line 60 says `findDuplicateCandidates` tie-ordering is insertion-order and suggests adding a secondary sort, but `search.ts:454` already has the `localeCompare` tiebreak

## Overlap notes

- **Reads `packages/directory` but does not write it.** Consumes `findDuplicateCandidates`, `readEdges`, `readMatterParties`. No Directory stream is currently in flight, but any change to `search.ts`'s channel semantics or merge-resolution is load-bearing here.
- **`packages/database/src/per-firm-schema.ts`** is a shared file — additive tables only, appended at the end. Sync `main` before touching it.
- **`monotonic-migration-ids`** is in flight and rewrites migration IDs. Do not author the migration until that branch lands, or the ID will need restamping. Coordinate before adding `drizzle/per-firm/`.
- **`slice-3-5-operating-general-ledger`** also adds per-firm tables and append-only discipline. No file overlap beyond `per-firm-schema.ts`; worth reading its append-only trigger approach for consistency rather than inventing a second pattern.
- **`access-triggered-rescan`** (worktree `magna-carta-2-1-dev`) — name suggests the malware-scan re-scan, not conflicts. Confirm before touching anything named `rescan`.
- Does **not** touch `crates/`, the Rust workspace, or `email-core`.
