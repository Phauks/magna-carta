---
worktree: C:/dev/magna-carta-worktrees/claude/api-worker-rename
area: Rename apps/worker to apps/api-worker; fold apps/web into apps/web-worker; correct the stale hostname comments
status: review
touches: apps/api-worker, apps/web-worker, packages/design-system, vite.config.ts, package.json, docs/conventions
---

Directory and package renames only. The Cloudflare script names are unchanged (`magna-carta` and
`magna-carta-web`), so nothing in production moves and no Durable Object namespace is affected.

Touches nearly every path reference in the repository, so it collides with any branch open at the
same time. `docs/specs`, `docs/decisions`, `docs/research` and `CHANGELOG.md` deliberately keep the
old paths: they are point-in-time records.
