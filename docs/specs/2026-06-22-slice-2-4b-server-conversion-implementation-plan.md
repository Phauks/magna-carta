# Slice 2·4b — Server Conversion Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-side conversion orchestrator — a tracked job (Durable Object) + a queue consumer that runs a libvips Container and returns a downloadable result — exposed via the general File Converter Tool's transient route (convert → download, no matter).

**Architecture:** Mirrors 2·1/bulk-download exactly. `POST /api/v1/conversions/upload` presigns a transient R2 PUT; `POST /api/v1/conversions` creates a `ConversionJob` Durable Object (the `BundleBuildCoordinator` pattern) and enqueues a `CONVERSION` message; the queue consumer (the `bundle-consumer` pattern) resolves the engine `ConversionPort`, runs the conversion, writes the result to transient R2, and marks the job done; `GET /api/v1/conversions/:jobId` reports status and, when done, a freshly-presigned GET URL (the `bundle-status` pattern). The libvips Container mirrors `ScanContainer`; the real image is a deploy-time activation, so tests inject a fake `ConversionPort`.

**Tech Stack:** Cloudflare Workers + Hono + `@hono/zod-openapi`, Durable Objects (`cloudflare:workers`), Queues, R2, `@cloudflare/containers`, Vitest (Workers pool / Miniflare), `@magna-carta/conversion`.

## Global Constraints

- **In-house only, one engine per edge** — reuse `@magna-carta/conversion` (`findPath`, `runConversion`/`executePath`, `ConversionPort`); no new engine selection logic.
- **Every route through the ADR-0067 chokepoint** (`chokepointMiddleware` + a `RouteMeta`); `tools:fileConverter` permission; firm-scoped — a cross-firm job id resolves to **404**, never 403/leak (the 2·3 isolation rule).
- **Untrusted bytes:** the Container runs `enableInternet: false`; the converter is an untrusted-bytes boundary (consistent with 2·1 scanning / 2·3 safe-delivery).
- **The engine Container cannot run under the local test pool** — there is no test-environment Container binding; tests inject a fake `ConversionPort` via the `resolveLibvipsPort` seam (the `resolveScanPort` precedent). The real image + wrangler `containers` binding is a deploy-time step, OUT of this plan.
- **Full names, no shorthand; no process-ref strings in source (golden rule 13);** `.ts` import extensions; `import type` for type-only imports.
- **TDD; commit after each green step.** Conventional commits, scope `conversions`.
- **Transient R2 keys** are server-minted, job-scoped, firm-isolated: `conversions/<firmId>/<jobId>/source` and `.../result`. An R2 lifecycle rule (deploy-time, documented) expires the `conversions/` prefix after 24h.

## File structure (all new unless noted)

```
apps/worker/src/conversions/
  conversion-types.ts        Job state, queue message, DO RPC interface (the bundle-types pattern)
  conversion-coordinator.ts  ConversionJob Durable Object (the bundle-coordinator pattern)
  libvips-container.ts       LibvipsContainer extends Container (the scan-container pattern)
  conversion-engine.ts       resolveLibvipsPort seam + the Container ConversionPort adapter
  conversion-consumer.ts     CONVERSION queue consumer (the bundle-consumer pattern)
apps/worker/src/routes/
  conversions.ts             POST /conversions/upload, POST /conversions, GET /conversions/:jobId
apps/worker/src/app.ts       (modify) export the DO; register the routes; route CONVERSION in queue()
apps/worker/wrangler.jsonc   (modify) CONVERSION queue + dead-letter; CONVERSION_JOB durable_object
apps/worker/test/
  conversion-coordinator.test.ts
  conversion-consumer.test.ts
  conversions-routes.test.ts (e2e)
```

---

### Task 1: Conversion job types

**Files:**

- Create: `apps/worker/src/conversions/conversion-types.ts`

**Interfaces:**

- Produces: `ConversionJobStatus`, `ConversionJobState`, `ConversionMessage`, `ConversionCoordinator` (the DO RPC surface).

- [ ] **Step 1: Write the types** (no test — pure type module, exercised by Tasks 2/4)

