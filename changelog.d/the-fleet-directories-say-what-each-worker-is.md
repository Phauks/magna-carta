---
category: Changed
audience: internal
---

**`apps/worker` is now `apps/api-worker`, and `@magna-carta/worker` is `@magna-carta/api-worker`.**

Thirteen of the fourteen entries under `apps/` name the Worker they hold — `scan-worker`,
`sign-worker`, `status-worker`. One was called `worker`, which said only that it was one of them, and
it happened to be the largest: the API Worker carrying D1, R2, Queues, Durable Objects, the
WebAssembly modules and every runtime secret. A reader arriving at `apps/worker` had to open it to
learn which Worker it was.

Directory and package rename only. **The Cloudflare script name is unchanged** (`magna-carta`), so
nothing in production moves and no Durable Object namespace is affected — but the Workers Builds
dashboard root directory for that project must be repointed to `apps/api-worker` or its next build
cannot find the package. That step is in `docs/deploy-queue.md`.

`apps/web` is left where it is. It is the SvelteKit application, not a Worker, and `apps/web-worker`
is already taken by the assets-only deployable that serves its build output — the two are separate
packages on purpose, and the one that produces the bytes is a dependency of the one that serves them.

`docs/specs`, `docs/decisions`, `docs/research` and the rendered `CHANGELOG.md` keep the old path:
they record what was true when they were written.
