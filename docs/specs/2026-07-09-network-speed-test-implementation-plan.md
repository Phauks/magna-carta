# Network Speed Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/tools/network-speed-test` page — a connection benchmark with the same measurements as `speed.cloudflare.com`, plus an authenticated round-trip probe to Magna Carta that answers "is it us or is it you?".

**Architecture:** Cloudflare's own `@cloudflare/speedtest` engine runs client-side behind an explicit Start. A rune store owns the engine lifecycle and exposes its results; pure modules (formatting, probe math) carry the logic and are unit-tested in the plugin-less node pool. One additive, read-only Worker route returns `request.cf` facts and doubles as the probe target. A defect in the Tools listing page — launchability gated on `stage === "ready"` — is corrected by moving the rule into the maturity module.

**Tech Stack:** SvelteKit (Svelte 5 runes), `@cloudflare/speedtest` v1.11 (MIT, zero runtime deps), `@magna-carta/design-system`, Hono + `@hono/zod-openapi` on Cloudflare Workers, Vitest.

## Global Constraints

- **All UI through the design system.** Tailwind utilities + `@magna-carta/design-system` components + design tokens only; no raw CSS, no off-token colors, no direct `bits-ui` imports. Lucide icons; no emojis.
- **Canvas voice.** Standard tokens, no `chrome-*` register.
- **Motion.** Only transform/opacity; respect `prefers-reduced-motion`.
- **Full names, no shorthand.** `@magna-carta/tools`, "the data-access layer", never "the DAL".
- **No process-doc references in source** (no `ADR-NNNN`, "spec §N", "slice N") in code or consumer-facing strings such as OpenAPI `description`s. State reasoning inline or cite a file path.
- **Never log the caller's IP address.** The error/telemetry pipeline redacts by default; nothing here opts in.
- **Web tests** live in `apps/web/test/**/*.test.ts` and import app modules by **relative path** (the web vitest config is a plugin-less node pool with no `$lib` alias). Run them with `vp test <pattern>` — `pnpm --filter … exec vitest` is not on PATH.
- **Worker tests** live in `apps/worker/test/` and run under Miniflare via `vp test <pattern>`.
- **Charts:** single-series only. No legend (the title names the series), no categorical palette, no cycled hues. Recessive axes; text wears text tokens, never the series color. A table view accompanies each chart.
- **Nothing is persisted.** No run history, no results storage.
- **Tailwind spacing is a closed token scale** (0/4/8/12/16/20/24/32/40/48/64/96). There is no arbitrary-N fallback — verify any class you use exists.

---

### Task 1: `hasSurface` in the maturity module (the launchable-rule fix)

The Tools listing gates launchability on `stage === "ready"`. That is wrong: the maturity model measures how *finished* a surface is, not whether it *exists* — `destinations.ts` ships `Settings` as `shipped: true, stage: "alpha"` and it is a live link wearing an "Alpha" badge. Under the current rule a working `alpha`/`beta` tool renders inert and unreachable. The rule belongs in `maturity.ts`, which declares itself the one home for the stage model.

**Files:**
- Modify: `apps/web/src/lib/maturity/maturity.ts`
- Modify: `apps/web/src/lib/tools/tool-tile.svelte:19`
- Modify: `apps/web/src/lib/tools/tool-row.svelte:17`
- Test: `apps/web/test/maturity-has-surface.test.ts`

**Interfaces:**
- Consumes: `MaturityStage` (`maturity.ts`).
- Produces: `hasSurface(stage: MaturityStage): boolean`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/maturity-has-surface.test.ts`:

```ts
/*
 * `soon` is the one stage meaning "no surface exists yet"; every other stage is reachable and
 * wears its badge. Asserted over EVERY member of MaturityStage, so a stage added later cannot
 * be silently unclassified — the guard that keeps a working alpha tool from rendering inert.
 */
import { describe, expect, it } from "vitest";
import { MATURITY_PRESENTATION, hasSurface, type MaturityStage } from "../src/lib/maturity/maturity.ts";

const ALL_STAGES = Object.keys(MATURITY_PRESENTATION) as MaturityStage[];

