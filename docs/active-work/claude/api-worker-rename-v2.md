---
worktree: C:/dev/magna-carta-worktrees/claude/api-worker-rename-v2
area: Rename apps/worker to apps/api-worker so the directory says which Worker it holds
status: review
touches: apps/api-worker, tooling/affected-lint, tsconfig.build.json, tsconfig.test.json, docs/conventions
---

Directory and package rename only: `apps/worker` becomes `apps/api-worker`, `@magna-carta/worker`
becomes `@magna-carta/api-worker`. The Cloudflare script name is unchanged (`magna-carta`), so
nothing in production moves and no Durable Object namespace is affected.

`apps/web` is deliberately left alone. An earlier attempt at this rename also folded it into
`apps/web-worker`, which was free when that attempt was written and is not free now: `apps/web-worker`
is the assets-only deployable that serves the SPA's build output, and `apps/web` is the sibling
package that produces it. Collapsing them destroys `@magna-carta/web` — the package
`apps/web-worker`'s own build script builds first — and leaves a directory named for a Worker holding
Svelte source, which is the opposite of what this rename is for. The naming rule applies to Workers;
`apps/web` is not one.

Touches nearly every path reference in the repository, so it collides with any branch open at the
same time. `docs/specs`, `docs/decisions`, `docs/research` and `CHANGELOG.md` deliberately keep the
old paths: they are point-in-time records.
