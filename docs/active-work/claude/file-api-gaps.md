---
worktree: C:/dev/magna-carta-worktrees/claude/file-api-gaps
area: design — four File Manager API contract gaps a file-manager screen cannot work around
status: designing
touches: docs/specs, changelog.d
---

Design only, no product code. One spec at `docs/specs/2026-08-22-file-manager-api-gaps-design.md` covering a `sort` parameter on `files.list`, a restore route plus a deleted-files listing, the scan reason and active-content marker on the wire, and the version author on version history. Nothing under `packages/file-manager`, `apps/api-worker` or `packages/database` is edited by this stream — the spec cites those files, and the branch that builds any of the four will own them.

Overlaps to know about: `claude/ui-file-manager` is the screen these gaps were found from, and this spec is the answer to it. `claude/passive-dev-orchestrator-m7f9jw` owns `roadmap.d/` — the spec reports that `documents.versioning.deleted-lifecycle.trash` reads `shipped` for a capability no route reaches, and deliberately does not edit the ledger to say so.
