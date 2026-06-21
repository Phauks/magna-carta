---
branch: slice-2-3-safe-delivery
worktree: C:/dev/magna-carta (in-place; design cycle)
area: Slice 2·3 — inline preview + safe-delivery sandbox (backend-only)
status: designing
touches: docs/specs/, docs/decisions/pending/, packages/database/src/per-firm-schema.ts, packages/file-manager/src/{queries.ts,preview-policy.ts,safe-rendition-port.ts}, apps/worker/src/routes/files.ts, apps/worker/src/files/preview-token.ts, apps/worker/src/app.ts, apps/worker/wrangler.jsonc, apps/worker/.dev.vars, docs/conventions/security.md, STATUS.md, ROADMAP.md
---

Slice 2·3 design cycle: the backend safe-delivery sandbox for inline file preview (video-first) plus
the `inline_playable` verdict seam. Backend-only — the Vidstack player + preview surface defer to the
0·7a/0·7b UI track. Gates on nothing.

**Build-time overlap hazard with slice 2·1 (the live, built-but-unmerged worktree at
`C:/dev/magna-carta-2-1-dev`, which has no active-work note of its own):** 2·1 is rewriting
`packages/file-manager/src/ingest-core.ts` and owns `file_version` scan-detail migrations.
`vp run worktrees` will NOT surface that overlap. This stream therefore: **never edits
`ingest-core.ts`** (the verdict compute hook is deferred to the 2·1 rebuild / player / Reports — whichever
reads the column first); lands all `packages/file-manager` changes **additively** (a new exported
read, a new `preview-policy.ts`, a new `safe-rendition-port.ts`); and adds the `inline_playable` column
on `main` ahead of the worktrees with the **migration numbered at land time** (`0013` is taken by 1·4;
next free is `0014`, but a parallel stream may claim it — anchor on the column name, gate on
`vp run worktrees`). Before touching anything under `packages/file-manager/`, sync `main` and manually
diff `queries.ts`/`per-firm-schema.ts` against the 2·1 worktree.

Currently: design only (spec + two pending ADR fragments). No code yet.
