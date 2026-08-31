---
category: Fixed
audience: internal
---

**Production deploys stopped failing Worker validation: the app worker's entrypoint no longer
spends the startup budget.** Every deploy after the route count grew past a threshold failed with
error 10021 ("Script startup exceeded CPU time limit"), leaving `main` merged but undeployed. The
cost was the aggregate of the entrypoint's static import graph — every route module builds its zod
schemas and OpenAPI metadata at module scope. `src/index.ts` now keeps only the Durable Object
class re-exports (the one thing that must be synchronous at startup) and reaches the Hono app, the
Cron pass router, and the queue router through one dynamic import of the new
`src/event-dispatch.ts`, which the runtime evaluates on the first event instead of at validation:
roughly 1.5 s of local startup work became 0.24 s under `wrangler check startup`. The rule is
recorded in `docs/conventions/build-performance.md` (a Worker entrypoint keeps no static imports
beyond its Durable Object exports; measure entrypoint changes with `wrangler check startup`).