describe("hasSurface", () => {
  it("is false only for soon", () => {
    expect(hasSurface("soon")).toBe(false);
  });

  it("is true for every stage that has a surface", () => {
    expect(hasSurface("alpha")).toBe(true);
    expect(hasSurface("beta")).toBe(true);
    expect(hasSurface("ready")).toBe(true);
  });

  it("classifies every stage in the model", () => {
    expect(ALL_STAGES.length).toBeGreaterThan(0);
    for (const stage of ALL_STAGES) {
      expect(typeof hasSurface(stage)).toBe("boolean");
    }
    // Exactly one stage means "not built yet".
    expect(ALL_STAGES.filter((stage) => !hasSurface(stage))).toEqual(["soon"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test maturity-has-surface`
Expected: FAIL — `hasSurface` is not exported from `maturity.ts`.

- [ ] **Step 3: Add `hasSurface` to the maturity module**

Append to `apps/web/src/lib/maturity/maturity.ts` (after `MATURITY_PRESENTATION`):

```ts
/**
 * Whether a stage implies a surface a member can actually open. `soon` is the one stage that
 * means no surface exists yet; everything above it is reachable and states its own maturity
 * through the badge. The sidebar already depends on this distinction — Settings ships at
 * `alpha` and is a live link.
 *
 * Whether a stage is reachable is a fact about the stage, so it lives here beside the model
 * rather than being re-derived by each consumer.
 */
export function hasSurface(stage: MaturityStage): boolean {
  return stage !== "soon";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `vp test maturity-has-surface`
Expected: PASS (3 tests).

- [ ] **Step 5: Consume it in both tool components**

In `apps/web/src/lib/tools/tool-tile.svelte`, replace the `launchable` derivation and add the import:

```svelte
  import { hasSurface } from "$lib/maturity/maturity.ts";
  ...
  const launchable = $derived(hasSurface(presentation.stage));
```

Make the identical change in `apps/web/src/lib/tools/tool-row.svelte`. Change nothing else in either file — the anchor/`div` branches already do the right thing once `launchable` is correct.

- [ ] **Step 6: Verify the Svelte + TypeScript gate**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/maturity/maturity.ts apps/web/src/lib/tools/tool-tile.svelte apps/web/src/lib/tools/tool-row.svelte apps/web/test/maturity-has-surface.test.ts
git commit -m "fix(tools): a built tool is launchable at any stage above soon"
```

---

### Task 2: The `connection` Worker route

**Files:**
- Create: `apps/worker/src/routes/tools-connection.ts`
- Modify: `apps/worker/src/app.ts` (one import, one registration call)
- Modify: `apps/worker/openapi/openapi.json` (regenerated, not hand-edited)
- Modify: `packages/api-client/**` (regenerated, not hand-edited)
- Test: `apps/worker/test/tools-connection.test.ts`

**Interfaces:**
- Consumes: `defineOpenAPIRoute`, `RouteMeta` (`../contracts/route-meta.ts`), `chokepointMiddleware` (`../chokepoint/register.ts`), `Problem` (`../contracts/problem.ts`).
- Produces: `GET /api/v1/tools/connection` → `{ ip: string; asn: number; asOrganization: string; colo: string; country: string }`; exports `toolsConnectionMeta`, `toolsConnectionRoute`, `registerToolsConnectionRoute`.

**Why this route and not `/api/health`:** health does a control-plane D1 `SELECT 1`, so its round trip measures database latency, and repeated probing would pollute the liveness signal. This route touches no database. It IS authenticated and rides the chokepoint like every other route, so its round trip measures a real authenticated API call — the latency the app actually experiences. The UI labels it as such.

- [ ] **Step 1: Write the failing test**

Create `apps/worker/test/tools-connection.test.ts`:

```ts
/*
 * The connection route reports what the edge sees about the caller and touches no database, so
 * its round trip measures a real authenticated API call. It is gated on tools:speedTest like
 * every other tool surface.
 */
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /api/v1/tools/connection", () => {
  it("rejects an unauthenticated caller", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/tools/connection");
    expect(response.status).toBe(401);
  });

  it("is registered in the emitted contract", async () => {
    const response = await SELF.fetch("https://example.com/api/openapi.json");
    const document = (await response.json()) as { paths: Record<string, unknown> };
    expect(document.paths["/api/v1/tools/connection"]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `vp test tools-connection`
Expected: FAIL — the path is absent from the contract, and the request 404s rather than 401s.

- [ ] **Step 3: Create the route**

Create `apps/worker/src/routes/tools-connection.ts`:

```ts
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

const ConnectionResponse = z
  .object({
    ip: z.string(),
    asn: z.number(),
    asOrganization: z.string(),
    colo: z.string(),
    country: z.string(),
  })
  .openapi("ToolsConnectionResponse");

// Reads only what the edge already knows about this request — no database, no bindings — so the
// handler adds no work of its own to the round trip. The caller's own address is returned to the
// caller and never logged.
export const toolsConnectionMeta: RouteMeta = {
  operationId: "toolsConnection.get",
  surface: "app",
  authenticated: true,
  permission: "tools:speedTest",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const toolsConnectionRoute = defineOpenAPIRoute(toolsConnectionMeta, {
  method: "get",
  path: "/api/v1/tools/connection",
  description:
    "What the edge sees about this caller's connection: public address, network operator, and the edge location serving the request.",
  responses: {
    200: {
      description: "The caller's connection as the edge sees it",
      content: { "application/json": { schema: ConnectionResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "Authenticated, but the member lacks tools:speedTest",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerToolsConnectionRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...toolsConnectionRoute, middleware: chokepointMiddleware(chokepoint, toolsConnectionRoute) },
    (c) => {
      // `cf` is absent in local test runtimes; the empty defaults keep the contract satisfied
      // rather than throwing on a diagnostic surface.
      const edge = c.req.raw.cf;
      return c.json(
        {
          ip: c.req.header("CF-Connecting-IP") ?? "",
          asn: typeof edge?.asn === "number" ? edge.asn : 0,
          asOrganization: typeof edge?.asOrganization === "string" ? edge.asOrganization : "",
          colo: typeof edge?.colo === "string" ? edge.colo : "",
          country: typeof edge?.country === "string" ? edge.country : "",
        },
        200,
      );
    },
  );
}
```

- [ ] **Step 4: Register it**

In `apps/worker/src/app.ts`, add the import beside the other route imports:

```ts
import { registerToolsConnectionRoute } from "./routes/tools-connection.ts";
```

and the registration beside `registerFirmUsageRoute(app, chokepoint);`:

```ts
  registerToolsConnectionRoute(app, chokepoint);
```

- [ ] **Step 5: Re-emit the contract and regenerate the client**

Run: `pnpm --filter @magna-carta/worker run emit-openapi`
Expected: `apps/worker/openapi/openapi.json` now contains `/api/v1/tools/connection`.

Run: `pnpm run generate-client`
Expected: the generated client under `packages/api-client/` rebuilds without error.

- [ ] **Step 6: Run the tests**

Run: `vp test tools-connection openapi-snapshot`
Expected: PASS — the route 401s unauthenticated, appears in the contract, and the committed snapshot equals a fresh emission.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/routes/tools-connection.ts apps/worker/src/app.ts apps/worker/openapi/openapi.json apps/worker/test/tools-connection.test.ts packages/api-client
git commit -m "feat(tools): connection route reporting the edge's view of the caller"
```

---

### Task 3: Pure frontend logic — formatting and probe math

**Files:**
- Create: `apps/web/src/lib/tools/speed-test/speed-test-format.ts`
- Create: `apps/web/src/lib/tools/speed-test/connection-probe.ts`
- Test: `apps/web/test/speed-test-format.test.ts`
- Test: `apps/web/test/connection-probe.test.ts`

**Interfaces:**
- Produces:
  - `formatBandwidth(bps: number | undefined): string` — e.g. `"94.5 Mbps"`, `"1.24 Gbps"`, `"—"`.
  - `formatMilliseconds(ms: number | undefined): string` — e.g. `"12.4 ms"`, `"—"`.
  - `median(values: readonly number[]): number | null`.
  - `ConnectionFacts { ip, asn, asOrganization, colo, country }`.
  - `ProbeStatus = "reachable" | "unauthenticated" | "forbidden" | "unreachable"`.
  - `ProbeOutcome { status: ProbeStatus; facts: ConnectionFacts | null; medianRoundTripMs: number | null; successfulSamples: number }`.
  - `FetchResult = { ok: true; facts: ConnectionFacts } | { ok: false; status: number | null }` (`status: null` = transport failure).
  - `PROBE_SAMPLES: number` (= 5).
  - `probeConnection(deps: ProbeDeps): Promise<ProbeOutcome>` where `ProbeDeps = { fetchJson: (url: string) => Promise<FetchResult>; now: () => number }`.

> **Amended after Task 3 landed.** The first draft collapsed every failure into "unreachable". That is a lie a diagnostic tool must never tell: the app has no authenticated session yet, so the route answers `401`, and the panel would have blamed the firm's network for our own missing sign-in. The outcome now distinguishes *not signed in* and *not permitted* from *genuinely unreachable*, and an auth refusal stops the sampling loop immediately rather than retrying four more times.

- [ ] **Step 1: Write the failing formatting test**

Create `apps/web/test/speed-test-format.test.ts`:

```ts
/*
 * Result formatting, pinned. An absent measurement reads as an em dash — never as zero, which
 * would be a measurement claim we did not make.
 */
import { describe, expect, it } from "vitest";
import {
  formatBandwidth,
  formatMilliseconds,
} from "../src/lib/tools/speed-test/speed-test-format.ts";

describe("formatBandwidth", () => {
  it("renders megabits with one decimal below 100", () => {
    expect(formatBandwidth(94_500_000)).toBe("94.5 Mbps");
  });

  it("drops the decimal at or above 100 Mbps", () => {
    expect(formatBandwidth(432_000_000)).toBe("432 Mbps");
  });

  it("switches to gigabits at or above 1 Gbps", () => {
    expect(formatBandwidth(1_240_000_000)).toBe("1.24 Gbps");
  });

  it("renders an absent measurement as an em dash", () => {
    expect(formatBandwidth(undefined)).toBe("—");
  });
});

describe("formatMilliseconds", () => {
  it("renders one decimal", () => {
    expect(formatMilliseconds(12.44)).toBe("12.4 ms");
  });

  it("renders an absent measurement as an em dash", () => {
    expect(formatMilliseconds(undefined)).toBe("—");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `vp test speed-test-format`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the formatting module**

Create `apps/web/src/lib/tools/speed-test/speed-test-format.ts`:

```ts
/*
 * Turning engine numbers into the ledger voice. An absent measurement is an em dash, never a
 * zero: zero is a claim the connection carried nothing, and we did not measure that.
 */
const ABSENT = "—";

/** Bits per second → the largest unit that keeps the number readable. */
export function formatBandwidth(bitsPerSecond: number | undefined): string {
  if (bitsPerSecond === undefined || !Number.isFinite(bitsPerSecond)) return ABSENT;
  if (bitsPerSecond >= 1e9) return `${(bitsPerSecond / 1e9).toFixed(2)} Gbps`;
  const megabits = bitsPerSecond / 1e6;
  return megabits >= 100 ? `${Math.round(megabits)} Mbps` : `${megabits.toFixed(1)} Mbps`;
}

export function formatMilliseconds(milliseconds: number | undefined): string {
  if (milliseconds === undefined || !Number.isFinite(milliseconds)) return ABSENT;
  return `${milliseconds.toFixed(1)} ms`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `vp test speed-test-format`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing probe test**

Create `apps/web/test/connection-probe.test.ts`:

```ts
/*
 * The probe's contract: a fixed number of samples, a median (not a mean — one stalled request
 * must not move the answer), failed samples excluded rather than counted as zero, and total
 * failure reported as unreachable rather than as a very fast zero.
 */
import { describe, expect, it } from "vitest";
import {
  PROBE_SAMPLES,
  median,
  probeConnection,
  type ConnectionFacts,
} from "../src/lib/tools/speed-test/connection-probe.ts";

const FACTS: ConnectionFacts = {
  ip: "203.0.113.7",
  asn: 22773,
  asOrganization: "Cox Communications Inc.",
  colo: "LAS",
  country: "US",
};

describe("median", () => {
  it("returns the middle value of an odd-length set", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("averages the middle pair of an even-length set", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("returns null for an empty set", () => {
    expect(median([])).toBeNull();
  });
});

describe("probeConnection", () => {
  it("takes PROBE_SAMPLES samples and reports their median", async () => {
    let call = 0;
    // Each sample advances the clock by a known amount: 10, 20, 30, 40, 50 → median 30.
    const durations = [10, 20, 30, 40, 50];
    let clock = 0;
    const outcome = await probeConnection({
      fetchJson: async () => {
        clock += durations[call] ?? 0;
        call += 1;
        return FACTS;
      },
      now: () => clock,
    });
    expect(call).toBe(PROBE_SAMPLES);
    expect(outcome.medianRoundTripMs).toBe(30);
    expect(outcome.successfulSamples).toBe(PROBE_SAMPLES);
    expect(outcome.facts).toEqual(FACTS);
  });

  it("excludes a failed sample rather than counting it as zero", async () => {
    let call = 0;
    let clock = 0;
    const outcome = await probeConnection({
      fetchJson: async () => {
        call += 1;
        if (call === 1) throw new Error("network");
        clock += 20;
        return FACTS;
      },
      now: () => clock,
    });
    expect(outcome.successfulSamples).toBe(PROBE_SAMPLES - 1);
    expect(outcome.medianRoundTripMs).toBe(20);
  });

  it("reports unreachable when every sample fails", async () => {
    const outcome = await probeConnection({
      fetchJson: async () => {
        throw new Error("network");
      },
      now: () => 0,
    });
    expect(outcome.facts).toBeNull();
    expect(outcome.medianRoundTripMs).toBeNull();
    expect(outcome.successfulSamples).toBe(0);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `vp test connection-probe`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement the probe module**

Create `apps/web/src/lib/tools/speed-test/connection-probe.ts`:

```ts
/*
 * The round trip to Magna Carta. The connection route is authenticated and rides the chokepoint
 * like every other route, so what this measures is a REAL authenticated API call — the latency the
 * application actually experiences — not synthetic network round-trip. The interface says so.
 *
 * A median over a fixed sample count, because one stalled request must not move the answer, and a
 * failed sample is excluded rather than counted as zero (zero would read as instantaneous).
 */
export interface ConnectionFacts {
  readonly ip: string;
  readonly asn: number;
  readonly asOrganization: string;
  readonly colo: string;
  readonly country: string;
}

export interface ProbeOutcome {
  /** Null when every sample failed — the platform could not be reached. */
  readonly facts: ConnectionFacts | null;
  readonly medianRoundTripMs: number | null;
  readonly successfulSamples: number;
}

export interface ProbeDeps {
  readonly fetchJson: (url: string) => Promise<ConnectionFacts>;
  readonly now: () => number;
}

export const PROBE_SAMPLES = 5;

export const CONNECTION_URL = "/api/v1/tools/connection";

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (lower === undefined || upper === undefined) return null;
  return (lower + upper) / 2;
}

export async function probeConnection(deps: ProbeDeps): Promise<ProbeOutcome> {
  const durations: number[] = [];
  let facts: ConnectionFacts | null = null;

  for (let sample = 0; sample < PROBE_SAMPLES; sample += 1) {
    const started = deps.now();
    try {
      facts = await deps.fetchJson(CONNECTION_URL);
      durations.push(deps.now() - started);
    } catch {
      // A failed sample contributes nothing. If every sample fails the platform is unreachable,
      // which the outcome states rather than implying a very fast zero.
    }
  }

  if (durations.length === 0) return { facts: null, medianRoundTripMs: null, successfulSamples: 0 };
  return { facts, medianRoundTripMs: median(durations), successfulSamples: durations.length };
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `vp test connection-probe speed-test-format`
Expected: PASS (2 files, 12 tests).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/tools/speed-test/speed-test-format.ts apps/web/src/lib/tools/speed-test/connection-probe.ts apps/web/test/speed-test-format.test.ts apps/web/test/connection-probe.test.ts
git commit -m "feat(tools): speed-test formatting and connection-probe math"
```

---

### Task 3b: The probe must not blame the network for our own refusal

Task 3 shipped a probe that maps every failure to "unreachable". The application has no authenticated session yet, so the connection route answers `401` — and the panel would have told a lawyer their network was blocking Magna Carta when in fact they simply were not signed in. Separately, `tools:speedTest` is currently granted to **no seeded role**, so once auth lands the honest answer for most members is `403`. Neither is a network fault, and neither may be reported as one.

**Files:**
- Modify: `apps/web/src/lib/tools/speed-test/connection-probe.ts`
- Modify: `apps/web/test/connection-probe.test.ts`

- [ ] **Step 1: Rewrite the probe test**

Replace the `probeConnection` describe block in `apps/web/test/connection-probe.test.ts` with:

```ts
describe("probeConnection", () => {
  const reachable = async () => ({ ok: true as const, facts: FACTS });

  it("takes PROBE_SAMPLES samples and reports their median", async () => {
    let call = 0;
    let clock = 0;
    const durations = [10, 20, 30, 40, 50];
    const outcome = await probeConnection({
      fetchJson: async () => {
        clock += durations[call] ?? 0;
        call += 1;
        return { ok: true as const, facts: FACTS };
      },
      now: () => clock,
    });
    expect(call).toBe(PROBE_SAMPLES);
    expect(outcome.status).toBe("reachable");
    expect(outcome.medianRoundTripMs).toBe(30);
    expect(outcome.successfulSamples).toBe(PROBE_SAMPLES);
    expect(outcome.facts).toEqual(FACTS);
  });

  it("excludes a transport failure rather than counting it as zero", async () => {
    let call = 0;
    let clock = 0;
    const outcome = await probeConnection({
      fetchJson: async () => {
        call += 1;
        if (call === 1) return { ok: false as const, status: null };
        clock += 20;
        return { ok: true as const, facts: FACTS };
      },
      now: () => clock,
    });
    expect(outcome.status).toBe("reachable");
    expect(outcome.successfulSamples).toBe(PROBE_SAMPLES - 1);
    expect(outcome.medianRoundTripMs).toBe(20);
  });

  it("reports unreachable when every sample fails in transport", async () => {
    const outcome = await probeConnection({
      fetchJson: async () => ({ ok: false as const, status: null }),
      now: () => 0,
    });
    expect(outcome.status).toBe("unreachable");
    expect(outcome.facts).toBeNull();
    expect(outcome.medianRoundTripMs).toBeNull();
    expect(outcome.successfulSamples).toBe(0);
  });

  // The bug this whole task exists to prevent: a 401 is OUR missing session, never the firm's network.
  it("reports unauthenticated on a 401 and stops sampling immediately", async () => {
    let call = 0;
    const outcome = await probeConnection({
      fetchJson: async () => {
        call += 1;
        return { ok: false as const, status: 401 };
      },
      now: () => 0,
    });
    expect(outcome.status).toBe("unauthenticated");
    expect(call).toBe(1);
    expect(outcome.medianRoundTripMs).toBeNull();
  });

  it("reports forbidden on a 403 and stops sampling immediately", async () => {
    let call = 0;
    const outcome = await probeConnection({
      fetchJson: async () => {
        call += 1;
        return { ok: false as const, status: 403 };
      },
      now: () => 0,
    });
    expect(outcome.status).toBe("forbidden");
    expect(call).toBe(1);
  });

  it("treats a server error as a transport failure, not a refusal", async () => {
    const outcome = await probeConnection({
      fetchJson: async () => ({ ok: false as const, status: 500 }),
      now: () => 0,
    });
    expect(outcome.status).toBe("unreachable");
  });

  it("still succeeds when reachable", async () => {
    const outcome = await probeConnection({ fetchJson: reachable, now: () => 0 });
    expect(outcome.status).toBe("reachable");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `vp test connection-probe`
Expected: FAIL — `ProbeOutcome` has no `status`, and `fetchJson` no longer throws.

- [ ] **Step 3: Rewrite the probe**

Replace the exported types and `probeConnection` in `apps/web/src/lib/tools/speed-test/connection-probe.ts` (keep `ConnectionFacts`, `PROBE_SAMPLES`, `CONNECTION_URL`, and `median` exactly as they are):

```ts
/**
 * Why the probe can fail, kept apart on purpose. A diagnostic tool that reports our own refusal
 * as the caller's network failure sends someone to debug a firewall that was never at fault.
 */
export type ProbeStatus = "reachable" | "unauthenticated" | "forbidden" | "unreachable";

export interface ProbeOutcome {
  readonly status: ProbeStatus;
  /** Present only when reachable. */
  readonly facts: ConnectionFacts | null;
  readonly medianRoundTripMs: number | null;
  readonly successfulSamples: number;
}

/** `status: null` means the request never got an answer — a transport failure, not a refusal. */
export type FetchResult =
  | { readonly ok: true; readonly facts: ConnectionFacts }
  | { readonly ok: false; readonly status: number | null };

export interface ProbeDeps {
  readonly fetchJson: (url: string) => Promise<FetchResult>;
  readonly now: () => number;
}

function refused(status: ProbeStatus): ProbeOutcome {
  return { status, facts: null, medianRoundTripMs: null, successfulSamples: 0 };
}

export async function probeConnection(deps: ProbeDeps): Promise<ProbeOutcome> {
  const durations: number[] = [];
  let facts: ConnectionFacts | null = null;

  for (let sample = 0; sample < PROBE_SAMPLES; sample += 1) {
    const started = deps.now();
    const result = await deps.fetchJson(CONNECTION_URL);

    if (result.ok) {
      facts = result.facts;
      durations.push(deps.now() - started);
      continue;
    }

    // A refusal is an answer: the platform is reachable and said no. Retrying cannot change it.
    if (result.status === 401) return refused("unauthenticated");
    if (result.status === 403) return refused("forbidden");

    // Anything else (a transport failure, or a server error) is an excluded sample.
  }

  if (durations.length === 0) return refused("unreachable");
  return {
    status: "reachable",
    facts,
    medianRoundTripMs: median(durations),
    successfulSamples: durations.length,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `vp test connection-probe`
Expected: PASS (10 tests: 3 for `median`, 7 for `probeConnection`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/tools/speed-test/connection-probe.ts apps/web/test/connection-probe.test.ts
git commit -m "fix(tools): the probe distinguishes a refusal from an unreachable platform"
```

---

### Task 4: The engine store, the page, and the launchable tool

Delivers a working, runnable tool page: masthead, disclosures, Start/Pause/Retest, headline metrics, the Packet Loss statement, the connection panel, and the AIM scores. Charts arrive in Task 5.

**Files:**
- Modify: `pnpm-workspace.yaml` (catalog pin)
- Modify: `apps/web/package.json` (dependency)
- Create: `apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts`
- Create: `apps/web/src/lib/tools/speed-test/metric-tile.svelte`
- Create: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`
- Modify: `apps/web/src/lib/tools/tool-presentation.ts` (the `network-speed-test` entry)

**Interfaces:**
- Consumes: `formatBandwidth`, `formatMilliseconds`, `formatRatio` (Task 3); `probeConnection`, `CONNECTION_URL`, `type ProbeOutcome` (Task 3); `hasSurface` (Task 1, already wired).
- Produces: `createSpeedTestStore()` returning `{ phase, results, error, probe, start(), pause(), resume(), restart(), dispose() }`.

- [ ] **Step 1: Add the dependency**

In `pnpm-workspace.yaml`, add an exact pin under `catalog:` (match the quoting of the neighbouring scoped entries):

```yaml
  "@cloudflare/speedtest": 1.11.0
```

In `apps/web/package.json` `dependencies`, add:

```json
"@cloudflare/speedtest": "catalog:",
```

Run: `vp install`
Expected: completes; `apps/web/node_modules/@cloudflare/speedtest` exists.

- [ ] **Step 2: Read the shipped types before writing against them**

Open `apps/web/node_modules/@cloudflare/speedtest/dist/speedtest.d.ts` and note the exact exported names: the default export's constructor options, the `onRunningChange` / `onResultsChange` / `onFinish` / `onError` fields, and the `Results` methods (`getDownloadBandwidth`, `getUploadBandwidth`, `getUnloadedLatency`, `getUnloadedJitter`, `getDownLoadedLatency`, `getUpLoadedLatency`, `getPacketLoss`, `getScores`, `getSummary`). **Use the names the `.d.ts` actually declares** — do not guess, and do not `any`-cast around a mismatch. In particular, record the exact return type of `getScores()`; the AIM panel renders whatever keys it declares.

- [ ] **Step 3: Write the engine store**

Create `apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts`:

```ts
/*
 * The engine's lifecycle as reactive state. Cloudflare's measurement engine is imported lazily on
 * the first run: it is browser-only (it reads PerformanceResourceTiming) and there is no reason to
 * ship it to anyone who never presses Start.
 *
 * Cloudflare's default measurement ladder is used unmodified — that is what makes these numbers
 * comparable to speed.cloudflare.com. It transfers a lot of data, which is why nothing starts
 * without an explicit press, and why dispose() pauses the engine when the page goes away: a
 * backgrounded tab must never keep spending the firm's bandwidth.
 *
 * Packet loss is deliberately not measured. It requires a WebRTC TURN server, and the public one
 * Cloudflare offered is deprecated; the page states that rather than showing a fabricated zero.
 */
import {
  probeConnection,
  type ConnectionFacts,
  type FetchResult,
  type ProbeOutcome,
} from "./connection-probe.ts";

export type SpeedTestPhase = "idle" | "running" | "paused" | "finished" | "failed";

// Structural view of the engine's Results — only what this page renders. Reconcile the method names
// against dist/speedtest.d.ts; they are the library's, not ours.
export interface SpeedTestResults {
  getDownloadBandwidth(): number | undefined;
  getUploadBandwidth(): number | undefined;
  getUnloadedLatency(): number | undefined;
  getUnloadedJitter(): number | undefined;
  getDownLoadedLatency(): number | undefined;
  getUpLoadedLatency(): number | undefined;
  getDownloadBandwidthPoints(): ReadonlyArray<{ bytes: number; bps: number }>;
  getUploadBandwidthPoints(): ReadonlyArray<{ bytes: number; bps: number }>;
  getUnloadedLatencyPoints(): readonly number[];
  getDownLoadedLatencyPoints(): readonly number[];
  getUpLoadedLatencyPoints(): readonly number[];
  getScores(): unknown;
}

// Never throws: the probe needs to tell a refusal (the platform answered "no") apart from a
// transport failure (nothing answered at all), and an exception erases that distinction.
async function fetchConnectionFacts(url: string): Promise<FetchResult> {
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, facts: (await response.json()) as ConnectionFacts };
  } catch {
    return { ok: false, status: null };
  }
}

export function createSpeedTestStore() {
  let phase = $state<SpeedTestPhase>("idle");
  let results = $state<SpeedTestResults | null>(null);
  let error = $state<string | null>(null);
  let probe = $state<ProbeOutcome | null>(null);

  // The engine instance, once the module has been fetched. Not reactive: nothing renders it.
  let engine: {
    play(): void;
    pause(): void;
    restart(): void;
    onFinish: ((results: SpeedTestResults) => void) | undefined;
    onError: ((message: string) => void) | undefined;
    onResultsChange: (() => void) | undefined;
  } | null = null;

  async function ensureEngine(): Promise<void> {
    if (engine !== null) return;
    const { default: SpeedTest } = await import("@cloudflare/speedtest");
    // autoStart is false: a run spends the firm's bandwidth and only a press may begin it.
    const instance = new SpeedTest({ autoStart: false });
    instance.onResultsChange = () => {
      // Re-assign to publish the engine's mutation into reactive state.
      results = instance.results as unknown as SpeedTestResults;
    };
    instance.onFinish = (finished) => {
      results = finished;
      phase = "finished";
    };
    instance.onError = (message) => {
      error = message;
      phase = "failed";
    };
    engine = instance as unknown as typeof engine;
  }

  async function start(): Promise<void> {
    error = null;
    phase = "running";
    // The probe runs alongside the benchmark and fails independently: an unreachable platform
    // must not abort the connection measurement, and vice versa.
    void probeConnection({ fetchJson: fetchConnectionFacts, now: () => performance.now() }).then(
      (outcome) => {
        probe = outcome;
      },
    );
    try {
      await ensureEngine();
      engine?.play();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      phase = "failed";
    }
  }

  function pause(): void {
    engine?.pause();
    phase = "paused";
  }

  function resume(): void {
    engine?.play();
    phase = "running";
  }

  function restart(): void {
    results = null;
    error = null;
    probe = null;
    engine?.restart();
    phase = "running";
    void probeConnection({ fetchJson: fetchConnectionFacts, now: () => performance.now() }).then(
      (outcome) => {
        probe = outcome;
      },
    );
  }

  /** Leaving the page must stop the transfer — a background tab never keeps spending bandwidth. */
  function dispose(): void {
    engine?.pause();
    engine = null;
  }

  return {
    get phase() {
      return phase;
    },
    get results() {
      return results;
    },
    get error() {
      return error;
    },
    get probe() {
      return probe;
    },
    start,
    pause,
    resume,
    restart,
    dispose,
  };
}
```

If the `.d.ts` read in Step 2 contradicts any method name above, change this file to match the library and keep the structural interface honest.

- [ ] **Step 4: Write the metric tile**

Create `apps/web/src/lib/tools/speed-test/metric-tile.svelte`:

```svelte
<script lang="ts">
  /*
   * One headline measurement. `note` states why a metric is absent — a stated reason, never a
   * bare dash the reader must interpret.
   */
  import * as Card from "@magna-carta/design-system/card";

  let {
    label,
    value,
    note,
  }: { label: string; value: string; note?: string } = $props();
</script>

<Card.Root>
  <div class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
    {label}
  </div>
  <div class="mt-4 text-3xl">{value}</div>
  {#if note}
    <div class="mt-4 text-xs text-text-muted">{note}</div>
  {/if}
</Card.Root>
```

- [ ] **Step 5: Write the page**

Create `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`:

```svelte
<script lang="ts">
  /*
   * Network Speed Test — Cloudflare's own measurement engine, on their default ladder, so the
   * numbers are comparable to speed.cloudflare.com. Runs outside any matter and stores nothing.
   *
   * Nothing begins without a press: a full run transfers a large amount of data, and the caller's
   * address reaches Cloudflare's measurement endpoints. Both facts are stated before Start.
   */
  import { onDestroy } from "svelte";
  import Button from "@magna-carta/design-system/button";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import MetricTile from "$lib/tools/speed-test/metric-tile.svelte";
  import { createSpeedTestStore } from "$lib/tools/speed-test/speed-test-engine.svelte.ts";
  import {
    formatBandwidth,
    formatMilliseconds,
  } from "$lib/tools/speed-test/speed-test-format.ts";

  const store = createSpeedTestStore();
  onDestroy(() => store.dispose());

  const results = $derived(store.results);
  const probe = $derived(store.probe);
</script>

<svelte:head><title>Network Speed Test · Magna Carta</title></svelte:head>

<Masthead.Root class="mb-12">
  <Masthead.Heading>
    <Masthead.Title>Network Speed Test</Masthead.Title>
    <Masthead.Meta><span>Runs outside any matter</span></Masthead.Meta>
  </Masthead.Heading>
</Masthead.Root>

<section class="mb-12">
  {#if store.phase === "idle"}
    <p class="mb-4 text-sm text-text-muted">
      A full test can transfer around 200 MB of data. Your public address is shared with
      Cloudflare's measurement endpoints to run it. Nothing is saved.
    </p>
    <Button variant="primary" onclick={() => store.start()}>Start</Button>
  {:else if store.phase === "running"}
    <p class="mb-4 text-sm text-text-muted">Measuring…</p>
    <Button variant="secondary" onclick={() => store.pause()}>Pause</Button>
  {:else if store.phase === "paused"}
    <Button variant="primary" onclick={() => store.resume()}>Resume</Button>
  {:else}
    <Button variant="primary" onclick={() => store.restart()}>Retest</Button>
  {/if}

  {#if store.error}
    <p class="mt-8 text-sm text-status-critical-subtle-foreground">
      The measurement stopped: {store.error}. If this network filters
      speed.cloudflare.com, the test cannot run from here.
    </p>
  {/if}
</section>

<section class="mb-12 grid grid-cols-1 gap-16 sm:grid-cols-2 lg:grid-cols-3">
  <MetricTile label="Download" value={formatBandwidth(results?.getDownloadBandwidth())} />
  <MetricTile label="Upload" value={formatBandwidth(results?.getUploadBandwidth())} />
  <MetricTile label="Latency" value={formatMilliseconds(results?.getUnloadedLatency())} />
  <MetricTile label="Jitter" value={formatMilliseconds(results?.getUnloadedJitter())} />
  <MetricTile
    label="Packet loss"
    value="Unavailable"
    note="Measuring packet loss needs a TURN server; the public one Cloudflare offered is discontinued."
  />
</section>

<section class="mb-12">
  <h2 class="mb-8 border-b border-border-strong pb-8 text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
    Your connection
  </h2>
  {#if probe === null}
    <p class="text-sm text-text-muted">Not measured yet.</p>
  {:else if probe.status === "unauthenticated"}
    <p class="text-sm text-text-muted">
      You are not signed in, so the round trip to Magna Carta was not measured. This says nothing
      about your connection — the measurements above still describe it.
    </p>
  {:else if probe.status === "forbidden"}
    <p class="text-sm text-text-muted">
      Your account does not carry permission to run this check, so the round trip to Magna Carta
      was not measured. Your connection is unaffected.
    </p>
  {:else if probe.status === "unreachable"}
    <p class="text-sm text-text-muted">
      Magna Carta could not be reached from this network. The measurements above, if present,
      still describe your internet connection.
    </p>
  {:else if probe.facts !== null}
    <dl class="grid grid-cols-1 gap-8 text-sm sm:grid-cols-2">
      <div><dt class="text-text-muted">Public address</dt><dd>{probe.facts.ip}</dd></div>
      <div><dt class="text-text-muted">Network</dt><dd>{probe.facts.asOrganization} (AS{probe.facts.asn})</dd></div>
      <div><dt class="text-text-muted">Served from</dt><dd>{probe.facts.colo}</dd></div>
      <div>
        <dt class="text-text-muted">Round trip to Magna Carta</dt>
        <dd>{formatMilliseconds(probe.medianRoundTripMs ?? undefined)}</dd>
      </div>
    </dl>
    <p class="mt-8 text-xs text-text-muted">
      Measured as a real authenticated request, median of {probe.successfulSamples} samples. A
      healthy round trip here alongside poor bandwidth above means the connection, not the
      platform, is the constraint.
    </p>
  {/if}
</section>
```

Verify `text-status-critical-subtle-foreground` and `border-border-strong` exist in this project's theme (`packages/design-tokens/generated/tailwind-theme.css`); substitute the real token class if either does not.

- [ ] **Step 6: Make the tool launchable**

In `apps/web/src/lib/tools/tool-presentation.ts`, change the `network-speed-test` entry to:

```ts
  "network-speed-test": {
    description: "Measure this connection's download, upload, latency, and quality.",
    stage: "alpha",
  },
```

- [ ] **Step 7: Verify the gates**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

Run: `vp test speed-test-format connection-probe maturity-has-surface tools-presentation`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add pnpm-workspace.yaml apps/web/package.json pnpm-lock.yaml apps/web/src/lib/tools/speed-test apps/web/src/lib/tools/tool-presentation.ts "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "feat(tools): network speed test page on the Cloudflare engine"
```

---

### Task 4b: The Network Quality Score panel (a gap in Task 4)

The design spec lists "Network Quality Score" as a rendered section, and Task 4's goal line promised it, but Task 4's literal page code never included it. That is a plan defect, not an implementer oversight. Task 4 typed `getScores(): Scores` honestly against the shipped `.d.ts`, so the shape is known and nothing needs re-deriving.

From `apps/web/node_modules/@cloudflare/speedtest/dist/speedtest.d.ts`:

```ts
type ClassificationName = "bad" | "poor" | "average" | "good" | "great";
interface ExperienceScore { points: number; classificationIdx: number; classificationName: ClassificationName }
type Scores = Record<string, ExperienceScore>;
```

The keys are use-case names the library chooses (`streaming`, `gaming`, `rtc` today). Because the type is `Record<string, …>`, the panel must **label the keys it knows and fall back to the raw key** — never assume a fixed set, and never drop a use-case the library adds.

**Files:**
- Create: `apps/web/src/lib/tools/speed-test/quality-scores.svelte`
- Create: `apps/web/src/lib/tools/speed-test/quality-labels.ts`
- Modify: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`
- Test: `apps/web/test/quality-labels.test.ts`

**Interfaces:**
- Produces: `useCaseLabel(key: string): string`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/quality-labels.test.ts`:

```ts
/*
 * The library types its scores as Record<string, ExperienceScore>, so the set of use-cases is the
 * library's to change. A key we do not recognize must still render under its own name rather than
 * vanish from the panel.
 */
import { describe, expect, it } from "vitest";
import { useCaseLabel } from "../src/lib/tools/speed-test/quality-labels.ts";

describe("useCaseLabel", () => {
  it("labels the use-cases the engine reports today", () => {
    expect(useCaseLabel("streaming")).toBe("Video streaming");
    expect(useCaseLabel("gaming")).toBe("Online gaming");
    expect(useCaseLabel("rtc")).toBe("Video calls");
  });

  it("falls back to the raw key for a use-case it does not know", () => {
    expect(useCaseLabel("teleportation")).toBe("teleportation");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `vp test quality-labels`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the labels**

Create `apps/web/src/lib/tools/speed-test/quality-labels.ts`:

```ts
/*
 * The engine scores the connection per use-case and types the set as Record<string, …>, so the
 * use-cases are its to choose. We name the ones it reports today and pass anything else through
 * under its own key: an unlabelled score is still a score, and dropping it would hide a fact.
 */
const USE_CASE_LABELS: Record<string, string> = {
  streaming: "Video streaming",
  gaming: "Online gaming",
  rtc: "Video calls",
};

export function useCaseLabel(key: string): string {
  return USE_CASE_LABELS[key] ?? key;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `vp test quality-labels`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the panel**

Create `apps/web/src/lib/tools/speed-test/quality-scores.svelte`:

```svelte
<script lang="ts">
  /*
   * The engine's per-use-case verdict on this connection. The classification word carries the
   * meaning, so it is never conveyed by colour alone; the point total sits beside it for anyone
   * who wants the number. Renders nothing until a run has produced scores.
   */
  import type { Scores } from "@cloudflare/speedtest";
  import { useCaseLabel } from "./quality-labels.ts";

  let { scores }: { scores: Scores | undefined } = $props();

  const entries = $derived(Object.entries(scores ?? {}));
</script>

{#if entries.length > 0}
  <dl class="grid grid-cols-1 gap-8 text-sm sm:grid-cols-3">
    {#each entries as [key, score] (key)}
      <div>
        <dt class="text-text-muted">{useCaseLabel(key)}</dt>
        <dd class="mt-4 text-lg capitalize">{score.classificationName}</dd>
        <dd class="text-xs text-text-muted">{score.points} points</dd>
      </div>
    {/each}
  </dl>
{:else}
  <p class="text-sm text-text-muted">Scored once a run finishes.</p>
{/if}
```

Confirm `Scores` is importable from `@cloudflare/speedtest` (the `.d.ts` exports it at line 435). If the runtime entry does not re-export the type, import it from the store's structural interface instead — never `any`.

- [ ] **Step 6: Mount it on the page**

In `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`, import it:

```ts
  import QualityScores from "$lib/tools/speed-test/quality-scores.svelte";
```

and add this section immediately after the headline-metrics grid and before the "Your connection" section (reuse the exact `<h2>` classes the sibling sections on this page already use — do not invent new ones):

```svelte
<section class="mb-12">
  <h2 class="mb-8 border-b border-border-strong pb-8 text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
    Network quality score
  </h2>
  <QualityScores scores={results?.getScores()} />
</section>
```

If `border-border-strong` or `--mc-tracking-caps` is not what the sibling sections on this page actually use, copy whatever they use verbatim rather than the above.

- [ ] **Step 7: Verify the gates**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

Run: `vp test quality-labels speed-test-format connection-probe`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/tools/speed-test/quality-labels.ts apps/web/src/lib/tools/speed-test/quality-scores.svelte apps/web/test/quality-labels.test.ts "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "feat(tools): network quality score panel"
```

---

### Task 5: Measurement charts

**Files:**
- Create: `apps/web/src/lib/tools/speed-test/bandwidth-chart.svelte`
- Create: `apps/web/src/lib/tools/speed-test/latency-chart.svelte`
- Create: `apps/web/src/lib/tools/speed-test/chart-scale.ts`
- Modify: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`
- Test: `apps/web/test/chart-scale.test.ts`

**Interfaces:**
- Produces: `scaleLinear(domainMax: number, rangeMax: number): (value: number) => number`; `niceMax(values: readonly number[]): number`.

Every series here is single-series, so: no legend, no categorical palette, no cycled hues. The three latency phases render as three small multiples, exactly as Cloudflare renders them, which avoids overlaying series on one axis.

- [ ] **Step 1: Write the failing scale test**

Create `apps/web/test/chart-scale.test.ts`:

```ts
/*
 * Chart geometry, pinned. An empty series must not produce a zero domain (which would divide by
 * zero and collapse every bar onto the baseline).
 */
import { describe, expect, it } from "vitest";
import { niceMax, scaleLinear } from "../src/lib/tools/speed-test/chart-scale.ts";

describe("niceMax", () => {
  it("rounds up to a readable ceiling", () => {
    expect(niceMax([12, 47, 31])).toBe(50);
  });

  it("returns 1 for an empty series so the scale never divides by zero", () => {
    expect(niceMax([])).toBe(1);
  });

  it("returns 1 when every value is zero", () => {
    expect(niceMax([0, 0])).toBe(1);
  });
});

describe("scaleLinear", () => {
  it("maps the domain maximum onto the range maximum", () => {
    expect(scaleLinear(50, 100)(50)).toBe(100);
  });

  it("maps zero onto zero", () => {
    expect(scaleLinear(50, 100)(0)).toBe(0);
  });

  it("clamps a value beyond the domain to the range maximum", () => {
    expect(scaleLinear(50, 100)(75)).toBe(100);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `vp test chart-scale`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the scale module**

Create `apps/web/src/lib/tools/speed-test/chart-scale.ts`:

```ts
/*
 * The only arithmetic a single-series chart needs. An empty or all-zero series yields a domain of
 * 1 rather than 0: a zero domain divides by zero and collapses every mark onto the baseline.
 */

/** Round a series' maximum up to a readable ceiling (1, 2, or 5 x a power of ten). */
export function niceMax(values: readonly number[]): number {
  const largest = values.reduce((carry, value) => (value > carry ? value : carry), 0);
  if (largest <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(largest));
  const normalized = largest / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/** A clamped linear map from [0, domainMax] onto [0, rangeMax]. */
export function scaleLinear(domainMax: number, rangeMax: number): (value: number) => number {
  const safeDomain = domainMax > 0 ? domainMax : 1;
  return (value) => {
    const scaled = (value / safeDomain) * rangeMax;
    if (scaled < 0) return 0;
    return scaled > rangeMax ? rangeMax : scaled;
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `vp test chart-scale`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the bandwidth chart**

Create `apps/web/src/lib/tools/speed-test/bandwidth-chart.svelte`:

```svelte
<script lang="ts">
  /*
   * One bandwidth series across the engine's scaling buckets. Single series, so the title names it
   * and no legend appears; the axis is recessive and the value labels wear text tokens, never the
   * mark's color. A table view accompanies the chart so the values are never conveyed by mark
   * geometry alone.
   */
  import { niceMax, scaleLinear } from "./chart-scale.ts";
  import { formatBandwidth } from "./speed-test-format.ts";

  let {
    title,
    points,
  }: { title: string; points: ReadonlyArray<{ bytes: number; bps: number }> } = $props();

  const HEIGHT = 96;
  const BAR = 16;
  const GAP = 8;

  const megabits = $derived(points.map((point) => point.bps / 1e6));
  const ceiling = $derived(niceMax(megabits));
  const scale = $derived(scaleLinear(ceiling, HEIGHT));
  const width = $derived(Math.max(points.length * (BAR + GAP), BAR));
</script>

<figure class="m-0">
  <figcaption class="mb-8 text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
    {title}
  </figcaption>

  {#if points.length === 0}
    <p class="text-sm text-text-muted">Not measured yet.</p>
  {:else}
    <svg
      viewBox={`0 0 ${width} ${HEIGHT}`}
      width="100%"
      height={HEIGHT}
      role="img"
      aria-label={`${title}: ${points.length} measurements, peak ${formatBandwidth(Math.max(...points.map((p) => p.bps)))}`}
    >
      {#each points as point, index (index)}
        {@const barHeight = scale(point.bps / 1e6)}
        <rect
          x={index * (BAR + GAP)}
          y={HEIGHT - barHeight}
          width={BAR}
          height={barHeight}
          rx="4"
          fill="var(--mc-accent-default)"
        >
          <title>{formatBandwidth(point.bps)}</title>
        </rect>
      {/each}
    </svg>

    <details class="mt-8">
      <summary class="cursor-pointer text-xs text-text-muted">Table view</summary>
      <table class="mt-8 w-full text-left text-sm">
        <thead>
          <tr><th scope="col" class="font-medium text-text-muted">Transfer</th><th scope="col" class="font-medium text-text-muted">Speed</th></tr>
        </thead>
        <tbody>
          {#each points as point, index (index)}
            <tr>
              <td>{Math.round(point.bytes / 1000)} kB</td>
              <td>{formatBandwidth(point.bps)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </details>
  {/if}
</figure>
```

Confirm `--mc-accent-default` exists in `packages/design-tokens/generated/tailwind-theme.css`; if the accent token is named differently, use the real one. Never a raw color.

- [ ] **Step 6: Write the latency chart**

Create `apps/web/src/lib/tools/speed-test/latency-chart.svelte`:

```svelte
<script lang="ts">
  /*
   * One latency phase as a point series — a small multiple. The three phases (idle, during
   * download, during upload) each get their own chart rather than sharing one axis, which is how
   * the measurement reads honestly and why no categorical palette is needed.
   */
  import { niceMax, scaleLinear } from "./chart-scale.ts";
  import { formatMilliseconds } from "./speed-test-format.ts";

  let { title, points }: { title: string; points: readonly number[] } = $props();

  const HEIGHT = 80;
  const STEP = 12;
  const RADIUS = 4;

  const ceiling = $derived(niceMax(points));
  const scale = $derived(scaleLinear(ceiling, HEIGHT - RADIUS * 2));
  const width = $derived(Math.max(points.length * STEP, STEP));
</script>

<figure class="m-0">
  <figcaption class="mb-8 text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
    {title}
  </figcaption>

  {#if points.length === 0}
    <p class="text-sm text-text-muted">Not measured yet.</p>
  {:else}
    <svg
      viewBox={`0 0 ${width} ${HEIGHT}`}
      width="100%"
      height={HEIGHT}
      role="img"
      aria-label={`${title}: ${points.length} samples, peak ${formatMilliseconds(Math.max(...points))}`}
    >
      {#each points as value, index (index)}
        <circle
          cx={index * STEP + RADIUS}
          cy={HEIGHT - RADIUS - scale(value)}
          r={RADIUS}
          fill="var(--mc-accent-default)"
        >
          <title>{formatMilliseconds(value)}</title>
        </circle>
      {/each}
    </svg>

    <details class="mt-8">
      <summary class="cursor-pointer text-xs text-text-muted">Table view</summary>
      <ol class="mt-8 text-sm">
        {#each points as value, index (index)}
          <li>{formatMilliseconds(value)}</li>
        {/each}
      </ol>
    </details>
  {/if}
</figure>
```

- [ ] **Step 7: Mount the charts on the page**

In `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`, add the imports:

```ts
  import BandwidthChart from "$lib/tools/speed-test/bandwidth-chart.svelte";
  import LatencyChart from "$lib/tools/speed-test/latency-chart.svelte";
```

and append two sections after the "Your connection" section:

```svelte
<section class="mb-12">
  <h2 class="mb-8 border-b border-border-strong pb-8 text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
    Latency measurements
  </h2>
  <div class="grid grid-cols-1 gap-16 lg:grid-cols-3">
    <LatencyChart title="Idle" points={results?.getUnloadedLatencyPoints() ?? []} />
    <LatencyChart title="During download" points={results?.getDownLoadedLatencyPoints() ?? []} />
    <LatencyChart title="During upload" points={results?.getUpLoadedLatencyPoints() ?? []} />
  </div>
</section>

<section class="mb-12">
  <h2 class="mb-8 border-b border-border-strong pb-8 text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
    Bandwidth measurements
  </h2>
  <div class="grid grid-cols-1 gap-16 lg:grid-cols-2">
    <BandwidthChart title="Download" points={results?.getDownloadBandwidthPoints() ?? []} />
    <BandwidthChart title="Upload" points={results?.getUploadBandwidthPoints() ?? []} />
  </div>
</section>
```

- [ ] **Step 8: Verify the gates**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

Run: `vp test chart-scale speed-test-format connection-probe`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/tools/speed-test/chart-scale.ts apps/web/src/lib/tools/speed-test/bandwidth-chart.svelte apps/web/src/lib/tools/speed-test/latency-chart.svelte apps/web/test/chart-scale.test.ts "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "feat(tools): single-series bandwidth and latency charts"
```

---

### Task 6: Documentation (definition of done)

No feature is done until its docs, roadmap, and changelog fragment land. Branches never hand-edit `CHANGELOG.md` or `STATUS.md` — they commit fragments.

**Files:**
- Create: `changelog.d/network-speed-test.md`
- Create: `docs/user/network-speed-test.md`
- Modify: `status.d/tools-area.md`
- Modify: `ROADMAP.md` (the Stage 3 "first tool widgets" line)
- Modify: `docs/active-work/slice-0-7b-app-shell.md`

- [ ] **Step 1: Write the changelog fragment**

Create `changelog.d/network-speed-test.md`:

```markdown
---
category: Added
---

Network Speed Test — the Tools area's first working tool measures your connection: download and upload speed, latency, and jitter, using the same measurement engine as Cloudflare's own speed test, so the numbers are comparable. It also reports the round trip to Magna Carta beside them, which answers the question a slow morning actually raises: is it the internet, or is it us? A test transfers a substantial amount of data and never begins until you press Start. Nothing is saved.
```

- [ ] **Step 2: Write the user guide**

Create `docs/user/network-speed-test.md`:

```markdown
# Network Speed Test

The Network Speed Test measures the connection you are working on right now. Find it under
**Tools → Network Speed Test**. Nothing you do here is saved, and it is not attached to any matter.

## Running a test

Press **Start**. The test takes about a minute and transfers a substantial amount of data — around
200 MB — so avoid running it on a metered or tethered connection. It does not begin on its own.

While it runs you may **Pause** and **Resume**. When it finishes, **Retest** runs it again.

## What the numbers mean

- **Download** and **Upload** — how much data your connection carries per second. Higher is better.
- **Latency** — how long a single request takes to make the round trip. Lower is better.
- **Jitter** — how much that latency varies. High jitter makes video calls stutter even when the
  download speed looks healthy.
- **Packet loss** — currently unavailable. Measuring it requires a separate kind of server that is
  no longer offered publicly.

## Is it the internet, or is it Magna Carta?

The **Your connection** panel shows the round trip to Magna Carta, measured as a real request. Read
it beside the numbers above:

- Slow download **and** a slow round trip — the connection is struggling.
- Healthy round trip **but** slow download — the connection is constrained somewhere other than the
  path to us.
- "Magna Carta could not be reached" — the network is blocking or failing to route to us. Your
  internet may still be fine.

## Privacy

Running the test shares your public address with Cloudflare's measurement endpoints, which is how
they route and time the transfer. No firm data, client data, or file content is ever sent — only
meaningless test bytes. Results are not stored.
```

- [ ] **Step 3: Update the status fragment**

In `status.d/tools-area.md`, change the body's last sentence to state that the first tool page has shipped, and set:

```yaml
ui: in-progress by="Opus 4.8"
next: remaining per-tool pages
```

Body sentence to use:

```
`@magna-carta/tools` catalog + firm-usage diagnostics (`GET /api/v1/firm-usage`) on `main`. The `/tools` listing page renders the catalog grouped by subject, as tiles or a dense list, each entry badged with its maturity stage. Network Speed Test is the first tool with its own page (stage `alpha`); the rest still read "Soon" and land one at a time.
```

- [ ] **Step 4: Update the roadmap**

In `ROADMAP.md`, the Stage 3 bullet currently reads:

```
- **First tool widgets (backends done + tested):** Metadata Inspector & Scrubber (upload + findings + scrub options + download), File Hash & Integrity, File Type Verifier, the network speed test (`@cloudflare/speedtest`), the firm-usage snapshot view.
```

Replace it with:

```
- **First tool widgets (backends done + tested):** the network speed test has shipped (`@cloudflare/speedtest`, on Cloudflare's default ladder, with an authenticated round-trip probe beside it). Remaining: Metadata Inspector & Scrubber (upload + findings + scrub options + download), File Hash & Integrity, File Type Verifier, the firm-usage snapshot view.
```

- [ ] **Step 5: Amend the active-work note**

In `docs/active-work/slice-0-7b-app-shell.md`, the Coordination paragraph says backend is read-only for this stream. Append to that paragraph:

```
One exception, recorded rather than left contradicted: the Network Speed Test adds a single additive, read-only worker route (`GET /api/v1/tools/connection`) that reads only `request.cf`. No schema, no data-access layer, no existing handler is touched.
```

- [ ] **Step 6: Verify the docs gates**

Run: `pnpm run lint:status`
Expected: unchanged from before this branch's work — this branch does not introduce a new status-fragment failure. (Two pre-existing failures unrelated to this work are known: `status.d/service-status.md` points at a missing active-work file, and a duplicate `cross-cutting#14` ordering. Do not fix them here.)

Run: `pnpm run lint:process-refs`
Expected: unchanged count from before this task — no new process-artifact reference in source.

- [ ] **Step 7: Commit**

```bash
git add changelog.d/network-speed-test.md docs/user/network-speed-test.md status.d/tools-area.md ROADMAP.md docs/active-work/slice-0-7b-app-shell.md
git commit -m "docs(tools): changelog, user guide, status, and roadmap for the speed test"
```

---

## Self-Review

**Spec coverage.** Engine + default ladder → Task 4. No autostart + both disclosures → Task 4 Step 5. Packet loss stated unavailable → Task 4 Step 5 (`MetricTile` `note`). Connection route → Task 2. Probe median / independent failure → Task 3 + Task 4 Step 3. Nothing persisted → no storage anywhere in the plan. Charts token-styled, single-series, table view → Task 5. Launchable-rule fix in the maturity module → Task 1. Stage `alpha` + new descriptor → Task 4 Step 6. Error handling (engine error, blocked endpoints, unreachable platform, navigate-away abort) → Task 4 Steps 3+5. Testing (format, probe math, `hasSurface`, worker route, browser) → Tasks 1, 2, 3, 5 + the browser verification below. Definition of done incl. `docs/user/` → Task 6. Coordination amendment → Task 6 Step 5. Contract obligations (snapshot + client regen) → Task 2 Step 5.

**Placeholder scan.** No TBD/TODO. The one "read the `.d.ts`" instruction (Task 4 Step 2) is a concrete action with a named file, and the code that follows is complete and reconcilable — not a blank to fill. Two token-name verifications (`--mc-accent-default`, `text-status-critical-subtle-foreground`, `border-border-strong`) name the exact file to check against.

**Type consistency.** `ConnectionFacts`, `ProbeOutcome`, `ProbeDeps`, `PROBE_SAMPLES`, `CONNECTION_URL`, `median`, `probeConnection` are defined in Task 3 and consumed unchanged in Task 4. `formatBandwidth` / `formatMilliseconds` are defined in Task 3 and used in Tasks 4 and 5. `niceMax` / `scaleLinear` are defined in Task 5 Step 3 and consumed by both charts. `hasSurface` is defined in Task 1 and consumed by both tool components. `createSpeedTestStore()`'s returned shape (`phase`, `results`, `error`, `probe`, `start`, `pause`, `resume`, `restart`, `dispose`) matches every call site on the page.

**YAGNI.** A `formatRatio` helper was drafted for packet loss and removed: packet loss is stated unavailable, so nothing calls it. It arrives with the TURN service that makes the measurement real, not before.

## Browser verification (coordinator, after Task 5)

Serve `apps/web` (`vp dev`) and open `/tools/network-speed-test`. Confirm:

1. The page does **not** start measuring on load; both disclosures are visible; Start begins the run.
2. Download, Upload, Latency, and Jitter populate as the run progresses; Packet loss reads "Unavailable" with its reason.
3. The "Your connection" panel resolves — public address, network operator, edge, and round trip — or states plainly that Magna Carta could not be reached.
4. Latency renders as three small multiples; bandwidth as two bar charts; each has a working table view.
5. Retest re-runs; Pause halts the transfer.
6. Navigating away mid-run stops the transfer (the network panel in devtools goes quiet).
7. Both light and dark mode read correctly.
8. `/tools` now shows Network Speed Test as a **link** wearing a "Beta" badge, while every other tool remains inert with "Soon".
