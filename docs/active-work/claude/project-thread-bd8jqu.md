---
worktree: (none — this stream runs in a remote checkout)
area: Build, test and type-check memory — api-worker tests split into a plain-Node project, root test worker ceiling, explicit tsc heap
status: review
touches: apps/api-worker/vitest.config.ts, apps/api-worker/vitest.node.config.ts, apps/api-worker/vitest.plugins.ts, apps/api-worker/vitest.node-runtime.ts, apps/api-worker/test, apps/api-worker/CLAUDE.md, vite.config.ts, docs/conventions/build-performance.md, changelog.d/
---

Measured where building, testing and type-checking spend memory, and cut the largest share: api-worker test files that never reach the Workers runtime now run in plain Node. A stream editing `apps/api-worker/vitest.config.ts` should know its plugins moved to `vitest.plugins.ts`.