```ts
// apps/worker/src/conversions/conversion-types.ts
import type { FormatId } from "@magna-carta/conversion/format";

// The job state the coordinator Durable Object persists; the queue message the consumer reads; the DO
// RPC surface the routes + consumer call. One home so they never drift on field names (bundle-types
// precedent).
export type ConversionJobStatus = "queued" | "running" | "done" | "failed";

export interface ConversionJobState {
  readonly status: ConversionJobStatus;
  readonly resultKey: string | null; // set when done
  readonly mediaType: string | null; // set when done — the converted file's media type
  readonly reason: string | null; // a typed ConversionResult reason or an error string, when failed
}

export interface ConversionMessage {
  readonly firmId: string;
  readonly jobId: string;
  readonly sourceKey: string;
  readonly resultKey: string;
  readonly from: FormatId;
  readonly to: FormatId;
}

export interface ConversionCoordinator {
  start(message: ConversionMessage): Promise<ConversionJobState>; // persists queued + enqueues once
  markRunning(): Promise<void>;
  markDone(resultKey: string, mediaType: string): Promise<void>;
  markFailed(reason: string): Promise<void>;
  status(): Promise<ConversionJobState>;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/worker/src/conversions/conversion-types.ts
git commit -m "feat(conversions): job state + queue message + coordinator types"
```

---

### Task 2: The `ConversionJob` Durable Object

**Files:**

- Create: `apps/worker/src/conversions/conversion-coordinator.ts`
- Test: `apps/worker/test/conversion-coordinator.test.ts`

**Interfaces:**

- Consumes: `ConversionMessage`, `ConversionJobState`, `ConversionCoordinator` from `conversion-types.ts`; `Bindings` from `../app.ts` (has `CONVERSION: Queue<ConversionMessage>` after Task 7).
- Produces: `export class ConversionJob extends DurableObject<Bindings> implements ConversionCoordinator`.

Read `apps/worker/test/bundle-coordinator.test.ts` first — copy its Workers-pool DO test setup (`runInDurableObject` / the `cloudflare:test` harness) verbatim; only the assertions change.

