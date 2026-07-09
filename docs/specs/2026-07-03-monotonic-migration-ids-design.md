# Monotonic-unique migration IDs + pre-production baseline collapse (design)

**Status:** captured, not scheduled. Decision recorded in `docs/decisions/pending/monotonic-migration-ids.md`. This note fixes the approach and lists the sub-decisions to resolve when the collapse is actually executed as its own coordinated pass. It is **not** a feature-branch change — see the coordination section.

## Problem

Sequential `00NN` migration numbers collide across parallel worktrees: two branches both grab the next integer, so every migration-bearing branch carries a manual "renumber if another stream merges first" step plus a snapshot regeneration. Fragments solved this for ADRs/changelog, but migrations are an ordered snapshot chain (each `meta/NNNN_snapshot.json` diffs its predecessor), so they cannot be assembled at merge as cleanly. Timestamp-based IDs remove the collision at authoring time instead of deferring it to merge.

## Decision (recap)

1. **Monotonic-unique, timestamp-based migration IDs** for both lineages (control-plane + per-firm), replacing `00NN`.
2. **Collapse the existing chain to one baseline per lineage** while pre-production (no firm onboarded), re-expressing the current schema + seeds.
3. Done as a **dedicated `main`-level pass**, streams coordinated, never on a feature branch.

## ID scheme

- Format: a UTC timestamp prefix with enough granularity to be unique per author-moment, followed by a slug — e.g. `20260703T120400_file_repair_provenance`. The prefix is the sort key; the slug is human context.
- Ordering: the loader applies migrations in ascending ID order. Timestamps give a total order across branches without a shared counter.
- Uniqueness within the same second: resolve at execution time — either sub-second precision (append milliseconds) or a short random/ULID suffix. ULIDs are an alternative to a bare timestamp (monotonic + lexicographically sortable + collision-resistant); pick one in the execution plan.

## Collapse mechanics

- **Two independent lineages.** Control-plane and per-firm each get their own single baseline migration capturing that lineage's current schema. They are versioned and loaded separately (as today).
- **Baseline = current schema as one migration.** Generate the baseline from the present drizzle schema (`packages/database/src` per-firm + control-plane schema) — one `CREATE TABLE …` set per lineage — replacing the collapsed `00NN` files and their snapshots. `_journal.json` is reset to the single baseline entry per lineage.
- **Seeds must survive (the known trap).** Several current migrations are hand-written **seed** inserts (role→permission grants, default rows), not schema DDL — e.g. the `tools:*` permission seeds. A naive drizzle re-baseline captures only schema and silently drops these. The baseline must re-express the seed rows (either folded into the baseline, or as a companion post-baseline seed migration with its own timestamp ID). Enumerate every seed migration in the current chain before collapsing and account for each.
- **Verify byte-for-byte schema equivalence.** After collapse, a fresh DB built from the baseline must be schema-identical to one built from the full legacy chain (compare `sqlite_master` / a schema dump). This is the acceptance gate.

## Three touchpoints to change

1. **`drizzle-kit generate` workflow** — emit a timestamp/ULID ID + slug instead of the next zero-padded integer. Drizzle-kit auto-numbers; wrap or post-process generation so new migrations get the monotonic ID and the journal records it.
2. **`migration.ts` journal loader** (`packages/database`) — sort and apply by the monotonic ID (string-ascending works for zero-padded timestamps / ULIDs). Confirm the journal schema carries the ID as the order key, not an implicit integer index.
3. **CI** — any check that assumes dense sequential numbering (gap detection, "next number" lint) is updated or dropped; add a check that IDs are unique and monotonic per lineage.

## Coordination (why this is not a feature-branch change)

Rewriting `_journal.json`, every `meta/*.json` snapshot, and every migration file is the most collision-prone change in the repo. It must be:

- Executed on a branch cut **fresh from `main`**, not a feature branch (and not one that is many commits behind).
- Sequenced when the migration-touching streams are **thinned out** — ideally after the in-flight migration-bearing branches (File Repair, decryption-tool, service-status, and any other) have merged, or with an explicit brief pause coordinated across worktrees.
- Followed by every remaining stream **rebasing onto the new baseline** (their pending migrations re-authored with timestamp IDs).

Because the collapse absorbs in-flight migrations at rebase, feature work does **not** need to wait for it — e.g. File Repair 6b keeps `0036`; the collapse re-expresses it. Nothing is wasted by finishing feature work first.

## Open sub-decisions (resolve in the execution plan)

- Bare timestamp vs ULID for the ID.
- Sub-second uniqueness strategy (millis vs random suffix).
- Seeds folded into the baseline vs a separate timestamped seed migration.
- Whether the loader keeps any human-facing ordinal alongside the ID.
- Exact acceptance comparison (schema dump diff tool).

## Prerequisite

Confirm **no firm has been onboarded** (no per-firm D1 / Durable Object has applied the live chain). The collapse is only free pre-onboarding; after, it becomes a live-data migration and this design does not cover that.

## Next step

When scheduled: run this through a full brainstorm → plan → coordinated execution cycle on its own branch. This note + the ADR are the starting inputs, not a substitute for that plan.
