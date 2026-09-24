---
worktree: (none — this stream runs in a remote checkout)
area: The api worker's internal shape — domain modules with one constructor and a manifest, contract shapes in the domain packages, the HTTP-versus-background seam, and the fitness tests that hold all three
status: building
touches: docs/specs/, docs/decisions/pending, status.d/, roadmap.d/platform.md, changelog.d/, apps/api-worker/src/http/app.ts, apps/api-worker/src/routes, apps/api-worker/src/bindings.ts, apps/api-worker/test, apps/api-worker/CLAUDE.md, apps/api-worker/openapi/openapi.json, packages/api-client/src/types.gen.ts
---

The api worker is 105K lines, three quarters of it a flat directory of 99 route files behind one 1,019-line composition root. This stream designs and then builds its reorganization into domain modules: each domain a directory with one `index.ts` that builds its own sub-app through `createDomainApp()`, registers through the unchanged chokepoint, and is mounted by a short manifest in `app.ts`; a route's request and response shapes moving to `packages/<domain>/src/contract.ts`; `Bindings` leaving `app.ts`; the tree split into an HTTP side and a background side with an import-boundary test between them; and four repo-wide fitness checks that stop the shape regrowing. The design is on the branch first; the build follows it in steps that each leave the emitted contract identical after a key sort.

What a concurrent stream should know: the build steps will move every file under `apps/api-worker/src/http/routes/` and re-emit the snapshot with its paths reordered, so a stream adding a route should expect its file to be relocated on merge and should register through `chokepointMiddleware` as today (the fitness tests assert exactly that). Nothing a caller can observe changes at any step.
