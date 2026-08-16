---
category: Fixed
audience: internal
---

**The typecheck of record now reads the test files. Every graph member gains a generated,
non-emitting `tsconfig.test.json` beside its `tsconfig.build.json`; the 53 errors that surfaced are
fixed at the seam each one names, and `apps/worker` is deferred with its measurement rather than
quietly skipped.**

**What was open.** The gap the previous pass measured and documented rather than closed: the member
projects are `composite` + `emitDeclarationOnly` with `rootDir: "src"`, a file outside `rootDir`
cannot take part in that emit, so the generated build configs replace each package's own `include`
with `src/**/*.ts`. Nothing else filled it — `vp check` runs with `typeCheck: false` and Vitest strips
types — so 885 of the workspace's 2,118 type-checkable files were checked by no pass in
`pnpm check`, `pnpm check:scoped`, or CI.

**The mechanism is a second project, not a wider one.** `tooling/tsconfig-refs` now emits a
`tsconfig.test.json` per member: `composite`, because a solution file can only reference composite
projects, and `noEmit`, because no consumer imports a test — which is precisely what frees it from the
`rootDir` the build project needs. It references the package's **own** build project first and then
the same dependency build projects, so `../src/thing.ts` and `@magna-carta/thing` alike resolve to
declarations `tsc -b` already produced and no source is checked twice. Its `include` is **derived**,
never restated: the package's own `include` minus `src/**` and minus `.svelte`, plus the ambient
`.d.ts` from the package root and from `src/`. That leaves an invariant worth naming — the two
generated projects together cover exactly what the package's own `tsconfig.json` declares — and it
needs no new gate, because `node tooling/tsconfig-refs/index.mjs --check` already diff-gates both
files. A root `tsconfig.test.json` collects the members and `vp run typecheck` builds both roots.

**The 53 errors are fixed where they point, and nothing is silenced.** No `any`, no
`@ts-expect-error`, no production type widened to make a test compile. They fell into recognisable
shapes: hand-rolled database doubles missing `SqlStatement.first`
(`@magna-carta/magnus`, 10 — the largest single group); fixture literals that had lost a field the
production type gained, in `@magna-carta/conflicts` (a policy round-trip that had stopped covering
`candidateCap`, now supplied and asserted), `@magna-carta/custodian` and `@magna-carta/locations`;
possibly-undefined indexed reads in `@magna-carta/email`, `@magna-carta/conflicts` and
`@magna-carta/pdf`, narrowed where the test already proves the value is there; casts that fought the
real type in `@magna-carta/document-assembly` and `@magna-carta/search`, replaced by a shared
narrowing helper and by typing an in-memory stub against the port's own input types; a `"EUR"` string
where `@magna-carta/trust` wanted a currency, built with `currencyFromCode` the way production does;
and a `string` in `@magna-carta/billing` that had lost its `MatterId` brand to a helper's own return
annotation.

**Three sibling workers were under-declaring what they contain, which is why their tests would not
resolve.** `apps/status-worker` had no `worker-env.d.ts` — the file its seven sibling worker apps all
carry — so `cloudflare:test` was unresolvable in its own tests; it has one now, plus the `?raw`
declaration for the Wrangler-config read, in the `test/support/` shape `apps/worker` established.
`apps/scan-worker`'s shard test read its Wrangler config through `node:fs` in a package typed for
workerd; it now imports the same text through `?raw`, which is both what the other workers do and
closer to how the worker itself is built. `apps/sign-worker`'s `.wasm` ambient declaration lives in
`src/`, which the generator now includes in the test project for exactly this reason.

**One member is deferred, named, and measured — and the reason is not that it is big.**
`@magna-carta/worker` gets its test project like everything else and is checkable on demand, but is
held out of the root solution by `DEFERRED_TEST_PROJECTS`, for two findings that only surfaced
because the question was finally asked. **One file does not type-check at all**:
`test/firm-database/firm-database-migration-partial-failure.test.ts` does not finish in 600 seconds
on its own, with memory flat at ~2 GB, while its 26 batch-neighbours cost 2–3 s each — the batch
holding it drops from over fifteen minutes to 4.2 s when it alone is removed. **And the backlog
behind it is 156 errors**: the other 234 files check in 38.9 s in batches of 28, and 89 of the 156
are one repeated idiom, an unchecked `await response.json()` read as `unknown`, concentrated in the
route suites (`trust-authorization-routes` 22, `billing-routes` 16, `trust-routes` 15). That is a
burn-down of its own size, not a tail on this one. Its test files remain checked by nothing in the
meantime, which is stated in `docs/conventions/build-performance.md` rather than implied.

**Cost, measured both ways.** With every `.tsbuild` deleted, the build half alone is **1 min 32 s**
and both roots together are **1 min 53 s** — the test half is 24 s of that, and it is 42% more files.
Warm, the pair is **1.1 s** against 1.0 s before, so `pnpm check:scoped` keeps the whole graph and
pays nothing on the common path. The CI gate's existing `.tsbuild` cache already covers the new
`.tsbuildinfo` files, so no workflow change was needed.
