---
slug: monotonic-migration-ids
status: Accepted
area: Tenancy & data isolation
date: 2026-07-03
summary: Replace sequential `00NN` schema-migration numbers with monotonic-unique (timestamp-based) migration IDs so parallel branches never collide on a number, and — while still pre-production with no firm onboarded — collapse the existing migration chain (control-plane + per-firm) to one clean baseline per lineage so the new scheme starts fresh rather than retrofitting timestamps onto 35 legacy migrations. Executed as a dedicated, coordinated main-level pass, never on a feature branch.
---

**Monotonic-unique migration IDs, adopted from a collapsed pre-production baseline.**

**Context:** schema migrations are numbered sequentially (`0001`…`0036`) with a
`_journal.json` recording apply-order and a `meta/NNNN_snapshot.json` per migration.
Parallel worktrees routinely both reach for the same next number, so every
migration-bearing branch carries a "renumber `00NN` if another stream merges first"
caveat (the File Repair `0035`/`0036` work is the latest instance). ADRs and the
changelog already removed the analogous collision with fragments assembled on `main`,
but a migration is not an independent fragment: each drizzle snapshot is a schema-diff
against its predecessor, so numbers cannot simply be assigned at merge without
regenerating the trailing snapshot. Timestamp-based (monotonic-unique) migration IDs
are the industry-standard answer to exactly this — Rails, Django, Alembic, and Flyway
all use them so two branches never collide and still apply in a deterministic order.
This repo fits them unusually well: the custom loader (`packages/database` `migration.ts`)
applies migrations in journal order and does not depend on dense sequential integers,
so a timestamp satisfies "ordered" without the density constraint.

Separately, the migration chain is expected to be condensed before real development /
onboarding anyway. Pre-production is the **only** cheap window to do it: once a firm's
per-firm D1 / Durable Object has applied the `00NN` chain, a re-baseline becomes a
live-data migration problem; before any firm is onboarded it is just replacing files
with one baseline. Collapsing now — instead of retrofitting timestamps onto the legacy
sequential set — means the new scheme starts from a clean baseline rather than running
two conventions side by side.

**Decision:** (1) adopt **monotonic-unique, timestamp-based migration IDs** for both the
control-plane and per-firm lineages, replacing sequential `00NN` numbers; (2) **collapse
the existing pre-production migration chain to a single clean baseline per lineage** as
part of the switch, re-expressing the current schema (and its seed data) as the baseline;
(3) perform the collapse as a **dedicated, coordinated `main`-level pass** on a branch cut
fresh from `main`, with the migration-touching streams coordinated (merged or briefly
paused) and then rebased onto the new baseline — **never on a feature branch**, because
rewriting `_journal.json`, every snapshot, and every migration file is the most
collision-prone change in the repo and would manufacture the merge conflict it aims to
remove. Design + rollout: `docs/specs/2026-07-03-monotonic-migration-ids-design.md`.

**Considered and rejected:** keep sequential numbers with renumber-at-merge (the current
friction — a manual step and a snapshot regen on every migration-bearing branch);
slug-on-branch, number-assigned-at-merge like ADR fragments (still needs the trailing
snapshot regenerated against `main` at merge, more moving parts than a timestamp that is
correct the moment it is written); retrofit timestamps without collapsing (leaves 35
legacy `00NN` migrations beside the new scheme — two conventions to reason about forever,
for no benefit while pre-production makes a clean baseline free).

**Consequences:** a one-time collapse touches three points — the `drizzle-kit generate`
workflow (emit a timestamp ID, not the next integer), the `migration.ts` journal loader
(sort/apply by the monotonic ID), and CI — plus a carefully re-expressed baseline that
**preserves the seed rows** the current seed migrations insert (there is a known
"re-baseline loses seeds" trap to design around). After it lands, every new migration is
authored with a timestamp ID and no branch ever renumbers again; in-flight feature work
(including File Repair's `0036` provenance table) is absorbed into the baseline at rebase,
wasting nothing. **Gated on:** no firm onboarded (the pre-production window — confirm before
executing) and a quiescent-enough set of migration streams to coordinate the rebase.
