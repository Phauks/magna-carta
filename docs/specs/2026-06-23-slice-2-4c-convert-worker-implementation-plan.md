# Slice 2·4c — Convert Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/convert-worker` (`magna-carta-convert`) — a stateless, no-public-surface Cloudflare Worker that owns the conversion engine Container(s) and is reached only via a service binding — and wire the app worker's `resolveEnginePort` to call it.

**Architecture:** A direct transposition of `apps/scan-worker`. The worker exposes one internal route, `POST /convert`, which streams source bytes to a libvips engine Container (`LibvipsContainer extends Container`, outbound disabled) and returns the converted bytes verbatim. The app worker's `resolveEnginePort` returns a `ConversionPort` adapter that POSTs to this worker over a `CONVERT` service binding (restoring the adapter removed in the 2·4b realignment, now pointed at the binding). The in-container libvips HTTP service + Dockerfile are deploy-time and out of scope; tests fake the Container and the service binding.

**Tech Stack:** Cloudflare Workers + `@cloudflare/containers`; `@magna-carta/conversion` (`ConversionPort`, `converted`, `adapterError`, `engineNotImplemented` from `/port`); Vitest (`@cloudflare/vitest-pool-workers`); `vp` (Vite+) toolchain; pnpm workspace + catalog.

## Global Constraints

- **Full names, no shorthand** — `LibvipsContainer`, `forwardConvert`, `resolveEnginePort`; no abbreviations (golden rule 12).
- **`.ts` import extensions; `import type` for type-only imports; no barrel files.**
- **No process-ref strings in source** (no "slice 2·4c", "ADR-NNNN", "spec §N") — `pnpm run lint:process-refs` enforces. The forward-looking "deploy-time" / "when the LibreOffice engine lands" phrasing is allowed.
- **Never throws across the engine boundary** — a Container/transport failure maps to `adapterError(...)`, matching the consumer's `!result.ok → markFailed → ack` contract.
- **No public surface on the worker** — `workers_dev:false`, `preview_urls:false`; the service binding is the trust boundary (no auth in the worker).
- **Mirror `apps/scan-worker` precedents** verbatim where shapes match: `apps/scan-worker/src/{index,forward-scan,scan-container,scan-warm}.ts`, `apps/scan-worker/{wrangler.jsonc,package.json,tsconfig.json,vitest.config.ts,worker-env.d.ts}`, `apps/scan-worker/test/forward-scan.test.ts`.
- **Deps:** run `vp install` from the worktree root before the first test run (the fresh worktree has no `node_modules`).

---

### Task 1: Scaffold `apps/convert-worker`

**Files:**
- Create: `apps/convert-worker/package.json`, `apps/convert-worker/tsconfig.json`, `apps/convert-worker/vitest.config.ts`, `apps/convert-worker/worker-env.d.ts`, `apps/convert-worker/wrangler.jsonc`, `apps/convert-worker/src/index.ts`
- Reference: the matching `apps/scan-worker/*` files

**Interfaces:**
- Produces: the `@magna-carta/convert-worker` package; `Bindings` type in `src/index.ts` (extended in Task 3); a `default` `ExportedHandler` whose `fetch` returns 404 for now.

