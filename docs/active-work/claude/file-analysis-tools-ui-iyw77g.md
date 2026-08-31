---
worktree: C:/dev/magna-carta-worktrees/claude/file-analysis-tools-ui-iyw77g
area: File Workbench — the Tools surface the ten file capabilities are run from
status: building
touches: apps/web/src/lib/tools/, apps/web/src/routes/(app)/tools/, apps/web/vitest.config.ts, apps/api-worker/src/per-firm-migrations.ts, packages/tools/src/catalog.ts, packages/access-control/src/registry.ts, packages/file-type/src/labels.ts, packages/database/drizzle/per-firm/, roadmap.d/documents.md, status.d/, changelog.d/, docs/decisions/pending/, docs/user/features/, docs/conventions/design-corrections.md, docs/conventions/file-workbench-rulings.md
---

One Tools screen that every file utility is run from, instead of ten screens each asking for the same
bytes: a file is dropped once and Type, Hash, Malware Scan, Metadata, Email, Convert, Repair, Text
Recognition, Unlock and AI Text all address it. Ephemeral by construction — nothing is filed, nothing
has a history.

The capability set is a registry (`apps/web/src/lib/tools/file-workbench/capabilities.ts`); adding one
is a module in `capabilities/` and a line in that array. The Overview is contributed by the modules
rather than hand-written, so it needs no edit when the set grows.

**Overlap to know about:** `claude/focused-cori-b8z77b` is working the matter file manager. This
stream deliberately does not touch `apps/web/src/lib/file-manager/` — the two surfaces are meant to
converge on one body later, and that convergence is a separate piece of work, not this one. The
shared edits here are additive: one permission, one catalog row, one file-type label, one per-firm
seed migration, and four new standing rules appended to `docs/conventions/design-corrections.md`
(nothing existing rewritten there).
