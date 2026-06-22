# Scan-Service Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use subagent-driven-development (recommended) or executing-plans to implement this task-by-task. Steps use `- [ ]` checkboxes.

**Goal:** Extract the malware-scan engine out of the app worker into its own stateless Cloudflare Worker (`apps/scan-worker`) that owns the `ScanContainer` and answers an internal `POST /scan`, reached from the app worker through a service binding — so signature-refresh deploys decouple from the app, the activation config becomes committable, and the hostile-input engine is isolated.

**Architecture:** The `MalwareScanPort` interface is the service boundary. The app worker's `resolveScanPort` flips from a same-worker container call to a service-binding call (`env.SCAN_SERVICE`); every consumer (ingest consumer, access-rescan, `scan.diagnose`, `scan.matter`) is untouched. The scan worker holds the `containers`/DO/migration config and a thin `POST /scan` proxy plus the warm-poke cron. Deploys run through Workers Builds; the daily signature rebuild is a Cron Trigger that POSTs a Workers Builds Deploy Hook.

**Tech Stack:** TypeScript; Cloudflare Workers + Hono; `@cloudflare/containers`; `@cloudflare/vitest-pool-workers`; Workers Builds + Deploy Hooks.

## Global Constraints

- **Never silently clean** — a scan fault (non-200 / malformed / timeout / unreachable service) is a retryable throw, never a fabricated `clean`/`unscanned`. (Carried verbatim from the scan engine.)
- **Zero runtime egress on the container** — `enableInternet = false` stays; signature freshness is a CI image rebuild, never a runtime `freshclam`.
- **The scan worker is stateless** — no D1/R2/Queues bindings; all firm-scoped logic (cache, verdict recording, staleness) stays in the app worker.
- **The scan worker has no public route** — reachable only via the app's service binding.
- **No GitHub deploy secrets** — Workers Builds (Cloudflare-side) handles auth; the Deploy Hook URL is a Cloudflare Worker secret.
- **Full names, no shorthand** (golden rule 12); **no process-artifact refs in source** (golden rule 13).
- The portable test suite stays green on the dev host; the container's proof is `cargo test` + the EICAR Docker e2e, not the worker pool.

## De-risk findings (spikes run before this plan)

- **R1 (streaming through a service binding):** doc-confirmed — Workers stream multi-GB request bodies within the 128 MB limit *as long as the worker forwards the body without reading it*. The adapter and the proxy both forward (`body` passed straight through, never `.json()`/`.text()` on the request). Task 4 adds an empirical memory check.
- **R2 (the `SCAN_SERVICE` binding in the test pool):** a `services` binding to an *undefined* service makes the workerd test pool refuse to boot (`"no such service is defined"` → zero tests run). Mitigation: register a stub `magna-carta-scan` worker in the `cloudflareTest` config that returns a no-engine `ScanResult`; the pool then boots and `resolveScanPort` observes `unscanned` through the remote path. Validated in Task 2.
- **Deploy/keys:** Workers Builds builds + deploys on git push with no GitHub token. Deploy Hooks (HTTP POST to a unique URL) let a Cron Trigger fire the daily rebuild. The whole pipeline is Cloudflare-native.

---

## File Structure

- `apps/scan-worker/package.json` — new worker package `@magna-carta/scan-worker`.
- `apps/scan-worker/tsconfig.json`, `apps/scan-worker/worker-configuration.d.ts` — types.
- `apps/scan-worker/wrangler.jsonc` — name `magna-carta-scan`; the `containers` + `SCAN_CONTAINER` DO + `v1` migration + the `*/20` warm cron + a daily signature-refresh cron; **no routes, no public bindings**.
- `apps/scan-worker/src/scan-container.ts` — the `ScanContainer` DO (moved from `apps/worker/src/files/scan-container.ts`).
- `apps/scan-worker/src/index.ts` — `fetch` (the `POST /scan` proxy to the container) + `scheduled` (warm-poke + the daily Deploy-Hook POST).
- `apps/scan-worker/src/scan-proxy.ts` — the container-forwarding handler (testable with a fake `Fetcher`).
- `apps/scan-worker/vitest.config.ts` + `apps/scan-worker/test/scan-proxy.test.ts` — the proxy unit test (no container/pool).
- `apps/worker/src/files/scan-port-binding.ts` — re-point `resolveScanPort` to `env.SCAN_SERVICE`; rename the adapter usage.
- `apps/worker/src/files/container-scan-adapter.ts` — keep verbatim (it already takes a `{ fetch(Request) }`); the binding it receives changes.
- `apps/worker/src/app.ts` (`Bindings`) — drop `SCAN_CONTAINER`; add `SCAN_SERVICE: Fetcher`.
- `apps/worker/wrangler.jsonc` — drop the `*/20` warm cron; add `services: [{ binding: "SCAN_SERVICE", service: "magna-carta-scan" }]`.
- `apps/worker/vitest.config.ts` — register the `magna-carta-scan` test stub.
- `apps/worker/src/files/scan-warm.ts` — **delete** (moves to the scan worker).
- `apps/worker/src/index.ts` — drop the `pokeScanContainer` cron branch + the `ScanContainer` re-export.
- `docs/conventions/operations.md` §11 — rewrite for the two-worker model + Workers Builds + Deploy Hook.
- `changelog.d/scan-service-extraction.md` — the changelog fragment.

