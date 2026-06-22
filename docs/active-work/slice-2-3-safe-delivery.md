---
branch: slice-2-3-safe-delivery
worktree: C:/dev/magna-carta (in-place; build complete)
area: Slice 2·3 — inline preview + safe-delivery sandbox (backend-only)
status: built — pending full-branch review and merge
touches: docs/specs/, docs/decisions/pending/, packages/database/src/per-firm-schema.ts, packages/file-manager/src/{queries.ts,preview-policy.ts,safe-rendition-port.ts}, apps/worker/src/routes/files.ts, apps/worker/src/files/preview-token.ts, apps/worker/src/app.ts, apps/worker/wrangler.jsonc (FILES_ORIGIN is a public hostname → the `vars` block, NOT `.dev.vars`), docs/conventions/security.md, STATUS.md, ROADMAP.md, changelog.d/slice-2-3-safe-delivery.md
---

Slice 2·3 backend — the safe-delivery sandbox for inline file preview (video-first) plus the
`inline_playable` verdict seam. Backend-only; the Vidstack player + preview surface defer to the
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

**Desktop transport invariant (forward dependency for the 0·7a/0·7b player slice):** the
`/api/files-preview/{token}` cookieless serving route is designed for real HTTP(S) on both web and
desktop. It MUST NOT be routed through a `tauri://` custom-scheme proxy when the Tauri desktop shell
is built — `tauri://` scheme transports do not honor HTTP Range, which would silently kill scrubbing
and seeking in the `<video>` player. Desktop config must bind the files-preview origin to a real
HTTPS (or localhost HTTP) URL, not a custom-scheme handler. The player slice (0·7a/0·7b) owns
enforcing this; it is recorded here so a future desktop config change cannot silently strand it.

Build complete: all 15 tasks committed. Touch list above is final.