- [ ] **Step 1: Write the failing test** (mirror `bundle-coordinator.test.ts`'s harness)

Cover: `start` persists `queued`, arms an alarm, and calls `env.CONVERSION.send` exactly once; a second `start` is a no-op that returns the existing state; `markRunning` → `running`; `markDone(key, mediaType)` → `done` with `resultKey`/`mediaType` and clears the alarm; `markFailed(reason)` only transitions a non-terminal job (a zombie `markFailed` after `done` is dropped); `status` of an unknown job returns `failed`/"unknown job"; the `alarm()` fails a still-`running`/`queued` job ("conversion timed out"). Use a fake `CONVERSION` queue that records `send` calls.

- [ ] **Step 2: Run it — verify it fails** (`Cannot find module '../src/conversions/conversion-coordinator.ts'`)

Run: `pnpm --filter @magna-carta/worker test conversion-coordinator`

- [ ] **Step 3: Implement** (transpose `bundle-coordinator.ts`)

```ts
// apps/worker/src/conversions/conversion-coordinator.ts
import { DurableObject } from "cloudflare:workers";
import type { Bindings } from "../app.ts";
import type {
  ConversionCoordinator,
  ConversionJobState,
  ConversionMessage,
} from "./conversion-types.ts";

// The single-flight coordinator for one conversion job, keyed firmId:jobId. start() persists `queued`,
// arms a stuck-job alarm, and enqueues the work exactly once; the consumer reports back through
// markRunning/markDone/markFailed; the alarm fails a job that never reports completion. The DO is the
// serialization point (bundle-coordinator precedent).
const STUCK_DEADLINE_MS = 10 * 60 * 1000;

const UNKNOWN: ConversionJobState = {
  status: "failed",
  resultKey: null,
  mediaType: null,
  reason: "unknown job",
};

export class ConversionJob extends DurableObject<Bindings> implements ConversionCoordinator {
  async start(message: ConversionMessage): Promise<ConversionJobState> {
    const existing = (await this.ctx.storage.get<ConversionJobState>("state")) ?? null;
    if (existing !== null) return existing; // idempotent submit
    const state: ConversionJobState = {
      status: "queued",
      resultKey: null,
      mediaType: null,
      reason: null,
    };
    await this.ctx.storage.put("state", state);
    await this.ctx.storage.setAlarm(Date.now() + STUCK_DEADLINE_MS);
    await this.env.CONVERSION.send(message);
    return state;
  }

  async markRunning(): Promise<void> {
    const state = await this.ctx.storage.get<ConversionJobState>("state");
    if (state === undefined || state.status !== "queued") return;
    await this.ctx.storage.put("state", { ...state, status: "running" });
  }

  async markDone(resultKey: string, mediaType: string): Promise<void> {
    const state = await this.ctx.storage.get<ConversionJobState>("state");
    if (state === undefined || (state.status !== "running" && state.status !== "queued")) return;
    await this.ctx.storage.put("state", {
      status: "done",
      resultKey,
      mediaType,
      reason: null,
    });
    await this.ctx.storage.deleteAlarm();
  }

  async markFailed(reason: string): Promise<void> {
    const state = await this.ctx.storage.get<ConversionJobState>("state");
    // A success is terminal; a stale failure from a zombie/retried attempt must not clobber `done`.
    if (state === undefined || state.status === "done" || state.status === "failed") return;
    await this.ctx.storage.put("state", { ...state, status: "failed", reason });
    await this.ctx.storage.deleteAlarm();
  }

  async status(): Promise<ConversionJobState> {
    return (await this.ctx.storage.get<ConversionJobState>("state")) ?? UNKNOWN;
  }

  override async alarm(): Promise<void> {
    const state = await this.ctx.storage.get<ConversionJobState>("state");
    if (state !== undefined && (state.status === "queued" || state.status === "running")) {
      await this.ctx.storage.put("state", {
        ...state,
        status: "failed",
        reason: "conversion timed out",
      });
    }
  }
}
```

- [ ] **Step 4: Run it — verify it passes.** Run: `pnpm --filter @magna-carta/worker test conversion-coordinator`
- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/conversions/conversion-coordinator.ts apps/worker/test/conversion-coordinator.test.ts
git commit -m "feat(conversions): ConversionJob durable object"
```

---

### Task 3: The libvips Container + the `ConversionPort` seam

**Files:**

- Create: `apps/worker/src/conversions/libvips-container.ts`
- Create: `apps/worker/src/conversions/conversion-engine.ts`

**Interfaces:**

- Consumes: `Bindings` (`LIBVIPS_CONTAINER?: DurableObjectNamespace` — optional, deploy-time); `ConversionPort` from `@magna-carta/conversion/port`.
- Produces: `class LibvipsContainer extends Container`; `function resolveEnginePort(env: Bindings): ConversionPort` (returns the Container-backed adapter when the binding is present, else a port whose `convert` returns `{ ok: false, reason: "engine-not-implemented" }`).

Read `apps/worker/src/files/scan-container.ts` and `scan-port-binding.ts` first — mirror their class + resolver shape.

- [ ] **Step 1: Write `libvips-container.ts`** (mirror `ScanContainer`)

```ts
// apps/worker/src/conversions/libvips-container.ts
import { Container } from "@cloudflare/containers";

// The native-libvips conversion Container: a tiny HTTP service that takes the source bytes + the target
// recipe and returns the converted bytes. enableInternet is off — it processes untrusted file bytes and
// must not egress (the cross-cutting untrusted-input posture). The warm-poke cron hits `ready`. Wiring
// the real image (wrangler `containers` binding + the image build) is a deploy-time step; under the
// local test pool there is no binding and resolveEnginePort returns the deferred port instead.
export class LibvipsContainer extends Container {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "30m";
  override enableInternet = false;
  override pingEndpoint = "ready";
}
```

- [ ] **Step 2: Write the engine seam `conversion-engine.ts`**

```ts
// apps/worker/src/conversions/conversion-engine.ts
import {
  type ConversionPort,
  type ConversionResult,
  adapterError,
  converted,
  engineNotImplemented,
} from "@magna-carta/conversion/port";
import type { Bindings } from "../app.ts";

// The Container-backed ConversionPort: POST {recipe + bytes} to the libvips Container, read back the
// converted bytes + media type. Never throws — a Container/transport failure maps to adapter-error
// (the integrations Dispatch discipline).
function containerPort(namespace: DurableObjectNamespace): ConversionPort {
  return {
    async convert(input): Promise<ConversionResult> {
      try {
        const container = namespace.get(namespace.idFromName("libvips"));
        const response = await container.fetch("https://libvips/convert", {
          method: "POST",
          headers: { "x-target-format": input.to, "x-recipe": input.recipeRef },
          body: input.bytes,
        });
        if (!response.ok) return adapterError(`libvips container ${response.status}`);
        const mediaType = response.headers.get("content-type") ?? "application/octet-stream";
        return converted(new Uint8Array(await response.arrayBuffer()), mediaType);
      } catch (error) {
        return adapterError(error instanceof Error ? error.message : "libvips container error");
      }
    },
  };
}

// The deferred port for environments without the Container binding (the local test pool, and prod until
// the image is deployed): every conversion is engine-not-implemented. Tests inject their own fake port.
const deferredPort: ConversionPort = {
  convert: () => Promise.resolve(engineNotImplemented()),
};

export function resolveEnginePort(env: Bindings): ConversionPort {
  return env.LIBVIPS_CONTAINER === undefined ? deferredPort : containerPort(env.LIBVIPS_CONTAINER);
}
```

- [ ] **Step 3: Typecheck.** Run: `cd apps/worker && vp check` — expect clean (no test yet; exercised in Task 4/8).
- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/conversions/libvips-container.ts apps/worker/src/conversions/conversion-engine.ts
git commit -m "feat(conversions): libvips Container + ConversionPort resolver seam"
```

---

### Task 4: The CONVERSION queue consumer

**Files:**

- Create: `apps/worker/src/conversions/conversion-consumer.ts`
- Test: `apps/worker/test/conversion-consumer.test.ts`

**Interfaces:**

- Consumes: `ConversionMessage` from `conversion-types.ts`; `runConversion` from `@magna-carta/conversion/execute`; `resolveEnginePort` from `conversion-engine.ts`; `Bindings` (`R2`, `CONVERSION_JOB`).
- Produces: `export async function conversionQueue(batch: MessageBatch<ConversionMessage>, env: Bindings, resolvePort?: (env: Bindings) => ConversionPort): Promise<void>` (the `resolvePort` parameter defaults to `resolveEnginePort`; tests pass a fake).

- [ ] **Step 1: Write the failing test**

Inject a **fake** `resolvePort` returning a `ConversionPort` whose `convert` returns `converted(bytes, "image/webp")`. Seed `env.R2` (the Miniflare R2) with a source object at the message's `sourceKey`. Run `conversionQueue` over a one-message batch; assert: the job DO ends `done` with the `resultKey`, the result object exists in R2 with the right bytes/media type, the message was `ack`'d. Second test: a fake port returning `engineNotImplemented()` → job `failed`, reason `"engine-not-implemented"`, message `ack`'d (a typed failure is terminal, not retried). Third: a thrown/transport error path → `markFailed` + `retry`.

- [ ] **Step 2: Run it — verify it fails.** `pnpm --filter @magna-carta/worker test conversion-consumer`

- [ ] **Step 3: Implement** (the simpler bundle-consumer shape)

```ts
// apps/worker/src/conversions/conversion-consumer.ts
import { runConversion } from "@magna-carta/conversion/execute";
import type { ConversionPort } from "@magna-carta/conversion/port";
import type { Bindings } from "../app.ts";
import { resolveEnginePort } from "./conversion-engine.ts";
import type { ConversionMessage } from "./conversion-types.ts";

function coordinatorFor(env: Bindings, message: ConversionMessage) {
  return env.CONVERSION_JOB.get(
    env.CONVERSION_JOB.idFromName(`${message.firmId}:${message.jobId}`),
  );
}

async function convertOne(
  env: Bindings,
  message: ConversionMessage,
  resolvePort: (env: Bindings) => ConversionPort,
): Promise<void> {
  const coordinator = coordinatorFor(env, message);
  await coordinator.markRunning();
  const source = await env.R2.get(message.sourceKey);
  if (source === null) {
    await coordinator.markFailed("source expired");
    return; // terminal — do not retry a reaped source
  }
  const bytes = new Uint8Array(await source.arrayBuffer());
  const result = await runConversion(message.from, message.to, bytes, () => resolvePort(env));
  if (!result.ok) {
    await coordinator.markFailed(result.reason); // typed, terminal
    return;
  }
  await env.R2.put(message.resultKey, result.bytes, {
    httpMetadata: { contentType: result.mediaType },
  });
  await coordinator.markDone(message.resultKey, result.mediaType);
}

export async function conversionQueue(
  batch: MessageBatch<ConversionMessage>,
  env: Bindings,
  resolvePort: (env: Bindings) => ConversionPort = resolveEnginePort,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await convertOne(env, message.body, resolvePort);
      message.ack();
    } catch (error) {
      // Transport/unexpected failure: mark failed (the DO guards against clobbering a done) and retry.
      await coordinatorFor(env, message.body).markFailed(
        error instanceof Error ? error.message : "conversion error",
      );
      message.retry();
    }
  }
}
```

Note: `runConversion`'s 4th arg is the engine resolver `(EngineId) => ConversionPort`; here every engine resolves to the one injected port (libvips). A typed `result.ok === false` (e.g. `engine-not-implemented` for a non-libvips edge) is terminal and `ack`'d, not retried.

- [ ] **Step 4: Run it — verify it passes.** `pnpm --filter @magna-carta/worker test conversion-consumer`
- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/conversions/conversion-consumer.ts apps/worker/test/conversion-consumer.test.ts
git commit -m "feat(conversions): CONVERSION queue consumer"
```

---

### Task 5: The routes (upload presign · submit · status)

**Files:**

- Create: `apps/worker/src/routes/documents/conversions.ts`

**Interfaces:**

- Consumes: the chokepoint helpers + `defineOpenAPIRoute`/`RouteMeta`/`Problem` (read `apps/worker/src/routes/files/bundle-status.ts` + `routes/files/uploads.ts` and mirror the imports + `register…Route(app, chokepoint)` shape exactly); `presignerForEnv` (`presignPut`/`presignGet`); `newIdentifier` from `@magna-carta/identifiers`; `findPath` + `getFormat` from `@magna-carta/conversion`.
- Produces: `export function registerConversionRoutes(app, chokepoint): void` registering three routes.

All three share this `RouteMeta` base (copy field-for-field from `bundle-status.ts`, changing only `operationId`, `permission`, `resource`):
`{ surface: "app", authenticated: true, permission: "tools:fileConverter", resource: "firm", audited: false, idempotency: "optional", rateLimit: "default" }`. (`resource: "firm"` — these are firm-scoped transient jobs, not matter-rooted; confirm `"firm"` is an allowed `resource` in `route-meta.ts`, else use the firm-scoped value that file defines.)

- [ ] **Step 1: Write the failing e2e test** — defer to Task 8 (the routes are exercised end-to-end there). For this task, write a focused test asserting each route is registered with the right method/path and rejects an unknown source format (`POST /conversions` with an unconvertible `{from,to}` → 422). Run it; verify it fails.

- [ ] **Step 2: Implement the routes**

Route A — `POST /api/v1/conversions/upload`: mint `jobId = newIdentifier("cnv")`; the source key is `conversions/<firmId>/<jobId>/source`; return `{ jobId, uploadUrl: await presignerForEnv(c.env).presignPut(bucket, sourceKey, 300), sourceKey }`. (Mirror `routes/files/uploads.ts` for the presignPut call + `requireBucket(firm.bucketName)`.)

Route B — `POST /api/v1/conversions` with body `{ jobId, sourceKey, from, to }` (validated by a zod schema): reject with 422 if `getFormat(from)`/`getFormat(to)` is undefined or `findPath(from, to)` is not ok; the result key is `conversions/<firmId>/<jobId>/result`; create the DO `c.env.CONVERSION_JOB.get(idFromName(\`${firmId}:${jobId}\`))`and call`start({ firmId, jobId, sourceKey, resultKey, from, to })`; return `202 { jobId, status: "queued" }`.

Route C — `GET /api/v1/conversions/{jobId}`: address the DO by `firmId:jobId`; `const state = await coordinator.status()`; on `done` + a live `R2.head(state.resultKey)` → `c.json({ status: "done", url: await presignerForEnv(c.env).presignGet(bucket, state.resultKey, 300), mediaType: state.mediaType }, 200)`; on `done` but reaped → `{ status: "expired" }`; else `c.json({ status: state.status, reason: state.reason ?? undefined }, 200)`. (Mirror `bundle-status.ts` field-for-field.)

Each route uses `requireChokepointFirmId(c)` for the firm id (never the path) — that is the cross-firm 404 guarantee.

- [ ] **Step 3: Run it — verify it passes.** `pnpm --filter @magna-carta/worker test conversions-routes`
- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/routes/documents/conversions.ts apps/worker/test/conversions-routes.test.ts
git commit -m "feat(conversions): upload-presign, submit, and status routes"
```

---

### Task 6: Worker wiring (app.ts + wrangler)

**Files:**

- Modify: `apps/worker/src/app.ts`
- Modify: `apps/worker/wrangler.jsonc`

**Interfaces:**

- Produces: `Bindings` gains `CONVERSION: Queue<ConversionMessage>`, `CONVERSION_JOB: DurableObjectNamespace`, and optional `LIBVIPS_CONTAINER?: DurableObjectNamespace`; the `ConversionJob` DO is exported from the worker entry; the `CONVERSION` queue routes to `conversionQueue` in the `queue()` handler; `registerConversionRoutes` is called in the composition root.

- [ ] **Step 1: app.ts** — add the three `Bindings` fields; `export { ConversionJob } from "./conversions/conversion-coordinator.ts";` (DOs must be exported from the entry); in the `queue()` handler add a branch routing the `CONVERSION` queue's batch to `conversionQueue(batch, env)` (mirror how `FILES_INGEST`/`BUNDLE_BUILD` are dispatched by `batch.queue` name); call `registerConversionRoutes(app, chokepoint)` beside the other `register…Routes` calls. Read the existing `queue()` dispatch + the `register…` block and follow them exactly.

- [ ] **Step 2: wrangler.jsonc** — under `queues.producers` add `{ "binding": "CONVERSION", "queue": "magna-carta-production-conversions" }`; under `queues.consumers` add a consumer for `magna-carta-production-conversions` with a `dead_letter_queue` `…-conversions-deadletter` and a `max_concurrency` (mirror the files-ingest consumer block); under `durable_objects.bindings` add `{ "name": "CONVERSION_JOB", "class_name": "ConversionJob" }`; add a `migrations` entry with `new_sqlite_classes: ["ConversionJob"]` (mirror the existing DO migration). **Do NOT** add the `LIBVIPS_CONTAINER` container binding — that is the deploy-time activation step (documented, not built here).

- [ ] **Step 3: Verify the worker builds + the existing suite is green.** Run: `pnpm --filter @magna-carta/worker test` and `pnpm --filter @magna-carta/worker exec wrangler deploy --dry-run` (expect the dry-run to validate the new bindings; the missing Container binding is fine — nothing references it at deploy).
- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/app.ts apps/worker/wrangler.jsonc
git commit -m "feat(conversions): wire the DO, CONVERSION queue, and routes into the worker"
```

---

### Task 7: End-to-end test (fake Container)

**Files:**

- Create/extend: `apps/worker/test/conversions-routes.test.ts`

**Interfaces:**

- Consumes: the Workers test harness (read an existing e2e, e.g. `apps/worker/test/files-routes.test.ts`, for the provisioned-firm + authed-session + `SELF.fetch`/app-fetch setup) and the fake-port injection seam.

- [ ] **Step 1: Write the e2e** — the full journey for an authed member with `tools:fileConverter`: `POST /conversions/upload` → PUT the bytes to the returned `uploadUrl` (or write directly to the source key via the test R2) → `POST /conversions {jobId, sourceKey, from:"png", to:"webp"}` returns 202 → drain the `CONVERSION` queue through `conversionQueue(batch, env, fakePort)` (the fake returns `converted(webpBytes, "image/webp")`) → `GET /conversions/{jobId}` returns `{status:"done", url, mediaType:"image/webp"}` → GET the url → bytes match. Plus: **isolation** — a second firm's session `GET`ing the first firm's jobId gets `{status:"failed", reason:"unknown job"}` (the DO is firm-keyed) and never the result; **failure** — a fake port returning `engineNotImplemented()` ends the job `failed` with `reason:"engine-not-implemented"`.
- [ ] **Step 2: Run it — verify it passes.** `pnpm --filter @magna-carta/worker test conversions-routes`
- [ ] **Step 3: Commit**

```bash
git add apps/worker/test/conversions-routes.test.ts
git commit -m "test(conversions): end-to-end transient convert via a fake engine"
```

---

### Task 8: Conformance + docs

**Files:**

- Modify: the committed OpenAPI snapshot (regenerate) + the API client (regenerate) — run the repo's snapshot/client build (read `docs/conventions/api.md` for the exact `vp run` targets) and commit the regenerated artifacts.
- Create: `changelog.d/slice-2-4b-server-conversion.md` (category `Added`).
- Modify: `apps/worker/CLAUDE.md` (or the conversions area note) — a short note on the deploy-time activation (the real libvips Container image + the `containers` binding + the R2 `conversions/` lifecycle rule).

- [ ] **Step 1:** Run the full worker suite + the §3.5 conformance fitness — confirm the three new routes satisfy the audited/permission/chokepoint/operationId rules. Run: `pnpm --filter @magna-carta/worker test`.
- [ ] **Step 2:** Regenerate + commit the OpenAPI snapshot and the API client (the drift gates require it).
- [ ] **Step 3:** Write the changelog fragment + the deploy-time note. Commit.

```bash
git add apps/worker/openapi/openapi.json packages/api-client changelog.d/slice-2-4b-server-conversion.md apps/worker/CLAUDE.md
git commit -m "docs(conversions): conformance, OpenAPI snapshot, changelog, deploy-time note"
```

---

## Definition of done

- The transient convert journey works end-to-end in the e2e with a fake engine: presign → upload → submit (202) → queue-consume → poll `done` → presigned-GET the result. Tenant isolation (cross-firm → unknown job) and the typed-failure path are covered.
- The `ConversionJob` DO, the `CONVERSION` queue + consumer, the routes, and the engine seam are wired; `wrangler deploy --dry-run`, the full worker suite, conformance, snapshot/client drift gates, and `vp check` + `lint:process-refs` are green.
- **Deferred (documented, not built):** the real libvips Container image + its `containers` binding + the R2 `conversions/` lifecycle rule (deploy-time activation); the inline wasm fast-path; LibreOffice/email/FFmpeg engines; the matter-attached save-as-version path; the UI + role-seeding.

## Plan self-review notes

- **Spec coverage:** orchestrator flow (T1–T5), Container + seam (T3), uniform-async job (T2/T4), routes incl. transient presign + presigned-GET download (T5, refined from the design's HMAC-token to the bundle-status presigned-GET precedent — same security, less code), wiring (T6), e2e + isolation + failure (T7), conformance/docs (T8). The deferrals match the design's Deferred section.
- **Type consistency:** `ConversionJobState`/`ConversionMessage`/`ConversionCoordinator` defined in T1 and reused verbatim in T2/T4/T5; `resolveEnginePort`/the injectable `resolvePort` consistent across T3/T4/T7.
- **Refinement to flag at review:** the design doc specified an HMAC download token; this plan uses the **`bundle-status` presigned-GET** instead (the real precedent) — update the design doc's download paragraph to match, or note the deviation.

```

```