- [ ] **Step 1: Copy the scaffold files from `apps/scan-worker`, renaming.** `package.json` → name `@magna-carta/convert-worker` (same scripts + deps as scan-worker's: `@cloudflare/containers`, `zod` catalog deps; the same devDeps). `tsconfig.json`, `vitest.config.ts`, `worker-env.d.ts` — identical to scan-worker's (worker-env re-references `./src/index.ts`).

- [ ] **Step 2: Write a minimal `src/index.ts`** — `Bindings` empty for now (`export type Bindings = {};`), a `default` handler whose `fetch` returns `new Response("Not Found", { status: 404 })`, `satisfies ExportedHandler<Bindings>`.

- [ ] **Step 3: Write a minimal `wrangler.jsonc`** mirroring scan-worker's top matter: `"name": "magna-carta-convert"`, `"main": "./src/index.ts"`, the same `compatibility_date`/`compatibility_flags` as scan-worker, `"workers_dev": false`, `"preview_urls": false`, `"observability": { "enabled": true, "head_sampling_rate": 1 }`. No `containers`/`durable_objects`/`triggers` yet (added in Task 3).

- [ ] **Step 4: Install + validate.** Run `vp install` (worktree root). Then `cd apps/convert-worker && vp check` (clean) and `pnpm --filter @magna-carta/convert-worker exec wrangler deploy --dry-run` (validates the bare config).
Expected: vp check clean; dry-run succeeds.

- [ ] **Step 5: Commit** — `git add apps/convert-worker pnpm-lock.yaml` (+ `pnpm-workspace.yaml` if the workspace globs require an explicit entry — check; `apps/*` likely already matches). `git commit -m "feat(convert-worker): scaffold the magna-carta-convert worker"`.

---

### Task 2: `LibvipsContainer` + the `forwardConvert` proxy

**Files:**
- Create: `apps/convert-worker/src/libvips-container.ts`, `apps/convert-worker/src/forward-convert.ts`, `apps/convert-worker/test/forward-convert.test.ts`
- Reference: `apps/scan-worker/src/{scan-container,forward-scan}.ts`, `apps/scan-worker/test/forward-scan.test.ts`

**Interfaces:**
- Produces:
  - `class LibvipsContainer extends Container` (exported)
  - `interface ConvertContainerFetcher { fetch(request: Request): Promise<Response> }`
  - `async function forwardConvert(request: Request, container: ConvertContainerFetcher): Promise<Response>`

- [ ] **Step 1: Write `src/libvips-container.ts`.**

```ts
import { Container } from "@cloudflare/containers";

// The native-libvips conversion engine Container — a long-lived libvips HTTP service. Its default
// fetch() proxies to the service; the warm cron hits its `ready` endpoint to keep one instance alive.
// Untrusted, privileged document bytes never reach the network: the container runs with outbound
// networking disabled. Additional engines (LibreOffice headless, FFmpeg) become their own Container
// classes here, selected by engineId, when those edges are wired.
//
// The image is a deploy-time build (the in-container libvips service + Dockerfile under
// containers/convert/, like containers/scan) — the engine cannot run under the local test pool, so
// forwardConvert is exercised against a fake container in tests.
export class LibvipsContainer extends Container {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "30m"; // the warm-poke cron keeps one instance alive
  override enableInternet = false; // untrusted bytes — no egress
  override pingEndpoint = "ready";
}
```

- [ ] **Step 2: Write the failing test `test/forward-convert.test.ts`** (mirror `forward-scan.test.ts`).

```ts
import { describe, expect, it } from "vitest";
import { forwardConvert } from "../src/forward-convert.ts";

// A minimal fake container: the real libvips image cannot run under the local test pool, and
// forwardConvert needs only a { fetch } object.
function fakeContainer(response: Response): { fetch(req: Request): Promise<Response> } {
  return { fetch: async () => response };
}

describe("forwardConvert", () => {
  it("forwards POST /convert to the container and returns the bytes + content-type verbatim", async () => {
    const out = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // a 'RIFF' webp-ish marker
    const container = fakeContainer(
      new Response(out, { status: 200, headers: { "Content-Type": "image/webp" } }),
    );
    const request = new Request("http://convert-worker/convert", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
      headers: { "x-target-format": "webp", "x-source-format": "png", "x-recipe": "raster" },
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await forwardConvert(request, container);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(out);
  });

  it("propagates a non-200 status from the container", async () => {
    const container = fakeContainer(new Response("bad input", { status: 422 }));
    const request = new Request("http://convert-worker/convert", { method: "POST", body: "x" });
    const response = await forwardConvert(request, container);
    expect(response.status).toBe(422);
  });

  it("forwards the target-format + recipe headers to the container", async () => {
    let captured: Headers | undefined;
    const container = {
      fetch: async (req: Request) => {
        captured = req.headers;
        return new Response(new Uint8Array([9]), { status: 200, headers: { "Content-Type": "image/png" } });
      },
    };
    const request = new Request("http://convert-worker/convert", {
      method: "POST",
      body: "bytes",
      headers: { "x-target-format": "png", "x-recipe": "raster" },
    });
    await forwardConvert(request, container);
    expect(captured?.get("x-target-format")).toBe("png");
    expect(captured?.get("x-recipe")).toBe("raster");
  });
});
```

- [ ] **Step 2b: Run it — verify it fails.** `pnpm --filter @magna-carta/convert-worker test forward-convert` → FAIL (`forwardConvert` not defined).

- [ ] **Step 3: Write `src/forward-convert.ts`.**

```ts
// The convert Container's HTTP surface, narrowed to the one call the proxy makes. The container from
// getContainer(env.LIBVIPS_CONTAINER, ...) satisfies it; tests pass a fake so the proxy is exercised
// without a real container (or Docker).
export interface ConvertContainerFetcher {
  fetch(request: Request): Promise<Response>;
}

// Forward an incoming conversion request to the engine Container and return its response verbatim.
// Route: POST /convert with the source bytes as the body and the target format + recipe as
// x-target-format / x-source-format / x-recipe headers; the container returns the converted bytes
// with a Content-Type, or a non-2xx status. The service binding from the app worker is the trust
// boundary — this worker has no public routes. A network failure throws (surfaced via telemetry),
// never a silent empty result.
export async function forwardConvert(
  request: Request,
  container: ConvertContainerFetcher,
): Promise<Response> {
  const containerResponse = await container.fetch(
    new Request("http://convert/convert", {
      method: "POST",
      body: request.body,
      headers: request.headers,
      duplex: "half",
      signal: request.signal,
    } as RequestInit & { duplex: "half" }),
  );
  return new Response(containerResponse.body, {
    status: containerResponse.status,
    statusText: containerResponse.statusText,
    headers: containerResponse.headers,
  });
}
```

- [ ] **Step 4: Run the tests — verify pass.** `pnpm --filter @magna-carta/convert-worker test forward-convert` → PASS (3/3). `cd apps/convert-worker && vp check` clean.

- [ ] **Step 5: Commit** — `git add apps/convert-worker/src/libvips-container.ts apps/convert-worker/src/forward-convert.ts apps/convert-worker/test/forward-convert.test.ts` · `git commit -m "feat(convert-worker): LibvipsContainer + the /convert streaming proxy"`.

---

### Task 3: Wire `index.ts` (the `/convert` route + warm cron) + the container binding

**Files:**
- Modify: `apps/convert-worker/src/index.ts`, `apps/convert-worker/wrangler.jsonc`
- Create: `apps/convert-worker/src/convert-warm.ts`
- Reference: `apps/scan-worker/src/{index,scan-warm}.ts`, `apps/scan-worker/wrangler.jsonc`

**Interfaces:**
- Consumes: `LibvipsContainer`, `forwardConvert`, `ConvertContainerFetcher` (Task 2).
- Produces: `Bindings` with `LIBVIPS_CONTAINER: DurableObjectNamespace<LibvipsContainer>`; `pokeContainer`.

- [ ] **Step 1: Write `src/convert-warm.ts`** (mirror `scan-warm.ts`).

```ts
import type { ConvertContainerFetcher } from "./forward-convert.ts";

// Poke the engine container's health endpoint to keep one instance warm within sleepAfter, so a
// conversion doesn't pay engine cold-start. `ready` is the Container's pingEndpoint.
export async function pokeContainer(container: ConvertContainerFetcher): Promise<void> {
  await container.fetch(new Request("http://convert/ready"));
}
```

- [ ] **Step 2: Rewrite `src/index.ts`** (mirror `scan-worker/src/index.ts`).

```ts
import { getContainer } from "@cloudflare/containers";
import { forwardConvert } from "./forward-convert.ts";
import { pokeContainer } from "./convert-warm.ts";

// The convert worker's runtime bindings. Stateless: no D1, R2, or Queues. The only binding is the
// engine Container Durable Object. Reached only via a service binding from the app worker — no public
// routes, so the service binding is the trust boundary.
export type Bindings = {
  // The native-libvips conversion engine Container (Container-backed Durable Object). Named in
  // wrangler.jsonc's durable_objects.bindings + migrations; the class is re-exported below so the
  // runtime can instantiate it.
  LIBVIPS_CONTAINER: DurableObjectNamespace<import("./libvips-container.ts").LibvipsContainer>;
};

export { LibvipsContainer } from "./libvips-container.ts";

// Keep one engine instance warm within the container's 30-minute sleepAfter.
const CONVERT_WARM_CRON = "*/20 * * * *";

export default {
  // POST /convert — receives the streamed source body + target-format/recipe headers from the app
  // worker (via service binding) and forwards to the engine Container, returning its bytes verbatim.
  // No auth: the service binding is the trust boundary (not reachable from the public internet).
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/convert") {
      // Only libvips is wired today; engineId-based routing to additional engine Containers
      // (LibreOffice, FFmpeg) is added when those edges land.
      return forwardConvert(request, getContainer(env.LIBVIPS_CONTAINER, "libvips"));
    }
    return new Response("Not Found", { status: 404 });
  },

  scheduled(controller: ScheduledController, env: Bindings, executionContext: ExecutionContext) {
    if (controller.cron === CONVERT_WARM_CRON) {
      executionContext.waitUntil(pokeContainer(getContainer(env.LIBVIPS_CONTAINER, "libvips")));
    }
  },
} satisfies ExportedHandler<Bindings>;
```

- [ ] **Step 3: Add the container + DO binding + cron to `wrangler.jsonc`** (mirror scan-worker's blocks):

```jsonc
  "containers": [
    {
      "class_name": "LibvipsContainer",
      "image": "../../containers/convert/Dockerfile",
      "max_instances": 5,
      "instance_type": "standard-1",
    },
  ],
  "durable_objects": {
    "bindings": [{ "name": "LIBVIPS_CONTAINER", "class_name": "LibvipsContainer" }],
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["LibvipsContainer"] }],
  "triggers": { "crons": ["*/20 * * * *"] },
```

- [ ] **Step 4: Resolve the Dockerfile question empirically.** Run `pnpm --filter @magna-carta/convert-worker exec wrangler deploy --dry-run`.
  - If it FAILS because `../../containers/convert/Dockerfile` does not exist: create `containers/convert/Dockerfile` as a minimal placeholder (a comment header + a base image line) and `containers/convert/CLAUDE.md` noting the real in-container libvips HTTP service (`POST /convert`, `ready`) is a deploy-time build like `containers/scan`. Re-run dry-run.
  - If dry-run does NOT require the Dockerfile to exist: leave the `containers` binding and add no placeholder (note this in the report).
  Expected: dry-run succeeds either way.

- [ ] **Step 5: Verify + commit.** `cd apps/convert-worker && vp check` clean; `pnpm --filter @magna-carta/convert-worker test` green. `git add apps/convert-worker` (+ `containers/convert/` if created). `git commit -m "feat(convert-worker): wire /convert route, warm cron, and the engine Container binding"`.

---

### Task 4: App-worker seam — `resolveEnginePort` → service-binding adapter

**Files:**
- Modify: `apps/worker/src/conversions/conversion-engine.ts`, `apps/worker/src/app.ts`, `apps/worker/wrangler.jsonc`
- Create: `apps/worker/test/conversion-engine.test.ts`
- Reference: `packages/conversion/src/port.ts` (the exact `ConversionPort` / input / result types)

**Interfaces:**
- Consumes: `ConversionPort`, `converted`, `adapterError`, `engineNotImplemented` from `@magna-carta/conversion/port`; the worker `Bindings`.
- Produces: `resolveEnginePort(env)` returning a service-binding-backed `ConversionPort` when `env.CONVERT` is set.

- [ ] **Step 1: Add the `CONVERT` binding to `apps/worker/src/app.ts` `Bindings`** — replace the placeholder comment added in the 2·4b realignment with the real binding:

```ts
  // The dedicated conversion engine worker (magna-carta-convert), reached over a service binding.
  // Optional: absent in every test environment and until the deploy-time binding is added; while
  // unset, resolveEnginePort returns the deferred port (engine-not-implemented).
  CONVERT?: Fetcher;
```

- [ ] **Step 2: Add the `services` block to `apps/worker/wrangler.jsonc`** (top level):

```jsonc
  "services": [{ "binding": "CONVERT", "service": "magna-carta-convert" }],
```

- [ ] **Step 3: Write the failing test `apps/worker/test/conversion-engine.test.ts`.** First read `packages/conversion/src/port.ts` to confirm the `ConversionPort.convert` input field names (`from`, `to`, `bytes`, `recipeRef`) and the `ConversionResult` shape (`{ ok: true, bytes, mediaType }` vs a typed failure). Then:

```ts
import { describe, expect, it } from "vitest";
import { resolveEnginePort } from "../src/conversions/conversion-engine.ts";
import type { Bindings } from "../src/app.ts";

// A fake CONVERT service binding: a Fetcher whose fetch() returns a scripted Response.
function fakeConvert(response: Response): Pick<Fetcher, "fetch"> {
  return { fetch: async () => response };
}

const input = { from: "png", to: "webp", bytes: new Uint8Array([1, 2, 3]), recipeRef: "raster" };

describe("resolveEnginePort", () => {
  it("returns the deferred port (engine-not-implemented) when CONVERT is unbound", async () => {
    const port = resolveEnginePort({} as Bindings);
    const result = await port.convert(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("engine-not-implemented");
  });

  it("maps a 2xx container response to converted bytes + media type", async () => {
    const out = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
    const convert = fakeConvert(new Response(out, { status: 200, headers: { "Content-Type": "image/webp" } }));
    const port = resolveEnginePort({ CONVERT: convert } as unknown as Bindings);
    const result = await port.convert(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new Uint8Array(result.bytes)).toEqual(out);
      expect(result.mediaType).toBe("image/webp");
    }
  });

  it("maps a non-2xx response to adapter-error (never throws)", async () => {
    const convert = fakeConvert(new Response("bad", { status: 422 }));
    const port = resolveEnginePort({ CONVERT: convert } as unknown as Bindings);
    const result = await port.convert(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("adapter-error");
  });

  it("maps a thrown transport error to adapter-error (never throws)", async () => {
    const convert: Pick<Fetcher, "fetch"> = { fetch: async () => { throw new Error("binding down"); } };
    const port = resolveEnginePort({ CONVERT: convert } as unknown as Bindings);
    const result = await port.convert(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("adapter-error");
  });
});
```

(Adjust the `reason` literals to the actual `ConversionResult` discriminants in `port.ts` — `converted`/`adapterError`/`engineNotImplemented` define them.)

- [ ] **Step 3b: Run it — verify the new cases fail** (`resolveEnginePort` currently always returns the deferred port). `pnpm --filter @magna-carta/worker test conversion-engine` → the 2xx/non-2xx/throw cases FAIL.

- [ ] **Step 4: Rewrite `apps/worker/src/conversions/conversion-engine.ts`** — restore the engine adapter, now over the service binding:

```ts
import {
  type ConversionPort,
  type ConversionResult,
  adapterError,
  converted,
  engineNotImplemented,
} from "@magna-carta/conversion/port";
import type { Bindings } from "../app.ts";

// The engine ConversionPort: POST the source bytes + target-format/recipe headers to the dedicated
// conversion worker (magna-carta-convert) over its service binding, and read back the converted bytes
// + media type. Never throws — a transport/engine failure maps to adapter-error (the integrations
// Dispatch discipline, matching the consumer's !result.ok -> markFailed -> ack contract). The heavy
// engines run in that worker's Container(s); a small-raster wasm-vips in-process fast-path may be
// added here later as a parity backend.
function serviceBindingPort(convert: Pick<Fetcher, "fetch">): ConversionPort {
  return {
    async convert(input): Promise<ConversionResult> {
      try {
        const response = await convert.fetch(
          new Request("https://convert/convert", {
            method: "POST",
            headers: {
              "x-source-format": input.from,
              "x-target-format": input.to,
              "x-recipe": input.recipeRef,
            },
            body: input.bytes,
          }),
        );
        if (!response.ok) return adapterError(`convert worker ${response.status}`);
        const mediaType = response.headers.get("content-type") ?? "application/octet-stream";
        return converted(new Uint8Array(await response.arrayBuffer()), mediaType);
      } catch (error) {
        return adapterError(error instanceof Error ? error.message : "convert worker error");
      }
    },
  };
}

// The deferred port for environments without the CONVERT binding (every test environment, and prod
// until the dedicated worker is deployed + bound): every conversion is engine-not-implemented. Tests
// inject their own fake port at the consumer's resolver seam.
const deferredPort: ConversionPort = {
  convert: () => Promise.resolve(engineNotImplemented()),
};

export function resolveEnginePort(env: Bindings): ConversionPort {
  return env.CONVERT === undefined ? deferredPort : serviceBindingPort(env.CONVERT);
}
```

(Confirm the `input` field names against `port.ts`; mirror the removed `containerPort` shape from the branch history, which used `input.to`, `input.recipeRef`, `input.bytes`.)

- [ ] **Step 5: Run — verify pass + no regressions.** `pnpm --filter @magna-carta/worker test conversion-engine` (green); `pnpm --filter @magna-carta/worker test conversion` (the 2·4b consumer/routes/coordinator suites still green — they inject fakes at the consumer seam, unaffected); `cd apps/worker && vp check` clean.

- [ ] **Step 6: Commit** — `git add apps/worker/src/conversions/conversion-engine.ts apps/worker/src/app.ts apps/worker/wrangler.jsonc apps/worker/test/conversion-engine.test.ts` · `git commit -m "feat(conversions): resolveEnginePort calls the dedicated convert worker over a service binding"`.

---

### Task 5: Docs, status, and final gates

**Files:**
- Create: `changelog.d/slice-2-4c-convert-worker.md`
- Modify: `STATUS.md` (the 2·4 row only), `apps/worker/CLAUDE.md` (update the conversion deploy-time note to name the worker + service binding)

- [ ] **Step 1: Changelog fragment** `changelog.d/slice-2-4c-convert-worker.md` (category `Added`): one concise paragraph — the dedicated `magna-carta-convert` worker now hosts the conversion engine Container(s), reached from the app worker over an internal service binding with no public surface and outbound networking disabled; the orchestration is unchanged; the in-container libvips engine image is a deploy-time activation. No process-ref strings in the body (describe the feature, not the process).

- [ ] **Step 2: Update `apps/worker/CLAUDE.md`** — the "Conversion subsystem" note's activation step now reads: build the `magna-carta-convert` worker's engine Container image (`containers/convert/`), deploy the worker, and bind it as the `CONVERT` service binding; `resolveEnginePort` selects it automatically once bound. (The worker scaffold + the binding now exist; only the image + deploy remain.)

- [ ] **Step 3: Update `STATUS.md`** — edit only the slice-2·4 row to reflect 2·4c (the engine worker scaffold + service-binding seam built; in-container engine image deploy-time).

- [ ] **Step 4: Final gates (all must pass).**
  - `pnpm --filter @magna-carta/convert-worker test` — green
  - `pnpm --filter @magna-carta/worker test` — full app-worker suite green
  - `cd apps/convert-worker && vp check` and `cd apps/worker && vp check` — clean
  - `pnpm run lint:process-refs` (worktree root) — clean
  - `pnpm --filter @magna-carta/convert-worker exec wrangler deploy --dry-run` and `pnpm --filter @magna-carta/worker exec wrangler deploy --dry-run` — both validate (the app worker's `CONVERT` service binding references `magna-carta-convert`; confirm dry-run accepts an unresolved service in isolation, or note it as expected).

- [ ] **Step 5: Commit** — `git add changelog.d/ apps/worker/CLAUDE.md STATUS.md` · `git commit -m "docs(convert-worker): changelog, deploy-time note, and status for slice 2·4c"`.

---

## Self-Review notes

- **Spec coverage:** worker scaffold (T1), engine Container + proxy (T2), routing + warm + container binding (T3), app-worker service-binding adapter (T4), docs/status/gates (T5). The in-container engine service + LibreOffice/FFmpeg Containers + UI are explicitly out of scope per the design.
- **Type consistency:** `ConvertContainerFetcher`, `forwardConvert`, `LibvipsContainer`, `pokeContainer`, `resolveEnginePort`, `serviceBindingPort` are used consistently across tasks. The `ConversionPort` input/result field names are deferred to `port.ts` (read in T4) — the plan flags this rather than guessing.
- **Dry-run / Dockerfile** is the one empirical unknown (T3 Step 4) — handled with an explicit branch, not a guess.
