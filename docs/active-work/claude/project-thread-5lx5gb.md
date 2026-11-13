---
worktree: C:/dev/magna-carta-worktrees/claude/project-thread-5lx5gb
area: Playable copy of a video (documents.conversion.av-transcode)
status: building
touches: packages/file-manager/src/playable-copy.ts, packages/database/drizzle/per-firm, apps/api-worker/src/background/conversions, apps/api-worker/src/http/routes/files/playable-copy.ts, packages/object-dimensions, roadmap.d/documents.md
---

The Rust transcode engine is merged (pull request 784). This stream adds the playable copy that
reaches it: a request and status route, the queue producer that streams a version from R2 through
the engine and back, and five columns on `file_version` that record the copy. The video player
thread owns the preview decision and the "prepare a playable copy" button.