---

## Task 1: Scaffold `apps/scan-worker` with the container + the `/scan` proxy

**Files:**

- Create: `apps/scan-worker/package.json`, `tsconfig.json`, `wrangler.jsonc`, `src/scan-container.ts`, `src/scan-proxy.ts`, `src/index.ts`, `vitest.config.ts`
- Test: `apps/scan-worker/test/scan-proxy.test.ts`

**Interfaces:**

- Produces: `forwardScan(container: { fetch(request: Request): Promise<Response> }, request: Request): Promise<Response>` in `scan-proxy.ts` — forwards a `POST /scan` request to the container's `/scan`, returning the container response verbatim. The default export's `fetch` calls it with `getContainer(env.SCAN_CONTAINER, "scan")`.

- [ ] **Step 1 — failing test** (`test/scan-proxy.test.ts`): a fake container records the forwarded request and returns a canned `infected` JSON; assert `forwardScan` returns it verbatim and forwarded the body + query.

```ts
import { describe, expect, it } from "vitest";
import { forwardScan } from "../src/scan-proxy.ts";

it("forwards POST /scan to the container and returns its response verbatim", async () => {
  let seen: Request | undefined;
  const container = {
    fetch: async (request: Request) => {
      seen = request;
      return new Response(JSON.stringify({ verdict: "infected", engineVersion: "x", signature: "EICAR" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
  const incoming = new Request("http://scan/scan?size=4&contentType=text/plain", {
    method: "POST",
    body: "abcd",
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  const out = await forwardScan(container, incoming);
  expect(out.status).toBe(200);
  expect(await out.json()).toEqual({ verdict: "infected", engineVersion: "x", signature: "EICAR" });
  expect(new URL(seen!.url).pathname).toBe("/scan");
  expect(new URL(seen!.url).searchParams.get("size")).toBe("4");
});
```

- [ ] **Step 2 — run it, confirm it fails** (`forwardScan` undefined). Run: `pnpm --filter @magna-carta/scan-worker run test scan-proxy`.
- [ ] **Step 3 — scaffold the package.** `package.json` (name `@magna-carta/scan-worker`, the `test`/`emit`/dev scripts mirroring `apps/worker`), `tsconfig.json` extending the repo base. `src/scan-proxy.ts`:

```ts
// Forwards an inbound POST /scan to the scan Container's /scan, response verbatim. The body is passed
// through untouched (never read here), so a multi-GiB scan streams without buffering in this worker.
export async function forwardScan(
  container: { fetch(request: Request): Promise<Response> },
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const target = new Request(`http://scan/scan${url.search}`, {
    method: "POST",
    body: request.body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return container.fetch(target);
}
```

- [ ] **Step 4 — move the DO** `apps/worker/src/files/scan-container.ts` → `apps/scan-worker/src/scan-container.ts` (unchanged class). Write `src/index.ts`:

```ts
import { getContainer } from "@cloudflare/containers";
import { forwardScan } from "./scan-proxy.ts";
export { ScanContainer } from "./scan-container.ts";

