---
worktree: .claude/worktrees/agent-a36c224e2fe653a55 (agent worktree)
area: Access control — the twelve registered permissions no role_permission seed grants, and a fitness function for the shape
status: building
touches: packages/database/drizzle/per-firm/, packages/database/drizzle/per-firm/meta/, packages/database/test/, apps/worker/test/, apps/worker/src/editing/CLAUDE.md, packages/access-control/src/registry.ts, packages/tools/CLAUDE.md, tooling/lint-ungranted-permissions/, package.json, roadmap.d/, docs/now.md, docs/now.html, docs/decisions-open.html, status.d/, STATUS.md, STATUS.json, changelog.d/, docs/decisions/pending/
---

The permission registry declares 102 keys; the `role_permission` seeds across
`packages/database/drizzle` grant 90. Twelve are declared and granted to nobody, and there is no
escape hatch: `effectivePermissions` builds the set from role rows plus unexpired direct grants with
no wildcard and no Owner bypass, and nothing in `packages/data-access` writes either table — the
seeds are the whole supply.

Nine of the twelve are a real gap:

- **The co-editing surface** — `documents:edit`, `documents:checkout`, `documents:forceReleaseLock`,
  `documents:reconcile`. Every member gets 403 at the chokepoint on the editor-launch, checkout,
  check-in, reconcile and force-release routes. Shipped 2026-06-22 and unreachable since.
- **Five Tools catalog manifests** — `tools:propertyListings`, `tools:propertyRecords`,
  `tools:businessLookup`, `tools:attorneyLicense`, `tools:shipping`. `toolsByGroup` filters the
  catalogue by permission, so four whole subject groups never render for anybody on `/tools`.

Three are correct: `firm:provision` and `support:mintSession` ride `surface: "public"` routes whose
RBAC gate the chokepoint deliberately skips, and `diagnostics:overview` is held by a diagnostic
support session (`DIAGNOSTIC_PERMISSIONS`), never by a firm role.

Also here: the fitness function for the shape — a permission that gates a member-facing surface and
that no seed grants — measured before it was kept, on the precision bar
`tooling/lint-ledger-staleness/` and `tooling/lint-unwired-writes/` set.

Concurrent streams: `packages/database/drizzle/per-firm/` is a declared overlap with
`claude/auto-file-management` and `claude/unwritable-settings`. Migration ids are timestamped, so
the collision risk is the journal file rather than the SQL. `roadmap.d/` overlaps
`claude/passive-dev-orchestrator-m7f9jw` and `claude/unwritable-settings` — this stream edits
`roadmap.d/auth.md`, `roadmap.d/documents.md` and `roadmap.d/integrations.md` only.
