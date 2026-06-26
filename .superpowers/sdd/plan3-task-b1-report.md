# Plan 3 Task B1 Report — `apps/bundle-worker` scaffold

## What was created

Seven files in `apps/bundle-worker/`:

| File | Purpose |
|------|---------|
| `src/bundle-container.ts` | `BundleContainer extends Container` — port 8080, 10m sleep, no internet |
| `src/forward-build.ts` | `forwardBuild(request, container)` — POST /build proxy with `duplex:"half"` + `AbortSignal.timeout(5m)` backstop; 404 for non-POST or non-/build |
| `src/outbound-r2.ts` | `handleBundleR2(request, r2)` — GET streams object body (404 miss), PUT stores body (200), 405 otherwise |
| `src/index.ts` | `Bindings` type, re-exports `BundleContainer`, sets `BundleContainer.outboundByHost["bundle-r2"]` → `handleBundleR2`, default fetch routes POST /build → `forwardBuild`, scheduled warm-poke cron |
| `worker-env.d.ts` | Augments `Cloudflare.Env extends Bindings` (mirrors scan-worker) |
| `wrangler.jsonc` | `magna-carta-bundle`, `standard-2`/5 containers, `BundleContainer` DO migration, `R2` bucket binding, `*/8 * * * *` cron, observability |
| `package.json` / `tsconfig.json` / `vitest.config.ts` | Mirror scan-worker exactly |

## TDD evidence

Targeted command: `pnpm --filter @magna-carta/bundle-worker run test test/forward-build.test.ts`

```
Test Files  1 passed (1)
     Tests  10 passed (10)
  Duration  514ms
```

Tests split across two `describe` blocks:

- `forwardBuild` (6 tests): forwards POST /build (JSON response), forwards POST /build?stream=1 (binary passthrough), 404 for non-POST, 404 for non-/build path, propagates non-200 status, captures query string
- `handleBundleR2` (4 tests): GET hit streams stored object, GET miss → 404, PUT stores body → 200, unsupported method → 405

TypeScript: `tsc --noEmit` clean. `pnpm install` completed and linked the new workspace package.

## outbound-handler approach

`BundleContainer.outboundByHost` is a static setter on the `Container` base class (signature: `Record<string, OutboundHandler<E>>`). The handler receives `(request: Request, env: Cloudflare.Env, ctx: OutboundHandlerContext)`. Because the static setter's generic defaults to `Cloudflare.Env` and our `worker-env.d.ts` declares `Cloudflare.Env extends Bindings`, the cast `env as unknown as Bindings` is only needed as a narrowing step — the types are structurally compatible at deploy time.

The handler was extracted to `src/outbound-r2.ts` so it can be unit-tested independently with a fake `R2Bucket` (in-memory map), and imported into `index.ts` for registration.

## Deploy-gated concerns

- **`containers/bundle/Dockerfile` does not exist yet** — it is a Plan 2 deliverable. The wrangler dry-run fails for this reason only; all worker code is correct. The `instance_type: "standard-2"` is a placeholder sized for heavy archive builds — confirm available types against the Cloudflare containers dashboard before deploy.
- **`r2_buckets.bucket_name: "magna-carta-files"`** — matches the expected firm-files bucket; confirm the exact bucket name before deploy.
- **`BundleContainer.outboundByHost` registration** — the runtime wiring (container intercepting `http://bundle-r2/*` and routing to this handler) is a Cloudflare containers platform feature that cannot be exercised in the local test pool; correctness of the handler logic is verified by the unit tests.
