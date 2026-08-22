---
worktree: .claude/worktrees/agent-a6160780c3c74c784
area: File Manager — design for always-commit ingest (nothing refuses on content) plus the file analysis surface
status: designing
touches: docs/specs, docs/decisions/pending, changelog.d
---

Design only, no code. Writes the spec and ADR draft for the owner's ruling that a completed upload is
always committed — safety and type findings become properties of a committed version, and access
rather than storage becomes the gate. Also designs the matter-scoped file analysis surface and the
recording of the declared-versus-sniffed type disagreement.

Nothing in `packages/file-manager`, `apps/worker` or `apps/web` is edited, so the three File Manager
streams in flight (`claude/file-api-gaps`, `claude/file-api-gaps-build`,
`claude/file-manager-unknowns`) are not blocked by this and will not conflict with it. The spec is
written against `apps/worker` as it stands; `claude/api-worker-rename` is renaming that app, and
whoever builds from this spec should re-check the paths.

The design assumes the weekly re-scan sweep gets a Cron slot, which is `claude/cron-trigger-cap`'s
subject — the sweep is currently attached to no trigger at all, and the spec treats wiring it as a
blocker rather than a follow-up.
