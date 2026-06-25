---
category: Added
---

**Auto-clean of build artifacts on merge to `main`**: a tracked `post-merge` git hook runs `vp run clean`, which sweeps regenerable build output (`target/`, `.svelte-kit/`, `.wrangler/`, `.vite/`, `dist/`, `build/`, `coverage/`) from worktrees whose branch is merged into `main` and prunes dangling Docker build cache and image layers. Deletion is **git-ignored-only** (each candidate is confirmed with `git check-ignore`) and never touches the active worktree, `node_modules`, tracked source, or the worktree/branch themselves. Activate once per clone with **`vp run setup-hooks`**; run on demand with `vp run clean` (preview via `node tooling/clean/index.mjs --dry-run`, or sweep every non-current worktree with `--all-worktrees`). This stops dead build artifacts from filling the dev disk.
