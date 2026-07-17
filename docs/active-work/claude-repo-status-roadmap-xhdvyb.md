---
branch: claude/repo-status-roadmap-xhdvyb
worktree: (remote session — no local worktree path)
area: slice 2·4 close-out step 1 — per-engine dispatch seam + tracking refresh
status: building
touches: apps/worker/src/conversions/, apps/convert-worker/src/, apps/worker/CLAUDE.md, ROADMAP.md (2·4 bullet), status.d/2-4-in-app-conversion.md, changelog.d/
---

Implements the per-engine dispatch seam the conversion consumer flagged (each hop resolves its own
engine by id; the convert worker dispatches on `x-engine-id`), and refreshes the stale 2·4 tracking
entries (ROADMAP bullet + status fragment) to reflect that sub-slices 2·4a–e are built. No engine
Containers are added here — LibreOffice/email/FFmpeg remain deferred pending their design cycles.
Concurrent streams should not edit `apps/worker/src/conversions/` or `apps/convert-worker/` while
this is in flight.
