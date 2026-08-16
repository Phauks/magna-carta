---
category: Fixed
audience: internal
---

**`apps/worker`'s 231 test files join the typecheck of record, closing the last hole in it. The one
file that would not type-check in 600 seconds now takes 2, and the cause was not the file: the
`@cloudflare/workers-types` package ships its entire surface twice, and this repository was loading
both copies.**

`@magna-carta/worker` was the single graph member generated with a `tsconfig.test.json` and then held
out of the root test solution, so more than a quarter of the workspace's test corpus was checked by
nothing. Two separate problems stood behind that, and both are gone.

**The 600-second file, and why the standing lead was wrong.** The suspect was the two-parameter
`runInDurableObject(stub, (instance, state) => …)` form, because the one-parameter form next door was
free. Bisecting to a minimal file refuted it: the two-parameter form with `state` contextually typed
checks in 2 s, and a file containing no `runInDurableObject` at all — two variable declarations and
two assignments — still ran past 100 s.

`@cloudflare/workers-types` ships `index.d.ts`, a global script that `"types": [...]` loads, **and**
`index.ts`, a parallel module declaring the same ~16,000 lines with `export` in front of them. The
package publishes no `types`, `main` or `exports` field to redirect the module specifier, so
`import ... from "@cloudflare/workers-types"` resolves to the second copy — `--traceResolution`
confirms it. Both in one program means two distinct declarations of every Workers interface.
Comparing them is merely wasteful for a plain interface and fatal for a generic one: `--generateTrace`
shows variance measurement on `DurableObjectState<Props>` returning `in out (unreliable)`, which
abandons variance and drops the checker into full structural recursion over the mutually recursive
graph beneath it. **Deleting one import took the file from over 600 s to 2 s.**

It is an upstream packaging defect, so the fix here is local and total: inside a package that already
has the globals, never import the module copy. Three sites did — including production source, where
`DurableObjectStub<T>` is generic and the same trap was latent — and
`tooling/lint-workers-types-import.mjs` now fails any that come back.

**And the 156 errors behind it, all fixed at the seam each named** — no `any`, no `@ts-expect-error`,
no production type weakened. 106 were one idiom: `Response.json()` is `Promise<unknown>`, so reading a
field off it is an error. `readJson<T>()` in the worker's existing `test/support/test-auth.ts` makes
each call site name the shape it expects, which is the assertion rather than a formality.

**Four of the remainder were substantive, and are the reason this pass is worth running:**

- **A proxy input type narrower than the port it stands in for.** `ProxyBatchDatabase.batch` demanded
  `ProxySqlStatement[]` while the `BatchDatabase` port it substitutes for promises only
  `SqlStatement[]` — which declares `sql` optional and no `bindings` at all. TypeScript compares
  method parameters bivariantly, so the mismatch was invisible at every call through the port and
  surfaced only on a direct call. It now takes the port shape and checks the two fields it marshals.
- **A fake that had stopped covering a port method.** `narrative-inference`'s recording port exists to
  prove the model is _never_ reached when the gate is off, and implemented four of `InferencePort`'s
  five methods — it could not have proved that for `generateConversation`.
- **Two fakes and a fixture that had lost required fields.** The chokepoint's rate-limiter fakes
  omitted `limit`/`remaining`, which `RateLimitVerdict` publishes on every verdict; the search index
  message fixture omitted `engineGeneration`, which the coordinator compares to decide whether a
  document is already indexed, so that skip branch was being driven with `undefined`.
- **A bundle-manifest fixture in a shape the contract does not accept.** Two tests nested
  `source: { source: "r2", r2Key }` where the entry type flattens the discriminator alongside its
  data, so they described a manifest production never builds.

Also found, and not a production defect: three call sites minting an `Idempotency-Key` with
`newIdentifier("idempotency")`, which is not an entity type — the prefix lookup returned `undefined`
and the header carried a literal `undefined_<token>`. They now use `crypto.randomUUID()` like every
other suite. Separately, `packages/tsconfig/worker.json` moves to `lib: ES2023`, which all ~60
packages already set and workerd has long supported; it was the only preset still on ES2022, and three
tests using `toSorted`/`toReversed` were passing at runtime while failing to compile.

**Cost of the complete graph**, one machine, `.tsbuild` deleted before each cold run: the build half
alone is 1 min 54 s, both roots with the worker still deferred are 2 min 29 s, and the complete graph
is **2 min 41 s** — so 231 more test files cost **12 s (+8%)**, because the test project reads
declarations the build half already emitted. Warm, the pair is 1–2 s, so the inner loop pays nothing.