export interface Env {
  SCAN_CONTAINER: DurableObjectNamespace<import("./scan-container.ts").ScanContainer>;
  SCAN_BUILD_DEPLOY_HOOK_URL?: string; // the Workers Builds Deploy Hook (a secret); absent until set
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/scan") {
      return forwardScan(getContainer(env.SCAN_CONTAINER, "scan"), request);
    }
    return new Response("not found", { status: 404 });
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (controller.cron === "0 7 * * *") {
      // Daily signature refresh: POST the Deploy Hook so Workers Builds rebuilds the image (fresh
      // freshclam) and redeploys. No-op until the hook secret is set. (Task 5 wires the hook.)
      if (env.SCAN_BUILD_DEPLOY_HOOK_URL !== undefined) {
        ctx.waitUntil(fetch(env.SCAN_BUILD_DEPLOY_HOOK_URL, { method: "POST" }).then(() => undefined));
      }
      return;
    }
    // Warm-poke: keep one instance + clamd's DB resident.
    ctx.waitUntil(getContainer(env.SCAN_CONTAINER, "scan").fetch(new Request("http://scan/ready")));
  },
};
```

- [ ] **Step 5 — write `wrangler.jsonc`** (name `magna-carta-scan`, the `containers` block, the `SCAN_CONTAINER` DO binding, the `v1` migration `{ "tag": "v1", "new_sqlite_classes": ["ScanContainer"] }`, the crons `["*/20 * * * *", "0 7 * * *"]`, `workers_dev: false`, **no `routes`, no `assets`**). Step 6 — `vitest.config.ts` mirroring `apps/worker` but without container bindings (the proxy test uses a fake, no pool service binding). Run the test → green. Step 7 — `wrangler deploy --dry-run` from the package validates the image builds + the DO binds.
- [ ] **Step 8 — commit** `feat(scan-worker): standalone scan service worker (container + /scan proxy + warm cron)`.

## Task 2: App-worker test-pool stub for `SCAN_SERVICE` (R2 mitigation)

**Files:**

- Modify: `apps/worker/wrangler.jsonc` (add the `services` binding), `apps/worker/vitest.config.ts` (register the stub), `apps/worker/src/app.ts` (`Bindings`: add `SCAN_SERVICE: Fetcher`)
- Test: the existing `apps/worker/test/files-routes.test.ts` scan-path tests (must stay green)

**Interfaces:**

- Produces: the app worker test pool boots with `SCAN_SERVICE` bound to an in-pool stub returning `{"verdict":"unscanned","reason":"no-engine","engineVersion":null}`.

- [ ] **Step 1 — add the binding** to `apps/worker/wrangler.jsonc`: `"services": [{ "binding": "SCAN_SERVICE", "service": "magna-carta-scan" }]`, and `SCAN_SERVICE: Fetcher;` to the `Bindings` type (drop `SCAN_CONTAINER` here in Task 3).
- [ ] **Step 2 — run the worker suite, confirm it FAILS to boot** (`"no such service is defined"`) — this reproduces the R2 finding. Run: `pnpm --filter @magna-carta/worker run test files-routes`.
- [ ] **Step 3 — register the stub.** In `apps/worker/vitest.config.ts`, extend the `cloudflareTest` config so the bound `magna-carta-scan` service resolves to a stub worker that returns the no-engine `ScanResult`. Resolve the exact option against the installed `cloudflareTest` API (a `miniflare.workers` auxiliary worker, or a `serviceBindings` function mapping `SCAN_SERVICE`); the stub body:

```ts
// Stub for the magna-carta-scan service binding in tests — no real container under the pool, so the
// remote scan port observes an honest no-engine verdict (matching production before activation).
const SCAN_SERVICE_STUB = () =>
  new Response(JSON.stringify({ verdict: "unscanned", reason: "no-engine", engineVersion: null }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
```

- [ ] **Step 4 — run the suite, confirm the pool boots** and the existing scan-path tests still pass (they will once Task 3 re-points `resolveScanPort`; until then `SCAN_CONTAINER` still drives them, both absent ⇒ `unscanned`). Expected: green.
- [ ] **Step 5 — commit** `test(worker): stub the magna-carta-scan service binding in the test pool`.

## Task 3: Re-point `resolveScanPort` to the service binding; remove the container from the app worker

**Files:**

- Modify: `apps/worker/src/files/scan-port-binding.ts`, `apps/worker/src/app.ts` (`Bindings`), `apps/worker/src/index.ts`, `apps/worker/wrangler.jsonc`
- Delete: `apps/worker/src/files/scan-warm.ts`, `apps/worker/src/files/scan-container.ts`
- Test: `apps/worker/test/files-routes.test.ts` (scan-path: still `unscanned` via the stub)

**Interfaces:**

- Consumes: `SCAN_SERVICE` (Task 2). Produces: `resolveScanPort(env)` returns `containerScanAdapter(env.SCAN_SERVICE)` when `env.SCAN_SERVICE !== undefined`, else `unscannedAdapter`. (`containerScanAdapter` is unchanged — it takes any `{ fetch(Request) }`.)

- [ ] **Step 1 — failing test:** a `resolveScanPort` unit test asserting it returns the remote adapter when `SCAN_SERVICE` is present and `unscannedAdapter` when absent (pass a fake `env`).
- [ ] **Step 2 — run, confirm fail.**
- [ ] **Step 3 — implement.** `scan-port-binding.ts`:

```ts
import { unscannedAdapter, type MalwareScanPort } from "@magna-carta/file-manager/scan-port";
import type { Bindings } from "../app.ts";
import { containerScanAdapter } from "./container-scan-adapter.ts";

// Resolve the active scan engine. The engine lives in the standalone scan-worker (magna-carta-scan),
// reached over the SCAN_SERVICE binding; selected here when the binding is present. Absent in every
// test environment (a service binding to an unavailable service will not boot the pool, so tests bind
// a no-engine stub) and before the scan worker is deployed, where the engine-less adapter runs (an
// honest `unscanned`/no-engine, never a false `clean`).
export function resolveScanPort(env: Bindings): MalwareScanPort {
  if (env.SCAN_SERVICE !== undefined) {
    return containerScanAdapter(env.SCAN_SERVICE);
  }
  return unscannedAdapter;
}
```

Remove the `getContainer` import. In `app.ts` `Bindings`, delete `SCAN_CONTAINER`. In `index.ts`, delete the `pokeScanContainer` cron branch + the `export { ScanContainer }`. In `wrangler.jsonc`, remove `"*/20 * * * *"` from `triggers.crons`. Delete `scan-warm.ts` + `scan-container.ts`.

- [ ] **Step 4 — green** (the suite boots via the stub; scan-path tests see `unscanned`). Run the full worker suite.
- [ ] **Step 5 — commit** `refactor(worker): reach the scan engine over the SCAN_SERVICE binding (engine moved to scan-worker)`.

## Task 4: Streaming validation (R1) + integration smoke

**Files:**

- Test: `apps/worker/test/scan-service-streaming.test.ts`

- [ ] **Step 1 — test:** drive a `scan.diagnose` (or a fake R2 stream) through `resolveScanPort` against the in-pool stub with a multi-MiB body; assert the request completes and the body was not buffered into a single allocation (the stub reads the body length incrementally and echoes a byte count; assert the count equals the input size). This exercises the forward-without-read path end to end in the pool.
- [ ] **Step 2 — run, confirm the streamed body arrives intact.**
- [ ] **Step 3 — note for production:** the resident-memory check on a real 2 GiB scan is a deploy-time observation (the container mmaps; the workers forward) — record it in the operations runbook as an activation acceptance check, not a unit test.
- [ ] **Step 4 — commit** `test(worker): streamed body survives the scan service hop intact`.

## Task 5: Deploy pipeline — Workers Builds + the daily Deploy-Hook cron

**Files:**

- Modify: `docs/conventions/operations.md` §11 (rewrite), `apps/scan-worker/src/index.ts` (the cron branch already added in Task 1)
- Create: `changelog.d/scan-service-extraction.md`

- [ ] **Step 1 — rewrite operations.md §11** for the two-worker model: (a) the scan worker is connected to Workers Builds in the Cloudflare dashboard (its own Worker connection) — push to `main` builds + deploys it, no GitHub token; (b) the daily signature rebuild is the scan worker's `0 7 * * *` cron POSTing `SCAN_BUILD_DEPLOY_HOOK_URL` (a Workers Builds Deploy Hook, set with `wrangler secret put SCAN_BUILD_DEPLOY_HOOK_URL` on the scan worker); (c) the app worker no longer carries the container — its deploy is unchanged; (d) acceptance: EICAR via `POST /api/v1/scan/diagnose` against production returns `infected`, and the 2 GiB resident-memory check.
- [ ] **Step 2 — changelog fragment** describing the extraction + the Cloudflare-native auto-update pipeline.
- [ ] **Step 3 — commit** `docs(scan): two-worker deploy model + daily Deploy-Hook signature refresh`.

## Task 6: First activation (owner-driven, documented — not code)

- [ ] Connect `apps/scan-worker` to Workers Builds (dashboard); push triggers the first build + deploy of the scan service.
- [ ] `wrangler secret put SCAN_BUILD_DEPLOY_HOOK_URL` on the scan worker (the Deploy Hook URL from its Workers Builds settings).
- [ ] Deploy the app worker (so `SCAN_SERVICE` binds the now-live scan service).
- [ ] EICAR smoke: an authenticated `POST /api/v1/scan/diagnose` with EICAR bytes returns `infected`.
- [ ] Confirm the `0 7 * * *` cron fires a rebuild the next day (Workers Builds history shows a Deploy-Hook-triggered build).

---

## Self-review

- **Spec coverage:** the service boundary (Task 3), the scan worker + proxy + crons (Task 1), the committable-config-via-stub correction (Task 2), streaming/R1 (Task 4), the Cloudflare-native deploy + daily refresh (Tasks 5–6), security posture (no public route + stateless, enforced by the scan-worker wrangler in Task 1) — all covered.
- **Open implementation detail:** the exact `cloudflareTest` stub option (Task 2 Step 3) is resolved against the installed API at implementation time; the deliverable ("pool boots with a no-engine `SCAN_SERVICE`") is concrete and testable.
- **Type consistency:** `forwardScan(container, request)`, `resolveScanPort(env) -> MalwareScanPort`, `SCAN_SERVICE: Fetcher`, the `ScanResult` no-engine shape `{verdict:"unscanned",reason:"no-engine",engineVersion:null}` are used identically across Tasks 1–4.
