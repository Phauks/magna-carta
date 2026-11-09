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

The Tools listing gates launchability on `stage === "ready"`. That is wrong: the maturity model measures how _finished_ a surface is, not whether it _exists_ — `destinations.ts` ships `Settings` as `shipped: true, stage: "alpha"` and it is a live link wearing an "Alpha" badge. Under the current rule a working `alpha`/`beta` tool renders inert and unreachable. The rule belongs in `maturity.ts`, which declares itself the one home for the stage model.

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
import {
  MATURITY_PRESENTATION,
  hasSurface,
  type MaturityStage,
} from "../src/lib/maturity/maturity.ts";

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

- Create: `apps/worker/src/routes/tools/tools-connection.ts`
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

Create `apps/worker/src/routes/tools/tools-connection.ts`:

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
import { registerToolsConnectionRoute } from "./routes/tools/tools-connection.ts";
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
git add apps/worker/src/routes/tools/tools-connection.ts apps/worker/src/app.ts apps/worker/openapi/openapi.json apps/worker/test/tools-connection.test.ts packages/api-client
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

> **Amended after Task 3 landed.** The first draft collapsed every failure into "unreachable". That is a lie a diagnostic tool must never tell: the app has no authenticated session yet, so the route answers `401`, and the panel would have blamed the firm's network for our own missing sign-in. The outcome now distinguishes _not signed in_ and _not permitted_ from _genuinely unreachable_, and an auth refusal stops the sampling loop immediately rather than retrying four more times.

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
interface ExperienceScore {
  points: number;
  classificationIdx: number;
  classificationName: ClassificationName;
}
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

### Task 4c: Kill the packet-loss error, move the controls, add the server panel, rank the metrics

Owner ran the page and hit a fatal error:

> The measurement stopped: Error while measuring packet loss: unable to get turn server credentials.

**Root cause.** The engine's built-in measurement ladder contains a `packetLoss` step. Nothing disabled it, so the engine attempted it, failed to obtain TURN credentials, and fired `onError` — which the store treats as fatal, ending the whole run. The error copy then blamed the firm's network for filtering `speed.cloudflare.com`, which was never true. **The fix is to stop asking the engine to measure packet loss at all**, not to soften the message. The Packet Loss tile keeps stating that the measurement is unavailable.

**Verified facts (from the shipped `.d.ts` and a live browser check — do not re-derive):**

- `ConfigOptions.measurements: MeasurementConfig[]`, and **no default ladder is exported**, so it must be written out explicitly, minus the `packetLoss` step.
- `BandwidthMeasurementConfig = { type: "download" | "upload"; bytes: number; count: number; bypassMinDuration?: boolean }`.
- `LatencyMeasurementConfig = { type: "latency"; numPackets: number }`.
- `https://speed.cloudflare.com/meta` is **CORS-open** and returns `{ clientIp, asn, asOrganization, country, city, region, httpProtocol, colo: { iata, city } }`. This is the source for the server panel; it needs no session, so it works even though our own connection route currently answers `401`.

**Files:**

- Modify: `apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts`
- Modify: `apps/web/src/lib/tools/speed-test/metric-tile.svelte`
- Modify: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`
- Create: `apps/web/src/lib/tools/speed-test/measurement-ladder.ts`
- Create: `apps/web/src/lib/tools/speed-test/speed-test-meta.ts`
- Create: `apps/web/src/lib/tools/speed-test/server-panel.svelte`
- Test: `apps/web/test/measurement-ladder.test.ts`
- Test: `apps/web/test/speed-test-meta.test.ts`

**Interfaces:**

- Produces: `MEASUREMENT_LADDER: MeasurementConfig[]`; `MeasurementServer`, `META_URL`, `parseMeasurementServer(raw: unknown): MeasurementServer | null`, `ipVersion(clientIp: string): "IPv4" | "IPv6"`, `fetchMeasurementServer(fetchJson): Promise<MeasurementServer | null>`.
- The store gains `meta: MeasurementServer | null` and loads it on creation (before any run), as `speed.cloudflare.com` does.

- [ ] **Step 1: Write the failing ladder test**

Create `apps/web/test/measurement-ladder.test.ts`:

```ts
/*
 * The ladder is Cloudflare's own, minus the packetLoss step. Packet loss needs a WebRTC TURN
 * server we do not run; leaving the step in makes the engine fail the ENTIRE run on a credential
 * error. This test is the guard against someone "restoring the defaults".
 */
import { describe, expect, it } from "vitest";
import { MEASUREMENT_LADDER } from "../src/lib/tools/speed-test/measurement-ladder.ts";

describe("MEASUREMENT_LADDER", () => {
  it("never asks the engine to measure packet loss", () => {
    expect(MEASUREMENT_LADDER.some((step) => step.type === "packetLoss")).toBe(false);
  });

  it("keeps latency, download and upload phases", () => {
    const types = new Set(MEASUREMENT_LADDER.map((step) => step.type));
    expect(types).toEqual(new Set(["latency", "download", "upload"]));
  });

  it("climbs to Cloudflare's largest payloads so results stay comparable", () => {
    const downloadBytes = MEASUREMENT_LADDER.filter((s) => s.type === "download").map((s) =>
      "bytes" in s ? s.bytes : 0,
    );
    const uploadBytes = MEASUREMENT_LADDER.filter((s) => s.type === "upload").map((s) =>
      "bytes" in s ? s.bytes : 0,
    );
    expect(Math.max(...downloadBytes)).toBe(2.5e8);
    expect(Math.max(...uploadBytes)).toBe(5e7);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `vp test measurement-ladder`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the ladder**

Create `apps/web/src/lib/tools/speed-test/measurement-ladder.ts`:

```ts
/*
 * Cloudflare's measurement ladder, written out because the library exports no default to borrow
 * from — and with its `packetLoss` step deliberately removed.
 *
 * Packet loss is measured by relaying UDP through a WebRTC TURN server. Cloudflare's public TURN
 * server is discontinued and we run none, so the step can only fail — and a failure there aborts
 * the whole run, taking the bandwidth and latency results with it. Every other phase is theirs,
 * unchanged, which is what keeps these numbers comparable to speed.cloudflare.com.
 */
import type { MeasurementConfig } from "@cloudflare/speedtest";

export const MEASUREMENT_LADDER: MeasurementConfig[] = [
  { type: "latency", numPackets: 1 },
  { type: "download", bytes: 1e5, count: 1, bypassMinDuration: true },
  { type: "latency", numPackets: 20 },
  { type: "download", bytes: 1e5, count: 9 },
  { type: "download", bytes: 1e6, count: 8 },
  { type: "upload", bytes: 1e5, count: 8 },
  { type: "upload", bytes: 1e6, count: 6 },
  { type: "download", bytes: 1e7, count: 6 },
  { type: "upload", bytes: 1e7, count: 4 },
  { type: "download", bytes: 2.5e7, count: 4 },
  { type: "upload", bytes: 2.5e7, count: 4 },
  { type: "download", bytes: 1e8, count: 3 },
  { type: "upload", bytes: 5e7, count: 3 },
  { type: "download", bytes: 2.5e8, count: 2 },
];
```

- [ ] **Step 4: Run it to verify it passes**

Run: `vp test measurement-ladder`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing meta test**

Create `apps/web/test/speed-test-meta.test.ts`:

```ts
/*
 * The measurement server, as Cloudflare's own page reports it. A malformed body must yield null
 * rather than a half-filled panel of undefineds.
 */
import { describe, expect, it } from "vitest";
import {
  fetchMeasurementServer,
  ipVersion,
  parseMeasurementServer,
} from "../src/lib/tools/speed-test/speed-test-meta.ts";

const RAW = {
  clientIp: "24.234.27.182",
  asn: 22773,
  asOrganization: "Cox Communications Inc.",
  country: "US",
  city: "Las Vegas",
  region: "Nevada",
  httpProtocol: "HTTP/1.1",
  colo: { iata: "LAS", city: "Las Vegas" },
};

describe("ipVersion", () => {
  it("reads a dotted address as IPv4", () => {
    expect(ipVersion("24.234.27.182")).toBe("IPv4");
  });

  it("reads a colonned address as IPv6", () => {
    expect(ipVersion("2606:4700:4700::1111")).toBe("IPv6");
  });
});

describe("parseMeasurementServer", () => {
  it("reads the fields Cloudflare's meta endpoint returns", () => {
    expect(parseMeasurementServer(RAW)).toEqual({
      clientIp: "24.234.27.182",
      asn: 22773,
      asOrganization: "Cox Communications Inc.",
      city: "Las Vegas",
      region: "Nevada",
      country: "US",
      coloIata: "LAS",
      coloCity: "Las Vegas",
    });
  });

  it("returns null for a body that is not the shape we expect", () => {
    expect(parseMeasurementServer({ clientIp: 42 })).toBeNull();
    expect(parseMeasurementServer(null)).toBeNull();
    expect(parseMeasurementServer("nope")).toBeNull();
  });
});

describe("fetchMeasurementServer", () => {
  it("returns null rather than throwing when the endpoint is unreachable", async () => {
    const server = await fetchMeasurementServer(async () => {
      throw new Error("offline");
    });
    expect(server).toBeNull();
  });

  it("parses a good response", async () => {
    const server = await fetchMeasurementServer(async () => RAW);
    expect(server?.coloIata).toBe("LAS");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `vp test speed-test-meta`
Expected: FAIL — module not found.

- [ ] **Step 7: Write the meta module**

Create `apps/web/src/lib/tools/speed-test/speed-test-meta.ts`:

```ts
/*
 * Who served the measurement, and who you are to them. Cloudflare's own speed test reads this from
 * a CORS-open endpoint that needs no session — which is why this panel fills in even when our own
 * connection route refuses us.
 *
 * Parsing is defensive: a body that is not the shape we expect yields null, so the panel says
 * nothing rather than showing a row of undefineds.
 */
export const META_URL = "https://speed.cloudflare.com/meta";

export interface MeasurementServer {
  readonly clientIp: string;
  readonly asn: number;
  readonly asOrganization: string;
  readonly city: string;
  readonly region: string;
  readonly country: string;
  /** The Cloudflare edge airport code that served the measurement, e.g. "LAS". */
  readonly coloIata: string;
  readonly coloCity: string;
}

/** An IPv6 address contains a colon; an IPv4 address never does. */
export function ipVersion(clientIp: string): "IPv4" | "IPv6" {
  return clientIp.includes(":") ? "IPv6" : "IPv4";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseMeasurementServer(raw: unknown): MeasurementServer | null {
  if (!isRecord(raw) || !isRecord(raw["colo"])) return null;
  const colo = raw["colo"];
  const clientIp = raw["clientIp"];
  const asn = raw["asn"];
  const asOrganization = raw["asOrganization"];
  const city = raw["city"];
  const region = raw["region"];
  const country = raw["country"];
  const coloIata = colo["iata"];
  const coloCity = colo["city"];

  if (
    typeof clientIp !== "string" ||
    typeof asn !== "number" ||
    typeof asOrganization !== "string" ||
    typeof city !== "string" ||
    typeof region !== "string" ||
    typeof country !== "string" ||
    typeof coloIata !== "string" ||
    typeof coloCity !== "string"
  ) {
    return null;
  }

  return { clientIp, asn, asOrganization, city, region, country, coloIata, coloCity };
}

/** Never throws: an unreachable endpoint simply means the panel has nothing to say. */
export async function fetchMeasurementServer(
  fetchJson: (url: string) => Promise<unknown>,
): Promise<MeasurementServer | null> {
  try {
    return parseMeasurementServer(await fetchJson(META_URL));
  } catch {
    return null;
  }
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `vp test speed-test-meta measurement-ladder`
Expected: PASS (2 files, 9 tests).

- [ ] **Step 9: Wire the ladder and the meta into the store**

In `apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts`:

1. Import `MEASUREMENT_LADDER` and pass it to the engine constructor alongside `autoStart: false`:

```ts
const instance = new SpeedTest({ autoStart: false, measurements: MEASUREMENT_LADDER });
```

2. Import `fetchMeasurementServer` and `type MeasurementServer`. Add reactive state `let meta = $state<MeasurementServer | null>(null);`, load it once when the store is created (not on Start — Cloudflare shows the server before you run), and expose it via a `get meta()` accessor:

```ts
void fetchMeasurementServer(async (url) => {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`meta responded ${response.status}`);
  return response.json();
}).then((server) => {
  meta = server;
});
```

3. Keep `onError` as-is, but it must no longer be reachable for packet loss. Do not change its behaviour otherwise.

4. **Record when the run finished.** Add `let finishedAt = $state<Date | null>(null);` and a `get finishedAt()` accessor. Set it to `new Date()` inside `onFinish`. Clear it to `null` at the top of `start()` and `restart()`, so a stale timestamp never sits above a fresh run. Nothing is persisted — this is the run in front of you, not a history.

- [ ] **Step 10: Give the metric tile a rank**

In `apps/web/src/lib/tools/speed-test/metric-tile.svelte`, add a `size` prop (`"large" | "small"`, default `"small"`). Large tiles render the value at the page's largest metric size; small tiles a step down. Use only the project's existing text-size utilities — verify each exists. Do not change the tile's structure, and keep `note` rendering exactly as it is.

- [ ] **Step 11: Write the server panel**

Create `apps/web/src/lib/tools/speed-test/server-panel.svelte`:

```svelte
<script lang="ts">
  /*
   * Who served the measurement, and who you are to them — the same four facts Cloudflare's own
   * speed test states. The round trip to Magna Carta sits beside them because that is the one
   * thing their page cannot tell you.
   */
  import { formatMilliseconds } from "./speed-test-format.ts";
  import { ipVersion, type MeasurementServer } from "./speed-test-meta.ts";
  import type { ProbeOutcome } from "./connection-probe.ts";

  let {
    meta,
    probe,
  }: { meta: MeasurementServer | null; probe: ProbeOutcome | null } = $props();
</script>

{#if meta === null}
  <p class="text-sm text-text-muted">The measurement server has not identified itself.</p>
{:else}
  <dl class="grid grid-cols-1 gap-8 text-sm sm:grid-cols-2">
    <div><dt class="text-text-muted">Connected via</dt><dd>{ipVersion(meta.clientIp)}</dd></div>
    <div><dt class="text-text-muted">Server location</dt><dd>{meta.coloCity} ({meta.coloIata})</dd></div>
    <div><dt class="text-text-muted">Your network</dt><dd>{meta.asOrganization} (AS{meta.asn})</dd></div>
    <div><dt class="text-text-muted">Your IP address</dt><dd>{meta.clientIp}</dd></div>
  </dl>
{/if}

<div class="mt-16">
  {#if probe === null}
    <p class="text-sm text-text-muted">The round trip to Magna Carta has not been measured yet.</p>
  {:else if probe.status === "unauthenticated"}
    <p class="text-sm text-text-muted">
      You are not signed in, so the round trip to Magna Carta was not measured. This says nothing
      about your connection.
    </p>
  {:else if probe.status === "forbidden"}
    <p class="text-sm text-text-muted">
      Your account does not carry permission to run this check, so the round trip to Magna Carta was
      not measured. Your connection is unaffected.
    </p>
  {:else if probe.status === "unreachable"}
    <p class="text-sm text-text-muted">
      Magna Carta could not be reached from this network. The measurements above still describe your
      internet connection.
    </p>
  {:else}
    <p class="text-sm">
      <span class="text-text-muted">Round trip to Magna Carta</span>
      <span class="ml-8">{formatMilliseconds(probe.medianRoundTripMs ?? undefined)}</span>
    </p>
    <p class="mt-4 text-xs text-text-muted">
      Measured as a real authenticated request, median of {probe.successfulSamples} samples. A healthy
      round trip here alongside poor bandwidth means the connection, not the platform, is the
      constraint.
    </p>
  {/if}
</div>
```

- [ ] **Step 12: Restructure the page**

In `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`:

1. **Move the run controls into `Masthead.Actions`** so starting a test never reflows the page. The masthead becomes:

```svelte
<Masthead.Root class="mb-12">
  <Masthead.Heading>
    <Masthead.Title>Network Speed Test</Masthead.Title>
    <Masthead.Meta>
      <span>Runs outside any matter</span>
      {#if store.finishedAt}
        <Masthead.MetaSeparator />
        <span>Run at {store.finishedAt.toLocaleTimeString()} on {store.finishedAt.toLocaleDateString()}</span>
      {/if}
    </Masthead.Meta>
  </Masthead.Heading>
  <Masthead.Actions>
    {#if store.phase === "idle"}
      <Button variant="primary" onclick={() => store.start()}>Start</Button>
    {:else if store.phase === "running"}
      <span class="mr-8 text-sm text-text-muted">Measuring…</span>
      <Button variant="secondary" onclick={() => store.pause()}>Pause</Button>
    {:else if store.phase === "paused"}
      <Button variant="primary" onclick={() => store.resume()}>Resume</Button>
    {:else}
      <Button variant="primary" onclick={() => store.restart()}>Retest</Button>
    {/if}
  </Masthead.Actions>
</Masthead.Root>
```

The "Measuring…" text occupies the space the Pause button already reserves, so nothing below it moves.

2. The disclosures stay as a paragraph above the metrics, shown only while `store.phase === "idle"`.

3. **The error paragraph must no longer blame the network.** Replace it with:

```svelte
{#if store.error}
  <p class="mt-8 text-sm text-status-danger-subtle-foreground">
    The measurement stopped: {store.error}
  </p>
{/if}
```

4. **Rank the metrics.** Download and Upload are what the test is for; latency, jitter and packet loss describe the connection's character. Two rows:

```svelte
<section class="mb-12 grid grid-cols-1 gap-16 sm:grid-cols-2">
  <MetricTile size="large" label="Download" value={formatBandwidth(results?.getDownloadBandwidth())} />
  <MetricTile size="large" label="Upload" value={formatBandwidth(results?.getUploadBandwidth())} />
</section>

<section class="mb-12 grid grid-cols-1 gap-16 sm:grid-cols-3">
  <MetricTile label="Latency" value={formatMilliseconds(results?.getUnloadedLatency())} />
  <MetricTile label="Jitter" value={formatMilliseconds(results?.getUnloadedJitter())} />
  <MetricTile
    label="Packet loss"
    value="Unavailable"
    note="Measuring packet loss needs a TURN server; the public one Cloudflare offered is discontinued."
  />
</section>
```

5. Replace the old inline "Your connection" markup with the new panel, keeping the section heading markup already on the page:

```svelte
<ServerPanel meta={store.meta} probe={store.probe} />
```

- [ ] **Step 13: Verify the gates**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

Run: `vp test measurement-ladder speed-test-meta speed-test-format connection-probe quality-labels`
Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add apps/web/src/lib/tools/speed-test apps/web/test/measurement-ladder.test.ts apps/web/test/speed-test-meta.test.ts "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "fix(tools): drop the packet-loss phase, rank the metrics, name the measurement server"
```

---

### Task 4d: Packet loss, by capability detection

Owner asked for packet loss. It is buildable: Cloudflare Realtime mints short-lived TURN credentials, TURN shares a 1,000 GB free tier with SFU, and a packet-loss run relays about a thousand small UDP packets — under a megabyte. Bandwidth is not the constraint.

**The constraint is that the credential route must be authenticated, and the application has no session yet.** An open TURN-credential endpoint is a free relay vending machine billed to the firm's account, so it is gated on `tools:speedTest`. If we simply restored the `packetLoss` step, the engine would request credentials, receive `401`, and abort the entire run — exactly the failure Task 4c fixed.

So the engine is told to measure packet loss **only when credentials are actually obtainable**. Ask first; choose the ladder from the answer. This works today (no session → no credentials → the ladder without packet loss, and the tile says why), and it begins measuring on its own the moment the secrets exist and a session is present. Nothing has to be remembered and switched on.

**Verified facts (from the shipped `.d.ts` and Cloudflare's docs — do not re-derive):**

- `ConfigOptions.turnServerUri` defaults to `turn.speed.cloudflare.com:50000`, the **deprecated public server**. With our own key it MUST be overridden to `turn.cloudflare.com:3478`.
- `ConfigOptions.turnServerCredsApiUrl` is a URL the engine fetches; it must answer `{ username, credential }`. `turnServerUser` / `turnServerPass` stay `null` so credentials are fetched dynamically.
- `PacketLossMeasurementConfig` requires `type`, `numPackets`, `batchSize`, `batchWaitTime`, `responsesWaitTime` (`connectionTimeout` optional).
- `Results.getPacketLoss(): number | undefined`.
- Cloudflare mints credentials at `POST https://rtc.live.cloudflare.com/v1/turn/keys/{TURN_KEY_ID}/credentials/generate-ice-servers`, `Authorization: Bearer {TURN_KEY_API_TOKEN}`, body `{"ttl": <seconds>}`, answering `201` with `{ iceServers: [ { urls: [...] }, { urls: [...], username, credential } ] }`. The `username`/`credential` live on the entry that has them — not necessarily the first.

**Owner action required (I cannot do this):** create a Realtime TURN key in the Cloudflare dashboard and set two Worker secrets, `REALTIME_TURN_TOKEN_ID` and `REALTIME_TURN_TOKEN_SECRET`. Until then the route answers `503` and the tile states that packet loss is not configured.

**Files:**

- Create: `apps/worker/src/routes/tools/tools-turn-credentials.ts`
- Modify: `apps/worker/src/app.ts` (one import, one registration)
- Modify: `apps/worker/openapi/openapi.json`, `packages/api-client/**` (regenerated, never hand-edited)
- Test: `apps/worker/test/tools-turn-credentials.test.ts`
- Create: `apps/web/src/lib/tools/speed-test/turn-capability.ts`
- Modify: `apps/web/src/lib/tools/speed-test/measurement-ladder.ts`
- Modify: `apps/web/src/lib/tools/speed-test/speed-test-format.ts` (restore `formatRatio` — it now has a consumer)
- Modify: `apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts`
- Modify: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`
- Test: `apps/web/test/turn-capability.test.ts`, `apps/web/test/measurement-ladder.test.ts` (extend), `apps/web/test/speed-test-format.test.ts` (extend)

**Interfaces:**

- Worker produces: `GET /api/v1/tools/turn-credentials` → `200 { username, credential }` · `401` · `403` · `503` (TURN key not configured) · `502` (upstream refused).
- Frontend produces: `TurnCapability`, `probeTurnCapability(fetchStatus)`, `LADDER_WITH_PACKET_LOSS`, `formatRatio`.

#### Part A — the Worker route

- [ ] **Step 1: Write the failing test**

Create `apps/worker/test/tools-turn-credentials.test.ts`. Mirror the session/permission seeding harness of `apps/worker/test/tools-connection.test.ts` exactly (read it first). Assert:

1. `401` for an unauthenticated caller, with `content-type: application/problem+json`.
2. `403` for an authenticated member lacking `tools:speedTest`.
3. `503` for a permitted member when the TURN secrets are absent from the test environment (they are), and that the problem body does **not** contain the words "token" or "secret".
4. The path appears in the emitted OpenAPI contract.

- [ ] **Step 2: Run it to verify it fails**

Run: `vp test tools-turn-credentials`
Expected: FAIL — the path 404s.

- [ ] **Step 3: Write the route**

Create `apps/worker/src/routes/tools/tools-turn-credentials.ts`, following `apps/worker/src/routes/tools/tools-connection.ts` for structure:

```ts
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

// Minted per run and short-lived on purpose. A TURN credential is a relay authorization billed to
// this account, so it is never long-lived and never handed to an unauthenticated caller.
const CREDENTIAL_TTL_SECONDS = 600;

const TurnCredentials = z
  .object({ username: z.string(), credential: z.string() })
  .openapi("TurnCredentials");

export const toolsTurnCredentialsMeta: RouteMeta = {
  operationId: "toolsTurnCredentials.get",
  surface: "app",
  authenticated: true,
  permission: "tools:speedTest",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "expensive",
};

export const toolsTurnCredentialsRoute = defineOpenAPIRoute(toolsTurnCredentialsMeta, {
  method: "get",
  path: "/api/v1/tools/turn-credentials",
  description:
    "Short-lived relay credentials used to measure packet loss. Answers 503 when relay measurement is not configured.",
  responses: {
    200: {
      description: "Short-lived relay credentials",
      content: { "application/json": { schema: TurnCredentials } },
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
    502: {
      description: "The relay credential service refused",
      content: { "application/problem+json": { schema: Problem } },
    },
    503: {
      description: "Relay measurement is not configured for this deployment",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

// Cloudflare answers with a list of ICE servers; only one entry carries credentials. Find it by the
// fields we need rather than by position.
function credentialsFrom(payload: unknown): { username: string; credential: string } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const servers = (payload as { iceServers?: unknown }).iceServers;
  if (!Array.isArray(servers)) return null;
  for (const server of servers) {
    if (typeof server !== "object" || server === null) continue;
    const { username, credential } = server as { username?: unknown; credential?: unknown };
    if (typeof username === "string" && typeof credential === "string") {
      return { username, credential };
    }
  }
  return null;
}

export function registerToolsTurnCredentialsRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...toolsTurnCredentialsRoute,
      middleware: chokepointMiddleware(chokepoint, toolsTurnCredentialsRoute),
    },
    async (c) => {
      const keyId = c.env.REALTIME_TURN_TOKEN_ID;
      const apiToken = c.env.REALTIME_TURN_TOKEN_SECRET;

      // Not an error to report upstream: this deployment simply does not measure packet loss. The
      // caller-facing detail never names the secrets.
      if (!keyId || !apiToken) {
        return c.json(
          {
            type: "about:blank",
            title: "Relay measurement is not configured",
            status: 503,
            detail: "This deployment cannot measure packet loss.",
          },
          503,
        );
      }

      const upstream = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
          body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
        },
      );

      // Never surface the upstream body: it may echo the key id.
      if (!upstream.ok) {
        return c.json(
          {
            type: "about:blank",
            title: "The relay credential service refused",
            status: 502,
            detail: "Packet loss could not be measured.",
          },
          502,
        );
      }

      const credentials = credentialsFrom(await upstream.json());
      if (credentials === null) {
        return c.json(
          {
            type: "about:blank",
            title: "The relay credential service refused",
            status: 502,
            detail: "Packet loss could not be measured.",
          },
          502,
        );
      }

      return c.json(credentials, 200);
    },
  );
}
```

Add `REALTIME_TURN_TOKEN_ID` and `REALTIME_TURN_TOKEN_SECRET` to the `Bindings` type in `apps/worker/src/app.ts` as optional strings, beside the other secrets. **Never log either value, and never log the minted credential.**

- [ ] **Step 4: Register, re-emit, regenerate**

Add the import and `registerToolsTurnCredentialsRoute(app, chokepoint);` beside `registerToolsConnectionRoute`.

Run: `pnpm --filter @magna-carta/worker run emit-openapi`
Run: `pnpm run generate-client`

- [ ] **Step 5: Run the worker tests**

Run: `vp test tools-turn-credentials tools-connection openapi-snapshot`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/routes/tools/tools-turn-credentials.ts apps/worker/src/app.ts apps/worker/openapi/openapi.json apps/worker/test/tools-turn-credentials.test.ts packages/api-client
git commit -m "feat(tools): short-lived relay credentials for packet-loss measurement"
```

#### Part B — capability detection in the client

- [ ] **Step 7: Write the failing capability test**

Create `apps/web/test/turn-capability.test.ts`:

```ts
/*
 * Whether packet loss can be measured at all. Asking first is what keeps a missing session or an
 * unprovisioned key from aborting the whole run — the engine is only ever told to measure packet
 * loss when the credentials behind it actually exist.
 */
import { describe, expect, it } from "vitest";
import { probeTurnCapability } from "../src/lib/tools/speed-test/turn-capability.ts";

describe("probeTurnCapability", () => {
  it("is available when credentials are issued", async () => {
    expect(await probeTurnCapability(async () => 200)).toEqual({ available: true });
  });

  it("names a missing session", async () => {
    expect(await probeTurnCapability(async () => 401)).toEqual({
      available: false,
      reason: "unauthenticated",
    });
  });

  it("names a missing permission", async () => {
    expect(await probeTurnCapability(async () => 403)).toEqual({
      available: false,
      reason: "forbidden",
    });
  });

  it("names an unconfigured deployment", async () => {
    expect(await probeTurnCapability(async () => 503)).toEqual({
      available: false,
      reason: "not-configured",
    });
  });

  it("falls back to unavailable for any other answer", async () => {
    expect(await probeTurnCapability(async () => 502)).toEqual({
      available: false,
      reason: "unavailable",
    });
  });

  it("treats a transport failure as unavailable rather than throwing", async () => {
    const capability = await probeTurnCapability(async () => {
      throw new Error("offline");
    });
    expect(capability).toEqual({ available: false, reason: "unavailable" });
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `vp test turn-capability`
Expected: FAIL — module not found.

- [ ] **Step 9: Write the capability module**

Create `apps/web/src/lib/tools/speed-test/turn-capability.ts`:

```ts
/*
 * Packet loss is relayed through a TURN server, and the credentials for it are minted by an
 * authenticated route. Ask whether they can be had BEFORE telling the engine to measure: a refused
 * credential mid-run aborts the entire test, taking the bandwidth and latency results with it.
 *
 * Each refusal names itself, so the page can say which of them happened instead of showing a blank.
 */
export const TURN_CREDENTIALS_URL = "/api/v1/tools/turn-credentials";

export type TurnUnavailableReason =
  | "unauthenticated"
  | "forbidden"
  | "not-configured"
  | "unavailable";

export type TurnCapability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: TurnUnavailableReason };

/** `fetchStatus` answers the HTTP status, or throws on a transport failure. */
export async function probeTurnCapability(
  fetchStatus: (url: string) => Promise<number>,
): Promise<TurnCapability> {
  let status: number;
  try {
    status = await fetchStatus(TURN_CREDENTIALS_URL);
  } catch {
    return { available: false, reason: "unavailable" };
  }

  if (status === 200) return { available: true };
  if (status === 401) return { available: false, reason: "unauthenticated" };
  if (status === 403) return { available: false, reason: "forbidden" };
  if (status === 503) return { available: false, reason: "not-configured" };
  return { available: false, reason: "unavailable" };
}

/** What the Packet loss tile says when the measurement could not be attempted. */
export function turnUnavailableNote(reason: TurnUnavailableReason): string {
  switch (reason) {
    case "unauthenticated":
      return "Sign in to measure packet loss.";
    case "forbidden":
      return "Your account does not carry permission to measure packet loss.";
    case "not-configured":
      return "This deployment is not set up to measure packet loss.";
    case "unavailable":
      return "The relay needed to measure packet loss could not be reached.";
  }
}
```

- [ ] **Step 10: Run it to verify it passes**

Run: `vp test turn-capability`
Expected: PASS (6 tests).

- [ ] **Step 11: Extend the ladder**

In `apps/web/src/lib/tools/speed-test/measurement-ladder.ts`, keep `MEASUREMENT_LADDER` exactly as it is and add:

```ts
/*
 * Cloudflare's ladder with the packet-loss phase restored, in the position their own default puts
 * it: after the first upload round. Used only when credentials for the relay were actually obtained
 * — see turn-capability.ts. The batch figures are the library's documented defaults.
 */
export const LADDER_WITH_PACKET_LOSS: MeasurementConfig[] = [
  { type: "latency", numPackets: 1 },
  { type: "download", bytes: 1e5, count: 1, bypassMinDuration: true },
  { type: "latency", numPackets: 20 },
  { type: "download", bytes: 1e5, count: 9 },
  { type: "download", bytes: 1e6, count: 8 },
  { type: "upload", bytes: 1e5, count: 8 },
  {
    type: "packetLoss",
    numPackets: 1e3,
    batchSize: 10,
    batchWaitTime: 10,
    responsesWaitTime: 3000,
  },
  { type: "upload", bytes: 1e6, count: 6 },
  { type: "download", bytes: 1e7, count: 6 },
  { type: "upload", bytes: 1e7, count: 4 },
  { type: "download", bytes: 2.5e7, count: 4 },
  { type: "upload", bytes: 2.5e7, count: 4 },
  { type: "download", bytes: 1e8, count: 3 },
  { type: "upload", bytes: 5e7, count: 3 },
  { type: "download", bytes: 2.5e8, count: 2 },
];
```

Add to `apps/web/test/measurement-ladder.test.ts`:

```ts
describe("LADDER_WITH_PACKET_LOSS", () => {
  it("adds exactly one packet-loss phase and changes nothing else", () => {
    expect(LADDER_WITH_PACKET_LOSS.filter((step) => step.type === "packetLoss")).toHaveLength(1);
    const withoutPacketLoss = LADDER_WITH_PACKET_LOSS.filter((step) => step.type !== "packetLoss");
    expect(withoutPacketLoss).toEqual(MEASUREMENT_LADDER);
  });
});
```

- [ ] **Step 12: Restore `formatRatio`**

In `apps/web/src/lib/tools/speed-test/speed-test-format.ts` add back:

```ts
/** A 0–1 ratio (packet loss) as a percentage; a whole percentage keeps no decimal. */
export function formatRatio(ratio: number | undefined): string {
  if (ratio === undefined || !Number.isFinite(ratio)) return ABSENT;
  const percentage = ratio * 100;
  return Number.isInteger(percentage) ? `${percentage}%` : `${percentage.toFixed(1)}%`;
}
```

and to `apps/web/test/speed-test-format.test.ts`:

```ts
describe("formatRatio", () => {
  it("renders a loss ratio as a percentage", () => {
    expect(formatRatio(0.004)).toBe("0.4%");
  });

  it("renders zero loss as 0%", () => {
    expect(formatRatio(0)).toBe("0%");
  });

  it("renders an absent measurement as an em dash", () => {
    expect(formatRatio(undefined)).toBe("—");
  });
});
```

- [ ] **Step 13: Wire it into the store**

In `apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts`:

1. Add `let turn = $state<TurnCapability | null>(null);` with a `get turn()` accessor, and `getPacketLoss()` to the structural `SpeedTestResults` interface and to `snapshotResults`.
2. In `start()`, determine the capability **before** building the engine:

```ts
turn = await probeTurnCapability(async (url) => {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  return response.status;
});
```

3. Build the engine from that capability. Because the ladder is fixed at construction, `ensureEngine` takes it as an argument, and `restart()` disposes and rebuilds so a member who signs in mid-session gets packet loss on the next run:

```ts
const options = turn.available
  ? {
      autoStart: false,
      measurements: LADDER_WITH_PACKET_LOSS,
      // The default points at Cloudflare's discontinued public relay; ours is the Realtime one.
      turnServerUri: "turn.cloudflare.com:3478",
      turnServerCredsApiUrl: TURN_CREDENTIALS_URL,
    }
  : { autoStart: false, measurements: MEASUREMENT_LADDER };
```

Leave `turnServerUser` / `turnServerPass` unset so the engine fetches credentials dynamically.

- [ ] **Step 14: Render the tile honestly**

In the page, the Packet loss tile becomes:

```svelte
{#if store.turn?.available}
  <MetricTile label="Packet loss" value={formatRatio(results?.getPacketLoss())} />
{:else if store.turn}
  <MetricTile label="Packet loss" value="Unavailable" note={turnUnavailableNote(store.turn.reason)} />
{:else}
  <MetricTile label="Packet loss" value="—" note="Measured when a test runs." />
{/if}
```

- [ ] **Step 15: Verify the gates**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

Run: `vp test turn-capability measurement-ladder speed-test-format speed-test-meta connection-probe quality-labels`
Expected: PASS.

- [ ] **Step 16: Commit**

```bash
git add apps/web/src/lib/tools/speed-test apps/web/test/turn-capability.test.ts apps/web/test/measurement-ladder.test.ts apps/web/test/speed-test-format.test.ts "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "feat(tools): measure packet loss when the relay credentials can be had"
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

### Task 7: Explain the scores, and show the distribution behind the headline

Owner asked for two things: an affordance explaining what Cloudflare's scores mean and how they are derived, and richer statistics beside Download and Upload.

**Verified facts — do not re-derive:**

- The headline Download and Upload figures are the **90th percentile** of the sample set (`bandwidthPercentile` defaults to `0.9`). The headline Latency is the **median** (`latencyPercentile: 0.5`). Most readers assume a mean; say otherwise.
- One run produces **33 download samples and 25 upload samples** (sum the `count` fields of `MEASUREMENT_LADDER`). At n=33 a 99th percentile is the maximum wearing decimals — do **not** render a p99. Median, 95th percentile, peak, and the sample count are honest at this size.
- `getDownloadBandwidthPoints()` / `getUploadBandwidthPoints()` return `BandwidthPoint[]` with a `bps` field.
- **AIM** is Cloudflare's _Aggregated Internet Measurement_. Three categories (streaming, gaming, webchat/RTC), five classifications (bad, poor, average, good, great).
- **The rubric IS published** — in the blog post, not the fundamentals page. Link to `https://blog.cloudflare.com/aim-database-for-internet-quality/`.
  - Points by threshold: packet loss `>5%`→0, `<5%`→5, `<1%`→10 · jitter `>20ms`→0, `<20ms`→5, `<10ms`→10 · unloaded latency `>100ms`→0, `<50ms`→5, `<20ms`→10, `<10ms`→20 · loaded-minus-unloaded latency difference `>50ms`→0, `<50ms`→5, `<20ms`→10, `<10ms`→20 · download and upload throughput `<1Mbps`→0, `<10`→5, `<50`→10, `<100`→20, `<1000`→30.
  - Which metrics feed which category: **streaming** = download + unloaded latency + packet loss + loaded-latency difference; **gaming** = packet loss + unloaded latency + loaded-latency difference; **video calls (RTC)** = packet loss + jitter + unloaded latency + loaded-latency difference.
  - The point ranges that map onto the five classifications are **not** published. That, and only that, may be called undisclosed.
- **Packet loss feeds all three categories, and we do not measure it.** Online gaming draws on only three metrics in total, one of them packet loss. Every score is therefore computed with an input missing, and gaming with a third of its inputs missing. The popover must say this plainly — an unqualified verdict would claim more authority than the measurement has.
- The design system exports `popover` (`Popover.Root/Trigger/Content/Close`). A tooltip is the wrong vessel: this content contains a link and must be keyboard-reachable.

**Files:**

- Create: `apps/web/src/lib/tools/speed-test/bandwidth-stats.ts`
- Create: `apps/web/src/lib/tools/speed-test/info-popover.svelte`
- Modify: `apps/web/src/lib/tools/speed-test/metric-tile.svelte` (optional `stats` + `info` snippet)
- Modify: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`
- Test: `apps/web/test/bandwidth-stats.test.ts`

**Interfaces:**

- Produces: `percentile(values: readonly number[], fraction: number): number | null`; `BandwidthStats { median: number; p95: number; peak: number; samples: number }`; `bandwidthStats(points: ReadonlyArray<{ bps: number }>): BandwidthStats | null`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/bandwidth-stats.test.ts`:

```ts
/*
 * The distribution behind the headline. The headline itself is the engine's 90th percentile; these
 * are the numbers that let a reader judge it. A 99th percentile is deliberately absent: one run
 * yields ~33 download samples, and at that size p99 is the maximum with decorations.
 */
import { describe, expect, it } from "vitest";
import { bandwidthStats, percentile } from "../src/lib/tools/speed-test/bandwidth-stats.ts";

describe("percentile", () => {
  it("returns the median at 0.5", () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
  });

  it("uses nearest-rank, so p95 of ten values is the tenth", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
  });

  it("returns the single value for a one-element set", () => {
    expect(percentile([7], 0.95)).toBe(7);
  });

  it("returns null for an empty set", () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  it("does not care about input order", () => {
    expect(percentile([5, 1, 4, 2, 3], 0.5)).toBe(3);
  });
});

describe("bandwidthStats", () => {
  it("summarizes the sample set", () => {
    const points = [10, 20, 30, 40].map((bps) => ({ bps }));
    expect(bandwidthStats(points)).toEqual({ median: 20, p95: 40, peak: 40, samples: 4 });
  });

  it("returns null when nothing was measured", () => {
    expect(bandwidthStats([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `vp test bandwidth-stats`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/tools/speed-test/bandwidth-stats.ts`:

```ts
/*
 * The distribution behind the headline figure.
 *
 * The engine reports bandwidth at the 90th percentile of its samples, not the mean — so a single
 * number hides how consistent the connection was. Median, 95th percentile and peak, shown with the
 * sample count, let a reader judge that for themselves.
 *
 * There is deliberately no 99th percentile: a run yields about thirty download samples, and at that
 * size the 99th percentile is simply the maximum. Reporting it would dress a single observation up
 * as a distribution.
 *
 * Nearest-rank, not interpolation: every value returned is a bandwidth this connection actually
 * achieved, never one it never reached.
 */
export interface BandwidthStats {
  readonly median: number;
  readonly p95: number;
  readonly peak: number;
  readonly samples: number;
}

export function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[index] ?? null;
}

export function bandwidthStats(points: ReadonlyArray<{ bps: number }>): BandwidthStats | null {
  if (points.length === 0) return null;
  const values = points.map((point) => point.bps);
  const median = percentile(values, 0.5);
  const p95 = percentile(values, 0.95);
  const peak = percentile(values, 1);
  if (median === null || p95 === null || peak === null) return null;
  return { median, p95, peak, samples: values.length };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `vp test bandwidth-stats`
Expected: PASS (7 tests).

- [ ] **Step 5: Build the info popover**

Create `apps/web/src/lib/tools/speed-test/info-popover.svelte`. A small icon button opens a popover holding explanatory prose and, optionally, a link out. It must be keyboard reachable and carry an accessible name.

```svelte
<script lang="ts">
  /*
   * The "what does this number mean" affordance. A popover, not a tooltip: the content carries a
   * link and must be reachable by keyboard, which a hover tooltip is not.
   */
  import Info from "@lucide/svelte/icons/info";
  import * as Popover from "@magna-carta/design-system/popover";
  import type { Snippet } from "svelte";

  let {
    label,
    children,
  }: { label: string; children: Snippet } = $props();
</script>

<Popover.Root>
  <Popover.Trigger aria-label={label} class="text-text-muted">
    <Info class="size-16" aria-hidden="true" />
  </Popover.Trigger>
  <Popover.Content class="max-w-96 text-sm">
    {@render children()}
  </Popover.Content>
</Popover.Root>
```

Verify `size-16` is the icon size this project uses (the codebase-wide convention) and that `max-w-96` exists on the closed scale; substitute real classes otherwise. Confirm `Popover.Trigger` forwards `aria-label` and `class`; if it does not, wrap a `Button variant="ghost"` inside it instead.

- [ ] **Step 6: Extend the metric tile**

In `apps/web/src/lib/tools/speed-test/metric-tile.svelte`, add two optional props without disturbing the existing structure:

- `info?: Snippet` — rendered beside the label.
- `stats?: ReadonlyArray<{ label: string; value: string }>` — rendered under the value as a quiet row (small-caps label over value), using existing text tokens only.

- [ ] **Step 7: Mount both on the page**

Import `bandwidthStats`, `formatBandwidth`, and `InfoPopover`. Derive:

```ts
const downloadStats = $derived(bandwidthStats(results?.getDownloadBandwidthPoints() ?? []));
const uploadStats = $derived(bandwidthStats(results?.getUploadBandwidthPoints() ?? []));

function statRows(stats: ReturnType<typeof bandwidthStats>) {
  if (stats === null) return undefined;
  return [
    { label: "Median", value: formatBandwidth(stats.median) },
    { label: "95th", value: formatBandwidth(stats.p95) },
    { label: "Peak", value: formatBandwidth(stats.peak) },
    { label: "Samples", value: String(stats.samples) },
  ];
}
```

Pass `stats={statRows(downloadStats)}` and `stats={statRows(uploadStats)}` to the two large tiles, and give each an `info` snippet:

> The headline figure is the 90th percentile of this run's samples, not an average — nine measurements in ten were at least this fast. The median, 95th percentile and peak below show how consistent the connection was.

Give the **Latency** tile an info snippet too:

> The median of this run's latency samples, measured while the connection was idle.

And put an `InfoPopover` beside the **Network quality score** heading:

> Cloudflare's Aggregated Internet Measurement scores this connection for video streaming, online gaming, and video calls, rating each bad, poor, average, good, or great.
>
> Each measurement earns points against published thresholds — unloaded latency, for instance, scores 20 points under 10ms and nothing over 100ms. Streaming weighs download speed, latency, packet loss, and how far latency rises under load; gaming weighs packet loss, latency, and that same rise; video calls add jitter. The points are published; the exact cutoffs between the five ratings are not.
>
> Packet loss is not measured here, and it feeds all three ratings — online gaming draws on only three measurements, one of them packet loss. Read these ratings as incomplete.

with a link, opening in a new tab and carrying `rel="noreferrer noopener"`:

```svelte
<a href="https://blog.cloudflare.com/aim-database-for-internet-quality/" target="_blank" rel="noreferrer noopener" class="underline">
  How Cloudflare scores a connection
</a>
```

- [ ] **Step 8: Verify the gates**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

Run: `vp test bandwidth-stats speed-test-format chart-scale turn-capability measurement-ladder`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/tools/speed-test apps/web/test/bandwidth-stats.test.ts "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "feat(tools): explain the scores, and show the distribution behind the headline"
```

---

### Task 8: Say what the run is doing, not just that it is running

"Measuring…" tells the reader nothing. Replace it with the phase, the step, and the data actually used.

**Verified facts — do not re-derive, and do not exceed them:**

- The engine exposes `onPhaseChange(payload: PhaseChangePayload)` where `PhaseChangePayload = { measurementId: number; measurement: MeasurementConfig }`. `measurementId` is the index of the current step within the configured `measurements` array. It is monotonic, so `measurementId + 1` of `ladder.length` is a truthful progress fraction.
- **A remaining-bytes or remaining-time countdown is not knowable and must not be invented.** The ladder's worst case is **1,266 MB**, yet a run typically transfers far less: the engine stops climbing a bandwidth type once one request takes `bandwidthFinishRequestDuration` (1000 ms). How much data a run sends depends on the connection's speed. Report data **already used**, never data remaining.
- Bytes actually transferred are recoverable: sum `bytes` across `getDownloadBandwidthPoints()` and `getUploadBandwidthPoints()`.
- The design system exports `progress`.

**Files:**

- Create: `apps/web/src/lib/tools/speed-test/run-progress.ts`
- Modify: `apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts`
- Modify: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`
- Test: `apps/web/test/run-progress.test.ts`

**Interfaces:**

- Produces: `phaseLabel(measurement: MeasurementConfig): string`; `formatBytes(bytes: number): string`; `bytesTransferred(download: ReadonlyArray<{ bytes: number }>, upload: ReadonlyArray<{ bytes: number }>): number`.
- The store gains `stepIndex: number | null`, `stepCount: number`, `currentPhase: string | null`, `bytesUsed: number`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/run-progress.test.ts`:

```ts
/*
 * What the run is doing, said honestly. There is deliberately no "time remaining" and no
 * "data remaining": the engine stops climbing a bandwidth type once a single request grows slow,
 * so how much a run will transfer depends on the connection. Only data ALREADY used is knowable.
 */
import { describe, expect, it } from "vitest";
import {
  bytesTransferred,
  formatBytes,
  phaseLabel,
} from "../src/lib/tools/speed-test/run-progress.ts";

describe("phaseLabel", () => {
  it("names each phase in plain language", () => {
    expect(phaseLabel({ type: "latency", numPackets: 20 })).toBe("Measuring latency");
    expect(phaseLabel({ type: "download", bytes: 1e6, count: 8 })).toBe("Measuring download speed");
    expect(phaseLabel({ type: "upload", bytes: 1e6, count: 6 })).toBe("Measuring upload speed");
    expect(
      phaseLabel({
        type: "packetLoss",
        numPackets: 1e3,
        batchSize: 10,
        batchWaitTime: 10,
        responsesWaitTime: 3000,
      }),
    ).toBe("Measuring packet loss");
  });
});

describe("formatBytes", () => {
  it("renders megabytes without false precision", () => {
    expect(formatBytes(84_000_000)).toBe("84 MB");
  });

  it("renders under a megabyte in kilobytes", () => {
    expect(formatBytes(100_000)).toBe("100 kB");
  });

  it("renders nothing used as zero", () => {
    expect(formatBytes(0)).toBe("0 kB");
  });
});

describe("bytesTransferred", () => {
  it("sums both directions", () => {
    expect(bytesTransferred([{ bytes: 100 }, { bytes: 200 }], [{ bytes: 50 }])).toBe(350);
  });

  it("is zero before anything is measured", () => {
    expect(bytesTransferred([], [])).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `vp test run-progress`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/tools/speed-test/run-progress.ts`:

```ts
/*
 * Describing a run in flight.
 *
 * There is no countdown here, deliberately. The engine abandons the rest of a bandwidth type once
 * one of its requests grows slow, so the data a run will transfer — and therefore how long it will
 * take — depends on the connection being measured. A remaining-time or remaining-megabytes figure
 * would be invented. What IS knowable: which phase is running, how far through the ladder it is,
 * and how much data has already crossed the wire.
 */
import type { MeasurementConfig } from "@cloudflare/speedtest";

export function phaseLabel(measurement: MeasurementConfig): string {
  switch (measurement.type) {
    case "latency":
      return "Measuring latency";
    case "download":
      return "Measuring download speed";
    case "upload":
      return "Measuring upload speed";
    case "packetLoss":
      return "Measuring packet loss";
  }
}

/** Whole units only: a byte count measured across a network is not precise to three decimals. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.round(bytes / 1e3)} kB`;
}

export function bytesTransferred(
  download: ReadonlyArray<{ bytes: number }>,
  upload: ReadonlyArray<{ bytes: number }>,
): number {
  const sum = (points: ReadonlyArray<{ bytes: number }>) =>
    points.reduce((carry, point) => carry + point.bytes, 0);
  return sum(download) + sum(upload);
}
```

If `MeasurementConfig`'s union makes the `switch` non-exhaustive under `strict`, keep it exhaustive rather than adding a `default` that could silently mislabel a phase the library adds later.

- [ ] **Step 4: Run it to verify it passes**

Run: `vp test run-progress`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire the store**

In `speed-test-engine.svelte.ts`:

1. Add `let stepIndex = $state<number | null>(null);` and `let currentPhase = $state<string | null>(null);`, with `get stepIndex()`, `get currentPhase()`, and `get stepCount()` (the length of the ladder the engine was actually constructed with — capture it when you build the engine, since the packet-loss ladder is longer).
2. Register the engine callback:

```ts
instance.onPhaseChange = ({ measurementId, measurement }) => {
  stepIndex = measurementId;
  currentPhase = phaseLabel(measurement);
};
```

3. Add `get bytesUsed()` returning `bytesTransferred(results?.getDownloadBandwidthPoints() ?? [], results?.getUploadBandwidthPoints() ?? [])`.
4. Clear `stepIndex`, `currentPhase` on `start()` and `restart()`, and on `onFinish`.

- [ ] **Step 6: Replace "Measuring…" on the page**

While `store.phase === "running"`, the masthead actions show the phase, the step, the data used, and a progress bar — then Pause:

```svelte
{:else if store.phase === "running"}
  <div class="flex items-center gap-8">
    <span class="text-sm text-text-muted">
      {store.currentPhase ?? "Starting"}
      {#if store.stepIndex !== null}
        · step {store.stepIndex + 1} of {store.stepCount}
      {/if}
      {#if store.bytesUsed > 0}
        · {formatBytes(store.bytesUsed)} used
      {/if}
    </span>
    <Progress value={progressPercent} class="w-64" />
    <Button variant="secondary" onclick={() => store.pause()}>Pause</Button>
  </div>
{:else if store.phase === "paused"}
```

with `const progressPercent = $derived(store.stepIndex === null ? 0 : ((store.stepIndex + 1) / store.stepCount) * 100);`

Check the design-system `Progress` component's actual prop name and value range (0–100 or 0–1) before using it, and confirm `w-64` exists on the closed scale — substitute a real width otherwise. The bar must carry an accessible name (e.g. `aria-label="Test progress"`).

- [ ] **Step 7: Report what a finished run cost**

Beside the run timestamp in `Masthead.Meta`, when `store.phase === "finished"` and `store.bytesUsed > 0`, add another `Masthead.MetaSeparator` and:

```svelte
<span>{formatBytes(store.bytesUsed)} transferred</span>
```

This is the honest counterpart to the up-front disclosure: the page said a test can use a lot of data; afterwards it says how much it actually used.

- [ ] **Step 8: Verify the gates**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

Run: `vp test run-progress bandwidth-stats speed-test-format chart-scale measurement-ladder turn-capability`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/tools/speed-test apps/web/test/run-progress.test.ts "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "feat(tools): name the phase, the step, and the data a run has used"
```

---

### Task 9: The page must not move when a run starts or finishes

Owner: the quality-score and measurement boxes should already be on screen before the test begins, even empty, so nothing shifts once it starts.

They _are_ rendered — but they change **height**, and the disclosure paragraph disappears entirely, so the page reflows twice per run. Every result region must occupy its final height from the moment the page loads. An empty region states that it is empty; it does not collapse.

**The four sources of reflow, each to be removed:**

1. **The disclosure paragraph is `{#if store.phase === "idle"}`.** When a run starts it vanishes and everything below jumps up. It is true at every phase — a test _does_ transfer that data and _does_ share the address. **Render it unconditionally.**
2. **`quality-scores.svelte`** renders a single-line paragraph when empty and a three-column definition list when scored.
3. **`bandwidth-chart.svelte` / `latency-chart.svelte`** render a one-line paragraph when empty and a fixed-height `<svg>` plus a `<details>` table view when populated.
4. **`metric-tile.svelte`** grows when Task 7's `stats` rows arrive after a run.

**Files:**

- Modify: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`
- Modify: `apps/web/src/lib/tools/speed-test/quality-scores.svelte`
- Modify: `apps/web/src/lib/tools/speed-test/bandwidth-chart.svelte`
- Modify: `apps/web/src/lib/tools/speed-test/latency-chart.svelte`
- Modify: `apps/web/src/lib/tools/speed-test/metric-tile.svelte`

- [ ] **Step 1: Keep the disclosure always**

In the page, remove the `{#if store.phase === "idle"}` guard around the disclosure paragraph. It renders in every phase.

- [ ] **Step 2: The quality-score panel keeps its shape**

In `quality-scores.svelte`, always render the three-column definition list. When `scores` is absent or empty, render the three use-cases the engine reports today with an em dash for the rating and no point line, so the grid holds its height:

```svelte
<script lang="ts">
  import type { Scores } from "@cloudflare/speedtest";
  import { useCaseLabel } from "./quality-labels.ts";

  let { scores }: { scores: Scores | undefined } = $props();

  // Before a run there are no scores, but the panel must already occupy its full height or the
  // page will jump the moment one finishes. These three are the use-cases the engine reports
  // today; once it answers, its own keys replace them.
  const PLACEHOLDER_KEYS = ["streaming", "gaming", "rtc"];

  const entries = $derived(Object.entries(scores ?? {}));
  const scored = $derived(entries.length > 0);
</script>

<dl class="grid grid-cols-1 gap-8 text-sm sm:grid-cols-3">
  {#if scored}
    {#each entries as [key, score] (key)}
      <div>
        <dt class="text-text-muted">{useCaseLabel(key)}</dt>
        <dd class="mt-4 text-lg capitalize">{score.classificationName}</dd>
        <dd class="text-xs text-text-muted">{score.points} points</dd>
      </div>
    {/each}
  {:else}
    {#each PLACEHOLDER_KEYS as key (key)}
      <div>
        <dt class="text-text-muted">{useCaseLabel(key)}</dt>
        <dd class="mt-4 text-lg">—</dd>
        <dd class="text-xs text-text-muted">Scored once a run finishes.</dd>
      </div>
    {/each}
  {/if}
</dl>
```

- [ ] **Step 3: The charts keep their frame**

In both chart components, the `<svg>` and the table-view affordance render in **every** state. Keep the exact same `viewBox`, `height`, and the `<details>` element; only the marks are conditional. When there are no points, draw no marks and place one muted line of text where the marks would be, and let the `<details>` open to "Nothing measured yet."

The structural rule: **no `{#if points.length === 0}` may wrap the `<svg>` or the `<details>`.** Guard only the `{#each}` blocks inside them. Verify the rendered height of an empty chart equals the height of a populated one.

Keep `niceMax`'s empty-set guard doing its job — an empty series must still yield a domain of 1 and draw a baseline, never divide by zero.

- [ ] **Step 4: The metric tiles keep their height**

In `metric-tile.svelte`, when the `stats` prop is supported by a tile but has no data yet, render the same stat row with em dashes rather than omitting it. The simplest honest form: the page always passes a `stats` array for Download and Upload; `statRows` returns the four labels with `—` values when `bandwidthStats` is null.

Update `statRows` on the page:

```ts
function statRows(stats: ReturnType<typeof bandwidthStats>) {
  if (stats === null) {
    return [
      { label: "Median", value: "—" },
      { label: "95th", value: "—" },
      { label: "Peak", value: "—" },
      { label: "Samples", value: "—" },
    ];
  }
  return [
    { label: "Median", value: formatBandwidth(stats.median) },
    { label: "95th", value: formatBandwidth(stats.p95) },
    { label: "Peak", value: formatBandwidth(stats.peak) },
    { label: "Samples", value: String(stats.samples) },
  ];
}
```

- [ ] **Step 5: Prove it does not move**

Run the app (`vp run worker-dev`), open `/tools/network-speed-test`, and in the browser console record `document.querySelector("main").scrollHeight` before pressing Start and again after the run finishes. **The two numbers must be equal.** If they differ, a region is still collapsing — find it and reserve its height. Report both numbers.

(The masthead's actions region may change width as controls swap; that is horizontal and does not move the page body. The error paragraph appears only on failure and is exempt.)

- [ ] **Step 6: Verify the gates**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

Run: `vp test bandwidth-stats run-progress chart-scale speed-test-format measurement-ladder`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/tools/speed-test "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "fix(tools): the speed-test page holds its shape from load to result"
```

---

### Task 10: A run you can pause, resume, abandon, or start over

The controls today are one button per phase: Start, then Pause, then Resume, then Retest. A run that has begun can be paused but never abandoned, and a paused run can only be continued, never started over. Owner asked for both.

The control set, by phase:

| Phase                 | Controls                 |
| --------------------- | ------------------------ |
| `idle`                | **Start**                |
| `running`             | **Pause** · **Cancel**   |
| `paused`              | **Resume** · **Restart** |
| `finished` / `failed` | **Retest**               |

**Cancel abandons the run and returns the page to `idle`** — results, probe, capability, step, phase label, bytes used, and the finished-at time are all cleared, and the engine is disposed so the next Start re-checks whether relay credentials can be had. It is not "pause and hide"; a cancelled run leaves nothing behind. This is the ethereal principle: nothing is persisted, and an abandoned measurement is not a measurement.

**Restart** (from `paused`) starts the ladder from the beginning: the engine's own `restart()`, with the same clearing `start()` does.

**Files:**

- Modify: `apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts`
- Modify: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`

**Interfaces:**

- The store gains `cancel(): void`.

- [ ] **Step 1: Add `cancel()` to the store**

`cancel()` must leave the store exactly as a freshly created one, except that `meta` (the measurement server, loaded once at creation and independent of any run) is kept — re-fetching it would blank the server panel for no reason.

```ts
/*
 * Abandon the run. The engine is disposed rather than paused, so the next Start re-probes whether
 * relay credentials can be had and rebuilds the ladder from that answer. Every trace of the run
 * goes with it — an abandoned measurement is not a measurement, and nothing here is persisted.
 * `meta` survives: it describes the measurement server, not the run.
 */
function cancel(): void {
  engine?.pause();
  engine = null;
  results = null;
  error = null;
  probe = null;
  turn = null;
  stepIndex = null;
  currentPhase = null;
  finishedAt = null;
  phase = "idle";
}
```

Export it beside `start` / `pause` / `resume` / `restart` / `dispose`.

Note `dispose()` (called on navigate-away) already pauses the engine; leave it as it is. `cancel()` is the user-facing abandon, `dispose()` the lifecycle one.

- [ ] **Step 2: Render the four control sets**

In the page's `Masthead.Actions`:

```svelte
{#if store.phase === "idle"}
  <Button variant="primary" onclick={() => store.start()}>Start</Button>
{:else if store.phase === "running"}
  <!-- the progress region from Task 8 sits here, then the controls -->
  <Button variant="secondary" onclick={() => store.pause()}>Pause</Button>
  <Button variant="ghost" onclick={() => store.cancel()}>Cancel</Button>
{:else if store.phase === "paused"}
  <Button variant="primary" onclick={() => store.resume()}>Resume</Button>
  <Button variant="secondary" onclick={() => store.restart()}>Restart</Button>
{:else}
  <Button variant="primary" onclick={() => store.restart()}>Retest</Button>
{/if}
```

Confirm `ghost` and `secondary` are real `ButtonVariant` members (they are: `primary | accent | secondary | destructive | ghost`). Cancel is **not** `destructive` — that register is reserved for actions that lose real work, and a speed test stores nothing.

- [ ] **Step 3: Prove the state machine by hand**

Run the app and confirm each transition:

1. Start → the run begins; **Pause** and **Cancel** are both present.
2. Pause → **Resume** and **Restart** appear; the transfer stops (the browser network panel goes quiet).
3. Resume → the run continues from where it stopped, not from the beginning.
4. Restart from paused → the run begins again at step 1 of the ladder.
5. Cancel mid-run → the page returns to its `idle` appearance: Start alone, every metric an em dash, no timestamp, no scores. The server panel keeps its facts.
6. Cancel, then Start → the run works, and the packet-loss capability is checked again.

- [ ] **Step 4: Verify the gates**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

Run: `vp test run-progress bandwidth-stats speed-test-format chart-scale measurement-ladder turn-capability`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/tools/speed-test "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "feat(tools): pause, cancel, resume, and restart a run"
```

---

### Task 11: Say what the test itself cost, in each direction

Task 8 reports the total data a run used. Owner asked to see it broken down: how much went down, and how much went up, beside the Download and Upload figures that spent it.

**Depends on Task 8** (`run-progress.ts`, `bytesTransferred`) and **Task 7** (`metric-tile.svelte`'s `stats` prop, `statRows` on the page). Do it after both.

**A measurement honesty note, to be stated in the code, not hidden:** `BandwidthPoint` carries `bytes` (the payload) and `transferSize` (the wire cost, from `PerformanceResourceTiming`). `transferSize` measures only the **response**, so it is right for a download and nearly zero for an upload. Summing whichever is larger would silently undercount uploads. Use `bytes` for both directions, and call it what it is: data transferred, excluding protocol overhead.

**Files:**

- Modify: `apps/web/src/lib/tools/speed-test/run-progress.ts`
- Modify: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`
- Test: `apps/web/test/run-progress.test.ts`

**Interfaces:**

- Produces: `bytesInDirection(points: ReadonlyArray<{ bytes: number }>): number`.
- `bytesTransferred(download, upload)` stays exactly as Task 8 defined it, and is re-expressed in terms of `bytesInDirection` rather than duplicating the sum.

- [ ] **Step 1: Extend the failing test**

Add to `apps/web/test/run-progress.test.ts`:

```ts
describe("bytesInDirection", () => {
  it("sums one direction's payloads", () => {
    expect(bytesInDirection([{ bytes: 1e5 }, { bytes: 1e6 }])).toBe(1_100_000);
  });

  it("is zero before anything is measured", () => {
    expect(bytesInDirection([])).toBe(0);
  });
});

describe("bytesTransferred", () => {
  it("is the sum of both directions", () => {
    const download = [{ bytes: 1e6 }];
    const upload = [{ bytes: 5e5 }];
    expect(bytesTransferred(download, upload)).toBe(
      bytesInDirection(download) + bytesInDirection(upload),
    );
  });
});
```

Import `bytesInDirection` alongside the existing imports.

- [ ] **Step 2: Run it to verify it fails**

Run: `vp test run-progress`
Expected: FAIL — `bytesInDirection` is not exported.

- [ ] **Step 3: Implement**

In `apps/web/src/lib/tools/speed-test/run-progress.ts`, export `bytesInDirection` and express `bytesTransferred` through it:

```ts
/*
 * What a run actually spent, one direction at a time.
 *
 * `bytes` is the payload, not the wire cost. BandwidthPoint also carries `transferSize` from
 * PerformanceResourceTiming, which is the true bytes-on-the-wire — but only for the RESPONSE, so it
 * measures a download honestly and an upload not at all. Rather than mix two meanings and undercount
 * uploads, both directions are counted in payload bytes. Protocol overhead is excluded; on a
 * hundred-megabyte transfer it is noise.
 */
export function bytesInDirection(points: ReadonlyArray<{ bytes: number }>): number {
  return points.reduce((carry, point) => carry + point.bytes, 0);
}

export function bytesTransferred(
  download: ReadonlyArray<{ bytes: number }>,
  upload: ReadonlyArray<{ bytes: number }>,
): number {
  return bytesInDirection(download) + bytesInDirection(upload);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `vp test run-progress`
Expected: PASS.

- [ ] **Step 5: Show each direction's cost on its own tile**

On the page, the Download and Upload tiles each gain a fifth statistic naming what that direction spent. Extend `statRows` to take the direction's points, and keep the em-dash placeholders Task 9 requires so the tile never changes height:

```ts
const downloadPoints = $derived(results?.getDownloadBandwidthPoints() ?? []);
const uploadPoints = $derived(results?.getUploadBandwidthPoints() ?? []);

function statRows(
  stats: ReturnType<typeof bandwidthStats>,
  points: ReadonlyArray<{ bytes: number }>,
) {
  const spent = bytesInDirection(points);
  const transferred = { label: "Transferred", value: spent > 0 ? formatBytes(spent) : "—" };
  if (stats === null) {
    return [
      { label: "Median", value: "—" },
      { label: "95th", value: "—" },
      { label: "Peak", value: "—" },
      { label: "Samples", value: "—" },
      transferred,
    ];
  }
  return [
    { label: "Median", value: formatBandwidth(stats.median) },
    { label: "95th", value: formatBandwidth(stats.p95) },
    { label: "Peak", value: formatBandwidth(stats.peak) },
    { label: "Samples", value: String(stats.samples) },
    transferred,
  ];
}
```

Pass `stats={statRows(downloadStats, downloadPoints)}` and `stats={statRows(uploadStats, uploadPoints)}`.

If five statistics crowd the tile at narrow widths, let the stat row wrap — do not drop one, and do not shrink the type below the smallest text token in use on this page.

- [ ] **Step 6: The total already exists — check it reads as the sum**

Task 8 renders the run's total ("N MB transferred") beside the timestamp in `Masthead.Meta`. Confirm by inspection that it now equals the two tile figures added together, since all three flow from `bytesInDirection`. Do not add a second total.

- [ ] **Step 7: Verify the gates**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

Run: `vp test run-progress bandwidth-stats speed-test-format chart-scale measurement-ladder turn-capability`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/tools/speed-test/run-progress.ts apps/web/test/run-progress.test.ts "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "feat(tools): show what the test spent, in each direction"
```

---

### Task 12: Download the run as a plain-text report

Owner asked to save a run as a file. Plain text: a speed-test result is a handful of numbers and a timestamp, and a lawyer forwarding it to an ISP or an office manager should be able to read it in the body of an email without a viewer.

**This does not break the ethereal principle.** Nothing is persisted _by us_ — no history, no server round trip, no matter attachment. The file is assembled in the browser from the run in front of you and handed to the operating system. When the page is closed the run is gone, exactly as before.

**Files:**

- Create: `apps/web/src/lib/tools/speed-test/speed-test-report.ts`
- Modify: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`
- Test: `apps/web/test/speed-test-report.test.ts`

**Interfaces:**

- Produces: `ReportInput` and `renderReport(input: ReportInput): string`; `reportFilename(finishedAt: Date): string`.
- The download itself (Blob → object URL → click → revoke) lives in the page, not the pure module, so the module stays node-testable.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/speed-test-report.test.ts`:

```ts
/*
 * The report is the run, written down. It must never invent a measurement: an absent value reads
 * as "not measured", never as zero, and the packet-loss line states WHY it is absent.
 */
import { describe, expect, it } from "vitest";
import { renderReport, reportFilename } from "../src/lib/tools/speed-test/speed-test-report.ts";

const AT = new Date("2026-07-09T20:40:21.000Z");

const FULL = {
  finishedAt: AT,
  downloadBps: 138_000_000,
  uploadBps: 68_100_000,
  latencyMs: 29.2,
  jitterMs: 12.5,
  packetLoss: { measured: false as const, reason: "Sign in to measure packet loss." },
  scores: { streaming: "good", gaming: "average", rtc: "average" },
  server: {
    clientIp: "24.234.27.182",
    asOrganization: "Cox Communications Inc.",
    asn: 22773,
    coloCity: "Las Vegas",
    coloIata: "LAS",
  },
  roundTrip: { reachable: false as const, note: "You are not signed in." },
  bytesDown: 118_000_000,
  bytesUp: 24_000_000,
};

describe("reportFilename", () => {
  it("is sortable and names the tool", () => {
    expect(reportFilename(AT)).toMatch(/^network-speed-test-2026-07-09T\d{2}-\d{2}-\d{2}\.txt$/);
  });
});

describe("renderReport", () => {
  it("states every measured value", () => {
    const text = renderReport(FULL);
    expect(text).toContain("Download: 138 Mbps");
    expect(text).toContain("Upload: 68.1 Mbps");
    expect(text).toContain("Latency: 29.2 ms");
    expect(text).toContain("Jitter: 12.5 ms");
  });

  it("says why packet loss is absent rather than printing a zero", () => {
    const text = renderReport(FULL);
    expect(text).toContain("Packet loss: not measured");
    expect(text).toContain("Sign in to measure packet loss.");
    expect(text).not.toMatch(/Packet loss: 0/);
  });

  it("records the measurement server and the data the test spent", () => {
    const text = renderReport(FULL);
    expect(text).toContain("Las Vegas (LAS)");
    expect(text).toContain("Cox Communications Inc. (AS22773)");
    expect(text).toContain("Downloaded: 118 MB");
    expect(text).toContain("Uploaded: 24 MB");
  });

  it("renders an unmeasured value as 'not measured', never as zero", () => {
    const text = renderReport({ ...FULL, downloadBps: undefined, latencyMs: undefined });
    expect(text).toContain("Download: not measured");
    expect(text).toContain("Latency: not measured");
    expect(text).not.toContain("Download: 0");
  });

  it("notes that the ratings are incomplete without packet loss", () => {
    expect(renderReport(FULL)).toContain("incomplete");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `vp test speed-test-report`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the report**

Create `apps/web/src/lib/tools/speed-test/speed-test-report.ts`. Reuse `formatBandwidth` / `formatMilliseconds` from `speed-test-format.ts` and `formatBytes` from `run-progress.ts` — do not re-implement them. An absent measurement renders `not measured`, never `0` and never an em dash (an em dash means nothing in a text file).

Shape the file so it reads as a record someone could paste into an email:

```
Network Speed Test — Magna Carta
Run at 2026-07-09 20:40:21 UTC

Download: 138 Mbps
Upload: 68.1 Mbps
Latency: 29.2 ms
Jitter: 12.5 ms
Packet loss: not measured — Sign in to measure packet loss.

Network quality (Cloudflare AIM)
  Video streaming: good
  Online gaming: average
  Video calls: average
  These ratings are incomplete: packet loss feeds all three and was not measured.

Measurement server
  Served from: Las Vegas (LAS)
  Your network: Cox Communications Inc. (AS22773)
  Your address: 24.234.27.182
  Round trip to Magna Carta: not measured — You are not signed in.

Data used by this test
  Downloaded: 118 MB
  Uploaded: 24 MB
  Total: 142 MB

Measured with Cloudflare's speed-test engine. Nothing was saved.
```

Bandwidth headline figures are the engine's 90th percentile and latency its median — state that once, in a closing line, so a reader of the file is not misled the way a reader of the page would be without the popover.

- [ ] **Step 4: Run it to verify it passes**

Run: `vp test speed-test-report`
Expected: PASS (6 tests).

- [ ] **Step 5: Offer the download from the `…` menu**

**Not a button beside Retest.** A report download is not a run control, and a fifteen-character label beside "Pause" forces the whole control region to reserve that width — which is exactly the asymmetry Task 23 removes. It belongs in the overflow menu built in Task 22, where Cloudflare keeps theirs too.

Add a `DropdownMenu.Item` labelled **Download report** to `speed-test-menu.svelte`, beneath the two preference checkboxes and a `DropdownMenu.Separator`. It is **disabled unless `store.phase === "finished"`** — there is nothing to report on before a run completes.

Choosing it builds a `Blob` of `renderReport(...)` with type `text/plain;charset=utf-8`, creates an object URL, clicks a temporary anchor with `download={reportFilename(finishedAt)}`, then **revokes the object URL** (a leaked URL pins the blob for the page's life).

Do not persist the report, and do not send it anywhere.

- [ ] **Step 6: Verify the gates**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

Run: `vp test speed-test-report run-progress bandwidth-stats speed-test-format`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/tools/speed-test/speed-test-report.ts apps/web/test/speed-test-report.test.ts "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "feat(tools): download the run as a plain-text report"
```

---

### Task 13: The bandwidth chart belongs under its own number, and it is a line

Owner: the download and upload measurement graphs are hard to read, they should be a line rather than loose points, and they belong in the Download and Upload areas at the top — combining the number with the evidence for it and shortening the page.

**Observed on `speed.cloudflare.com` (screenshot: `scratch/cf-charts-full.png`) — this is the target:**

- Under the big **Download** figure sits a filled **area/line chart** of throughput across the run, with a horizontal reference line labelled **"90th percentile"** drawn across it. Same under **Upload**. This is why their headline is trustworthy: the number and its evidence share one glance, and the line explains what the number is.
- Their bottom "Download Measurements" panels are **box plots per payload size** (`100kB download test (10/10)`, `1MB (8/8)`, `10MB (6/6)`, `25MB (4/4)`) — not scattered dots.

**What we build:**

1. A **sparkline** (line + soft area fill) inside each of the Download and Upload tiles, plotting each bandwidth sample in the order measured, with a labelled 90th-percentile rule.
2. **Delete the bottom "Download measurements" and "Upload measurements" sections.** The chart now lives with its number; a second copy is page weight for nothing.
3. Keep the **Latency measurements** section as it is. It is not what the owner objected to, and reworking it into box plots is a separate decision.

Still a single series per chart, so the dataviz rules hold unchanged: no legend, no categorical palette, recessive axes, a table view, and a hover affordance.

**Files:**

- Create: `apps/web/src/lib/tools/speed-test/bandwidth-sparkline.svelte`
- Delete: `apps/web/src/lib/tools/speed-test/bandwidth-chart.svelte`
- Modify: `apps/web/src/lib/tools/speed-test/metric-tile.svelte` (accept a `chart` snippet)
- Modify: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`
- Modify: `apps/web/src/lib/tools/speed-test/chart-scale.ts` (add `linePath`)
- Test: `apps/web/test/chart-scale.test.ts` (extend)

- [ ] **Step 1: Extend the failing scale test**

Add to `apps/web/test/chart-scale.test.ts`:

```ts
describe("linePath", () => {
  it("draws a polyline through every sample, left to right", () => {
    expect(linePath([0, 50, 100], 100, 200, 100)).toBe("M0,100 L100,50 L200,0");
  });

  it("plants a single sample at the left edge", () => {
    expect(linePath([50], 100, 200, 100)).toBe("M0,50");
  });

  it("returns an empty path for an empty series", () => {
    expect(linePath([], 100, 200, 100)).toBe("");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `vp test chart-scale`
Expected: FAIL — `linePath` is not exported.

- [ ] **Step 3: Implement `linePath`**

In `chart-scale.ts`, keep `niceMax` and `scaleLinear` exactly as they are and add:

```ts
/*
 * An SVG path through every sample, evenly spaced left to right and scaled against `domainMax`.
 * y is inverted because SVG's origin is the top-left: the fastest sample must sit highest.
 * A single sample yields a move with no line — one observation is a point, not a trend.
 */
export function linePath(
  values: readonly number[],
  domainMax: number,
  width: number,
  height: number,
): string {
  if (values.length === 0) return "";
  const scale = scaleLinear(domainMax, height);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((value, index) => {
      const x = Math.round(index * step * 100) / 100;
      const y = Math.round((height - scale(value)) * 100) / 100;
      return `${index === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `vp test chart-scale`
Expected: PASS.

- [ ] **Step 5: Build the sparkline**

Create `apps/web/src/lib/tools/speed-test/bandwidth-sparkline.svelte`. Requirements:

- Props: `points: ReadonlyArray<{ bps: number }>`, `label: string` (for the accessible name, e.g. "Download").
- Plot `bps / 1e6` (Mbps) in measured order. Domain `0 → niceMax(values)`.
- Draw, in this order: the **area** (the line path closed to the baseline, filled with the accent token at a low `fill-opacity`), then the **line** (`fill="none"`, `stroke="var(--mc-accent-default)"`, 2px), then the **90th-percentile rule** — a horizontal line at that value, in a muted token stroke, with a small `<text>` reading `90th percentile`, exactly as Cloudflare labels it. Compute the percentile with the existing `percentile(values, 0.9)` from `bandwidth-stats.ts`; do not write a second percentile.
- **Fixed height in every state** (Task 9's rule): the `<svg>` and the `<details>` table view render even with no points. With no points, draw the baseline only and one muted line of text; do not collapse.
- Hover: a transparent `<rect>` per sample carrying a `<title>` of `"Sample N: 94.5 Mbps"`. Never convey a value by geometry alone.
- Verify `--mc-accent-default` and any muted stroke token exist in `packages/design-tokens/generated/tailwind-theme.css`. No raw hex.

- [ ] **Step 6: Put the chart under the number**

Give `metric-tile.svelte` an optional `chart?: Snippet`, rendered between the value and the `stats` row. Structure and `note` rendering stay as they are.

On the page, pass the sparkline into the Download and Upload tiles:

```svelte
<MetricTile size="large" label="Download" value={formatBandwidth(results?.getDownloadBandwidth())} stats={statRows(downloadStats, downloadPoints)}>
  {#snippet chart()}
    <BandwidthSparkline label="Download" points={downloadPoints} />
  {/snippet}
</MetricTile>
```

- [ ] **Step 7: Delete the bottom bandwidth sections**

Remove the "Download measurements" and "Upload measurements" `<section>`s and the `bandwidth-chart.svelte` import. Delete `bandwidth-chart.svelte`. Leave the "Latency measurements" section untouched.

Confirm nothing else imports `bandwidth-chart.svelte` before deleting it.

- [ ] **Step 8: Verify the gates**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

Run: `vp test chart-scale bandwidth-stats run-progress speed-test-format measurement-ladder`
Expected: PASS.

Re-check Task 9's promise: `main.scrollHeight` before Start must still equal it after the run finishes.

- [ ] **Step 9: Commit**

```bash
git add -A apps/web/src/lib/tools/speed-test apps/web/test/chart-scale.test.ts "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "feat(tools): the bandwidth chart is a line, and it lives under its number"
```

(`git add -A` because this task deletes a file — never list a deleted path explicitly.)

---

### Task 14: Info on hover, and a link you can actually reach

Owner: the info icons should reveal on hover rather than on click, and the button should be smaller.

The reason they are click-popovers today is that I put a link _inside_ them, and a link inside a hover tooltip is unreachable — the tooltip closes as the pointer travels to it. Cloudflare solves this by separating the two: the `(i)` is a hover tooltip carrying prose only, and **"Learn more" is a plain visible link beside the heading**. Adopt that.

**Files:**

- Create: `apps/web/src/lib/tools/speed-test/info-hint.svelte`
- Delete: `apps/web/src/lib/tools/speed-test/info-popover.svelte`
- Modify: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`

- [ ] **Step 1: Replace the popover with a tooltip**

Create `info-hint.svelte` using the design system's `tooltip` (`Tooltip.Root/Trigger/Content`). It must:

- Open on **hover and on keyboard focus** (Bits UI's tooltip does both; confirm the trigger is a real focusable `<button type="button">`).
- Carry an accessible name (`aria-label`) naming what it explains, e.g. `About the download figure`.
- Contain **prose only — no links, no interactive content.**
- Use a **smaller icon**: the current `size-16` becomes `size-12`. Confirm `size-12` exists on this project's closed spacing scale (0/4/8/12/16/20/24/32/40/48/64/96) before using it.

Delete `info-popover.svelte` once nothing imports it.

- [ ] **Step 2: Move the AIM link out of the tooltip**

Beside the **Network quality score** heading, next to the `(i)`, render a visible link — the same arrangement Cloudflare uses:

```svelte
<a
  href="https://blog.cloudflare.com/aim-database-for-internet-quality/"
  target="_blank"
  rel="noreferrer noopener"
  class="text-sm underline"
>
  Learn more
</a>
```

The tooltip keeps the explanatory prose written in Task 7 (points per metric, which metrics feed which rating, and that packet loss is unmeasured so the ratings are incomplete). It loses only the anchor.

- [ ] **Step 3: Verify the gates**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

Confirm by keyboard: Tab reaches each `(i)` and the tooltip appears on focus; Tab reaches the "Learn more" link. If focus does not open the tooltip, fix it — a hover-only hint is invisible to a keyboard user.

- [ ] **Step 4: Commit**

```bash
git add -A apps/web/src/lib/tools/speed-test "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "feat(tools): explanations on hover, with the link beside the heading"
```

---

### Task 15: Do not rate a connection before the run has finished

Owner: the quality scores should not appear until scanning is complete, or they climb and fall before the data means anything.

The engine recomputes `getScores()` on every `onResultsChange`, so a rating visibly moves from "poor" to "average" to "good" as samples land. A rating that changes while you watch it is not a rating; it is noise wearing a verdict's clothes. Worse, AIM weighs metrics the run has not reached yet — early on, upload has not been measured at all.

**This applies only to the ratings.** The headline metrics (Download, Upload, Latency, Jitter) _must_ keep updating live during a run; a fix exists specifically to make them do that, and the owner has seen and accepted it. Do not touch them.

**Files:**

- Modify: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`

- [ ] **Step 1: Withhold the scores until the run is finished**

The score panel receives scores only in the `finished` phase:

```svelte
<QualityScores scores={store.phase === "finished" ? results?.getScores() : undefined} />
```

In every other phase — idle, running, paused, failed, and after a cancel — it receives `undefined` and renders the placeholder built in Task 9: three columns, em dashes, "Scored once a run finishes."

That placeholder now carries meaning rather than merely holding space. Add a short comment on the call site saying so, because the next reader will otherwise "simplify" the guard away:

```svelte
<!-- The engine rescores on every sample, so a rating shown mid-run climbs and falls before the
     measurements it weighs even exist. A verdict is worth showing only once it is final. -->
```

- [ ] **Step 2: Verify the gates**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "fix(tools): rate the connection only once the run is finished"
```

---

### Task 16: A progress panel whose parts do not shove each other

Owner: the step counter, descriptor, data used, and bar all sit on one line and constantly move as they change. Stack them — counter and size on one line, descriptor beneath, the bar as an underline under both — and make each part immune to the others changing.

Also: move the disclosure paragraph to the bottom of the page, and delete "Runs outside any matter" from the masthead.

**Why things move today, and the three fixes:**

1. **The descriptor changes length** ("Measuring latency" → "Measuring download speed"), so the panel widens and the buttons beside it slide. → Reserve the panel's width with the **longest label**, rendered invisibly in the same grid cell. No magic number, and it re-reserves itself if a phase label is ever added.
2. **The numbers change width** (`step 6 of 14` → `step 14 of 14`; `9 MB` → `118 MB`). → `tabular-nums` so every digit is the same width, and anchor each value to its **own** edge: the counter to the left, the size to the right, with the slack between them absorbing growth. Neither edge moves.
3. **The bar shares the line**, so it is squeezed as its neighbours grow. → It becomes a full-width underline beneath the block.

**Files:**

- Create: `apps/web/src/lib/tools/speed-test/run-progress-panel.svelte`
- Modify: `apps/web/src/lib/tools/speed-test/run-progress.ts` (export `LONGEST_PHASE_LABEL`)
- Modify: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`
- Test: `apps/web/test/run-progress.test.ts` (extend)

- [ ] **Step 1: Extend the failing test**

Add to `apps/web/test/run-progress.test.ts`:

```ts
describe("LONGEST_PHASE_LABEL", () => {
  it("is at least as long as every label the engine can produce", () => {
    const labels = [
      phaseLabel({ type: "latency", numPackets: 1 }),
      phaseLabel({ type: "download", bytes: 1e6, count: 1 }),
      phaseLabel({ type: "upload", bytes: 1e6, count: 1 }),
      phaseLabel({
        type: "packetLoss",
        numPackets: 1,
        batchSize: 1,
        batchWaitTime: 1,
        responsesWaitTime: 1,
      }),
    ];
    for (const label of labels) {
      expect(LONGEST_PHASE_LABEL.length).toBeGreaterThanOrEqual(label.length);
    }
  });

  it("is one of the labels, not an invented string", () => {
    expect(LONGEST_PHASE_LABEL).toBe("Measuring download speed");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `vp test run-progress`
Expected: FAIL — `LONGEST_PHASE_LABEL` is not exported.

- [ ] **Step 3: Export the reservation string**

In `run-progress.ts`, derive it from the labels rather than hardcoding, so a new phase widens the reservation automatically:

```ts
/*
 * The widest label the panel can ever show. The descriptor cell reserves this width invisibly, so a
 * phase change never resizes the panel and never shoves the controls beside it. Derived, not typed
 * by hand: adding a phase widens the reservation on its own.
 */
const ALL_PHASE_LABELS = [
  phaseLabel({ type: "latency", numPackets: 1 }),
  phaseLabel({ type: "download", bytes: 1, count: 1 }),
  phaseLabel({ type: "upload", bytes: 1, count: 1 }),
  phaseLabel({
    type: "packetLoss",
    numPackets: 1,
    batchSize: 1,
    batchWaitTime: 1,
    responsesWaitTime: 1,
  }),
];

export const LONGEST_PHASE_LABEL = ALL_PHASE_LABELS.reduce((longest, label) =>
  label.length > longest.length ? label : longest,
);
```

- [ ] **Step 4: Run it to verify it passes**

Run: `vp test run-progress`
Expected: PASS.

- [ ] **Step 5: Build the panel**

Create `apps/web/src/lib/tools/speed-test/run-progress-panel.svelte`:

```svelte
<script lang="ts">
  /*
   * What the run is doing, arranged so that nothing moves when anything changes.
   *
   * The counter is anchored left and the data-used figure right, with slack between them, so each
   * grows into the gap rather than pushing the other. Figures are tabular, so a digit changing
   * width cannot jitter the line. The descriptor sits in a cell whose width is reserved by the
   * longest label the engine can emit — rendered invisibly beneath it — so a phase change never
   * resizes the panel or shoves the controls beside it. The bar underlines the whole block.
   */
  import Progress from "@magna-carta/design-system/progress";
  import { LONGEST_PHASE_LABEL, formatBytes } from "./run-progress.ts";

  let {
    phaseText,
    stepIndex,
    stepCount,
    bytesUsed,
  }: {
    phaseText: string | null;
    stepIndex: number | null;
    stepCount: number;
    bytesUsed: number;
  } = $props();

  const percent = $derived(
    stepIndex === null || stepCount === 0 ? 0 : ((stepIndex + 1) / stepCount) * 100,
  );
</script>

<!--
  Every row renders in every phase. Before a run the counter and the size are empty strings, not
  absent elements: an element that disappears takes its height with it, and the controls beside this
  panel would move twice per run.
-->

<div class="grid gap-4">
  <div class="flex items-baseline justify-between gap-16 text-xs tabular-nums text-text-muted">
    <span>
      {#if stepIndex !== null}Step {stepIndex + 1} of {stepCount}{/if}
    </span>
    <span>
      {#if bytesUsed > 0}{formatBytes(bytesUsed)} used{/if}
    </span>
  </div>

  <!-- The invisible copy reserves the cell's width; the visible label overlays it. -->
  <div class="grid">
    <span class="invisible col-start-1 row-start-1 text-sm whitespace-nowrap">
      {LONGEST_PHASE_LABEL}
    </span>
    <span class="col-start-1 row-start-1 text-sm whitespace-nowrap text-text-muted">
      {phaseText ?? "Starting"}
    </span>
  </div>

  <Progress value={percent} max={100} aria-label="Test progress" class="h-4" />
</div>
```

Verify `h-4` (4px), `gap-4`, `gap-16`, `invisible`, `tabular-nums`, `col-start-1`, `row-start-1` all exist. The spacing scale is CLOSED — `h-4` is 4 pixels here, which is the intended hairline underline. Confirm `mc-progress` does not impose a conflicting height; if it does, respect the design system and use its smallest supported height rather than overriding with a raw value.

- [ ] **Step 6: Use it, and clear the masthead**

In the page:

- **The panel is rendered in every phase — before, during, paused, and after a run.** It is a permanent region that has nothing to say yet, not a thing that appears and disappears. A panel that only exists while running would move the controls beside it twice per run, which is the defect this task exists to remove. Only the **controls** beside it change with the phase.
- On **pause**, the panel keeps showing everything it showed while running: the step reached, the phase it stopped in, the data spent, and the bar at its current position. A paused run has not un-measured anything.

Derive the descriptor once, on the page, so the panel stays dumb:

```ts
// The panel is always present; only what it can honestly say changes.
const phaseText = $derived(
  store.phase === "idle"
    ? "Not started"
    : store.phase === "finished"
      ? "Complete"
      : store.phase === "failed"
        ? "Stopped"
        : (store.currentPhase ?? "Starting"),
);
```

A finished run shows its final step (`14 of 14`), its total data, and a full bar — the record of what just happened, not a cleared slate.

- Replace the inline running-state markup in `Masthead.Actions` with `<RunProgressPanel …/>`, then the phase-appropriate controls beside it.
- **Delete** `<span>Runs outside any matter</span>` from `Masthead.Meta`.
- `Masthead.Meta` must still render in every phase, or the masthead changes height and the page moves (Task 9). Before a run it reads `Not run yet`; once finished it reads the timestamp and the data transferred.

```svelte
<Masthead.Meta>
  {#if store.finishedAt}
    <span>Run at {store.finishedAt.toLocaleTimeString()} on {store.finishedAt.toLocaleDateString()}</span>
    {#if store.bytesUsed > 0}
      <Masthead.MetaSeparator />
      <span>{formatBytes(store.bytesUsed)} transferred</span>
    {/if}
  {:else}
    <span>Not run yet</span>
  {/if}
</Masthead.Meta>
```

- [ ] **Step 7: Move the disclosure to the foot of the page**

Remove the disclosure `<section>` from above the metrics. Render it, unconditionally, as the last thing on the page — after the Latency measurements section. It absorbs the ethereal statement that the masthead line used to carry:

```svelte
<footer class="mt-40 border-t border-border-default pt-16 text-xs text-text-muted">
  A full test can transfer around 200 MB of data. Your public address is shared with Cloudflare's
  measurement endpoints to run it. This tool runs outside any matter, and nothing is saved.
</footer>
```

It stays rendered in every phase — it was true before the run and it is still true after.

- [ ] **Step 8: Verify the gates and the promise**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

Run: `vp test run-progress bandwidth-stats speed-test-format chart-scale measurement-ladder turn-capability`
Expected: PASS.

Then confirm, by construction, that within a run: the counter's left edge, the size's right edge, the descriptor's left edge, and the controls beside the panel all stay fixed as `stepIndex`, `phaseText`, and `bytesUsed` change. State in the report how you established it.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/tools/speed-test/run-progress-panel.svelte apps/web/src/lib/tools/speed-test/run-progress.ts apps/web/test/run-progress.test.ts "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "feat(tools): a progress panel whose parts hold their places"
```

---

### Task 17: Absence reads the same way everywhere

Owner: the network-quality panel and the round-trip line should show the same no-data state as the latency charts — "Not measured yet."

Today the page says the same thing four different ways: the charts say "Not measured yet.", the quality panel says "Scored once a run finishes.", the round-trip line says "The round trip to Magna Carta has not been measured yet.", and the packet-loss tile says "Measured when a test runs." A reader learns four phrasings for one fact. One phrase, one meaning.

**One phrase, one home.** The em dash for an absent _number_ already lives in `speed-test-format.ts`; the sentence for an absent _measurement_ belongs beside it.

**Do not flatten the states that are not "not yet".** The round-trip line has four outcomes and only one of them is "we have not measured": `unauthenticated`, `forbidden`, and `unreachable` each keep their own specific sentence, because each tells the reader something different and actionable. Only `probe === null` — nothing attempted yet — becomes the shared phrase.

**Files:**

- Modify: `apps/web/src/lib/tools/speed-test/speed-test-format.ts` (export the phrase)
- Modify: `apps/web/src/lib/tools/speed-test/quality-scores.svelte`
- Modify: `apps/web/src/lib/tools/speed-test/server-panel.svelte`
- Modify: `apps/web/src/lib/tools/speed-test/latency-chart.svelte`, `bandwidth-chart.svelte` (consume the constant instead of a literal)
- Modify: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte` (the packet-loss idle note)
- Test: `apps/web/test/speed-test-format.test.ts` (extend)

- [ ] **Step 1: Extend the failing test**

Add to `apps/web/test/speed-test-format.test.ts`:

```ts
describe("NOT_MEASURED_YET", () => {
  it("is the one sentence the page uses for a measurement not taken", () => {
    expect(NOT_MEASURED_YET).toBe("Not measured yet.");
  });
});
```

Import it alongside the existing imports.

- [ ] **Step 2: Run it to verify it fails**

Run: `vp test speed-test-format`
Expected: FAIL — `NOT_MEASURED_YET` is not exported.

- [ ] **Step 3: Give the phrase a home**

In `speed-test-format.ts`, beside the `ABSENT` em dash:

```ts
/*
 * How an untaken measurement reads, in prose. The em dash above says the same thing where a number
 * belongs; this says it where a sentence belongs. Both live here so the page never invents a fifth
 * way to say "we have not measured this."
 */
export const NOT_MEASURED_YET = "Not measured yet.";
```

- [ ] **Step 4: Use it in all four places**

1. `quality-scores.svelte` — the placeholder line under each em-dashed rating becomes `NOT_MEASURED_YET` (replacing "Scored once a run finishes.").
2. `server-panel.svelte` — when `probe === null`, the round-trip line reads `NOT_MEASURED_YET` (replacing the long sentence). **Leave the `unauthenticated`, `forbidden`, and `unreachable` branches exactly as they are** — they are not "not yet", they are "here is why not", and each is actionable.
3. `latency-chart.svelte` and `bandwidth-chart.svelte` — replace the hardcoded `"Not measured yet."` string with the imported constant, so the four sites cannot drift apart later.
4. The page's packet-loss tile, in its `store.turn === null` branch, uses `NOT_MEASURED_YET` as its `note` (replacing "Measured when a test runs.").

Do not change the `aria-label` text of a chart that already describes its state; if it embeds the literal, have it consume the constant too.

- [ ] **Step 5: Verify the gates**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

Run: `vp test speed-test-format run-progress bandwidth-stats chart-scale`
Expected: PASS.

Then grep the tool for stragglers — there must be no remaining literal:

```bash
grep -rn "Not measured yet\|Scored once a run finishes\|Measured when a test runs\|has not been measured yet" apps/web/src/lib/tools/speed-test "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
```

Every hit must be the constant's definition or an import of it.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/tools/speed-test apps/web/test/speed-test-format.test.ts "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "fix(tools): one sentence for a measurement not taken"
```

---

### Task 18: No em dash where there is no measurement

Owner: remove the em dash from the null-data states.

Today an unmeasured number renders `—`. It was chosen so absence could never be misread as zero. That job is now done in prose — Task 17 gave the page one sentence for "Not measured yet." — and the dash is left saying nothing twice.

**Two things the dash was quietly doing. Both must survive its removal.**

1. **It held the line's height.** An empty `<span>` has no height, so deleting the character collapses the value line, the tile shrinks, and the page moves again — undoing Task 9. The value element must keep its line box.
2. **It stopped an absent value reading as zero.** Nothing may replace it with `0`, `0 Mbps`, or `0 ms`. Absent stays absent; it simply stays _silent_.

**Files:**

- Modify: `apps/web/src/lib/tools/speed-test/speed-test-format.ts`
- Modify: `apps/web/src/lib/tools/speed-test/metric-tile.svelte`
- Modify: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte` (the `statRows` placeholders)
- Modify: `apps/web/src/lib/tools/speed-test/quality-scores.svelte` (the placeholder rating)
- Test: `apps/web/test/speed-test-format.test.ts`

**Depends on Task 17** (the `NOT_MEASURED_YET` constant). Do it after.

- [ ] **Step 1: Change the failing test first**

In `apps/web/test/speed-test-format.test.ts`, every assertion that expects `"—"` now expects `""`. Rewrite them and add the guard that matters:

```ts
describe("an absent measurement", () => {
  it("renders as nothing, not as an em dash", () => {
    expect(formatBandwidth(undefined)).toBe("");
    expect(formatMilliseconds(undefined)).toBe("");
    expect(formatRatio(undefined)).toBe("");
  });

  it("never renders as zero", () => {
    expect(formatBandwidth(undefined)).not.toMatch(/0/);
    expect(formatMilliseconds(undefined)).not.toMatch(/0/);
    expect(formatRatio(undefined)).not.toMatch(/0/);
  });

  it("still distinguishes a measured zero from an absent one", () => {
    expect(formatRatio(0)).toBe("0%");
    expect(formatRatio(undefined)).toBe("");
  });
});
```

That last case is the whole point: a packet-loss reading of exactly zero is a real, good measurement and must keep saying `0%`.

- [ ] **Step 2: Run it to verify it fails**

Run: `vp test speed-test-format`
Expected: FAIL — the formatters still return `"—"`.

- [ ] **Step 3: Retire the dash**

In `speed-test-format.ts`, replace the `ABSENT` constant's value with the empty string and explain why the constant survives at all:

```ts
/*
 * An unmeasured value renders as nothing. It once rendered as an em dash, to keep absence from being
 * read as zero; the page now says "Not measured yet." in prose where it matters, so the dash was
 * saying nothing twice. The constant remains because every formatter must agree on what silence is —
 * and because nothing may ever replace it with a zero.
 */
const ABSENT = "";
```

Every formatter keeps returning `ABSENT` for an absent input. Change no other behaviour.

- [ ] **Step 4: Run it to verify it passes**

Run: `vp test speed-test-format`
Expected: PASS.

- [ ] **Step 5: Keep the line boxes**

An empty string collapses its line. In `metric-tile.svelte`, the value element must retain its height whether or not it has content. Render a non-breaking space when the value is empty:

```svelte
<!-- The value's line box must survive an empty value, or the tile shrinks when nothing has been
     measured and the page moves. The space is doing structural work, not decorative work. -->
<div class="mt-4 {size === 'large' ? 'text-3xl' : 'text-2xl'}">{value === "" ? " " : value}</div>
```

Use whatever text-size classes the tile already uses — do not change its type scale. Apply the same treatment to the `stats` row values.

Then update the placeholders that hardcode the dash:

- `statRows`'s null branch returns `""` for each of Median, 95th, Peak, Samples, and Transferred — not `"—"`.
- `quality-scores.svelte`'s placeholder rating renders `""` (with its line box preserved the same way) rather than `—`. Its `NOT_MEASURED_YET` line stays and now carries the whole meaning.

- [ ] **Step 6: Prove nothing collapsed**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

Run: `vp test speed-test-format run-progress bandwidth-stats chart-scale measurement-ladder turn-capability`
Expected: PASS.

Then grep for stragglers — no em dash may remain as a data placeholder:

```bash
grep -rn "—" apps/web/src/lib/tools/speed-test "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
```

Hits are permitted only in prose and comments, never as a rendered value. Report every hit and why it is allowed.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/tools/speed-test apps/web/test/speed-test-format.test.ts "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "fix(tools): an unmeasured value says nothing, not an em dash"
```

---

### Task 20: Every ghost button states its edge at rest (design system)

Owner: a `ghost` button does not read as a button, because it shows no edge until hover. This recurs across the app. **Give them all an edge, and the owner will judge the result across every surface at once.**

An earlier draft of this task added a separate `outline` variant on the reasoning that the eleven existing `ghost` call sites _intended_ to be borderless. That was an inference from usage, not evidence — nobody wrote it down, and the owner has said so. Do not assume intent. Change `ghost` itself, look at every consumer, and let the owner decide what to keep.

**This is a deliberate, visible change across the app.** It is one CSS rule, so it is trivially revertible. Do not soften it by adding a second variant, and do not exempt any call site.

**Do not use a real `border`.** The base `.mc-button` has no border, and every size maps to `min-block-size` plus padding, so a 1px border would make ghost buttons two pixels taller than the buttons beside them — trading the outline problem for an alignment problem. Draw the edge as an **inset ring**, which costs no layout.

**Files:**

- Modify: `packages/design-system/src/lib/components/button/button.css`
- Modify: `packages/design-system/src/stories/button.stories.svelte` (only if the ghost story needs a caption change)

`variants.ts` is **not** modified: no new variant is added.

- [ ] **Step 1: Give ghost its edge**

In `button.css`, the current recipe is:

```css
.mc-button-ghost {
  background-color: transparent;
  color: var(--mc-text-default);
}
.mc-button-ghost:hover {
  background-color: var(--mc-action-secondary);
}
```

Add the ring at rest, keeping the hover fill:

```css
/*
   * Ghost — a quiet action that still reads as a control. It carried no edge at rest, which left the
   * affordance invisible until the pointer found it; a control the eye cannot find is not quiet, it
   * is hidden.
   *
   * The edge is an INSET RING, not a border: the base recipe has no border, and sizes map to
   * min-block-size plus padding, so a real border would make every ghost button two pixels taller
   * than the buttons beside it. A ring costs no layout.
   */
.mc-button-ghost {
  background-color: transparent;
  color: var(--mc-text-default);
  box-shadow: inset var(--mc-space-0) var(--mc-space-0) var(--mc-space-0)
    var(--mc-border-width-default) var(--mc-border-strong);
}
.mc-button-ghost:hover {
  background-color: var(--mc-action-secondary);
}
/* The disabled recipe sets an opaque fill; the ring beneath would otherwise show as a seam around
     a control that no longer takes input. */
.mc-button-ghost:disabled {
  box-shadow: none;
}
```

**The token-purity gate (`packages/design-system/test/fitness/boundaries.test.ts`) rejects any literal length, colour, or number** — including a bare `0`. That is why the ring's offsets are `var(--mc-space-0)`. Confirm `--mc-space-0`, `--mc-border-width-default`, and `--mc-border-strong` exist before using them; substitute real tokens if any does not. `none` is a structural keyword and is permitted.

Consider whether `--mc-border-strong` or `--mc-border-default` is the right weight for a _quiet_ action. Pick one, say which and why in your report, and do not split the difference with a new token.

- [ ] **Step 2: Find every consumer, so the owner can judge them together**

`variant="ghost"` currently appears in these files. **Read each one and describe, in your report, what that button looks like now that it has an edge** — one line each. Do not change any of them.

```bash
grep -rn 'variant="ghost"' apps/web/src packages/design-system/src --include=*.svelte
```

At the time of writing: `bug-report-dialog`, `motion-module`, `request-change-dialog`, `settings-commit-footer`, `settings-ledger`, `settings-row`, the speed-test page, `data-table-column-filter`, and `card.stories`. Re-run the grep — a merge recently changed the set, so do not trust this list.

Flag any call site where the new edge looks actively wrong (for example, a ghost button used as a table-cell affordance, or several in a row forming a visual grid). The owner decides; your job is to surface them, not to special-case them.

- [ ] **Step 3: Verify the gates**

Run: `vp test boundaries off-token`
Expected: PASS. If `boundaries` rejects the `box-shadow`, read its rule and comply; **do not weaken the test.**

Run: `pnpm --filter @magna-carta/design-system check`
Expected: clean.

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

Storybook note: running more than one story file in a single `vp test run` exhausts V8's heap in this repo. If you run stories, run one file alone.

- [ ] **Step 4: Commit**

```bash
git add packages/design-system/src/lib/components/button
git commit -m "feat(design-system): a ghost button states its edge at rest"
```

---

### Task 19: The control area is the same size in every phase

Owner: Pause/Resume and Cancel/Restart resize when pressed, because the words differ in length. A fresh page shows only Start, so pressing it adds a second button and the progress area, moving everything. After a successful test it collapses back to one button. And the progress panel grows downward as information arrives.

**One cause, four symptoms: an element with no content has no size.** The panel's counter/size row is empty before a run, so it has no height. The secondary button does not exist at idle or after a run, so it has no width. A button's width is whatever its current word needs.

The whole control region — panel, primary button, secondary button — must occupy identical space in every phase. Nothing appears, nothing disappears, nothing resizes. Only the words and the bar change.

**Depends on Task 18** (the U+00A0 line-box technique) and **Task 20** (ghost gains an edge at rest).

**Files:**

- Create: `apps/web/src/lib/tools/speed-test/steady-label.svelte`
- Modify: `apps/web/src/lib/tools/speed-test/run-progress-panel.svelte`
- Modify: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`

- [ ] **Step 1: A label that reserves the width of every word it might become**

Create `steady-label.svelte`. It stacks every candidate label invisibly in one grid cell and lays the current one over them, so the cell is exactly as wide as the widest candidate — measured by the browser in the real font, never guessed.

```svelte
<script lang="ts">
  /*
   * A label whose box is as wide as the widest word it could ever hold.
   *
   * These buttons swap words as the run changes phase — Pause becomes Resume, Cancel becomes
   * Restart — and a button sized to its current word resizes when the word changes, shoving
   * everything beside it. Rendering every candidate invisibly in the same grid cell lets the browser
   * measure the widest in the real font; the visible word sits over that reservation and never
   * moves it.
   */
  let { labels, current }: { labels: readonly string[]; current: string } = $props();
</script>

<span class="grid">
  {#each labels as label (label)}
    <span aria-hidden="true" class="invisible col-start-1 row-start-1 whitespace-nowrap">{label}</span>
  {/each}
  <span class="col-start-1 row-start-1 whitespace-nowrap">{current}</span>
</span>
```

The invisible copies are `aria-hidden` — a screen reader must hear one word, not four.

- [ ] **Step 2: Keep the panel's rows from collapsing**

In `run-progress-panel.svelte`, the counter and size spans are empty before a run, so that row has no height and the panel grows when values arrive. Give the row a line box in every phase, using the same non-breaking space Task 18 established (a plain space collapses when it is an element's only content):

```svelte
<div class="flex items-baseline justify-between gap-16 text-xs tabular-nums text-text-muted">
  <span>{stepIndex !== null ? `Step ${stepIndex + 1} of ${stepCount}` : " "}</span>
  <span>{bytesUsed > 0 ? `${formatBytes(bytesUsed)} used` : " "}</span>
</div>
```

The panel has three rows of fixed height in every phase.

- [ ] **Step 3: Two button slots, always present**

The control region is always: panel, then a **primary** slot, then a **secondary** slot.

| Phase      | Primary | Secondary               |
| ---------- | ------- | ----------------------- |
| `idle`     | Start   | _(reserved, invisible)_ |
| `running`  | Pause   | Cancel                  |
| `paused`   | Resume  | Restart                 |
| `finished` | Retest  | Download report¹        |
| `failed`   | Retest  | _(reserved, invisible)_ |

¹ Task 12 adds the report button; reserving its width now means adding it later moves nothing.

Both slots use `SteadyLabel` with every word that slot can show:

```ts
const PRIMARY_LABELS = ["Start", "Pause", "Resume", "Retest"] as const;
const SECONDARY_LABELS = ["Cancel", "Restart", "Download report"] as const;
```

The secondary slot at idle and after a failure renders with `class="invisible"`. `visibility: hidden` keeps the box **and** removes it from the tab order, so a keyboard user is never sent to a control that does nothing. Do **not** render a disabled button labelled "Cancel": a control naming an action it will not perform is a lie.

**Cancel stays `variant="ghost"`.** Task 20 gives every ghost button an edge at rest, so it now reads as a button without a new variant. Restart stays `secondary`. Cancel is still never `destructive` — a speed test stores nothing to lose.

Derive `primaryLabel`, `primaryAction`, `secondaryLabel`, `secondaryAction`, and `secondaryVisible` from `store.phase` on the page.

- [ ] **Step 4: Stop saying the same number twice**

The masthead meta prints `{formatBytes(bytesUsed)} transferred`, and the progress panel now prints `… used`. Delete it from the masthead. Keep the timestamp, and keep the meta rendering in every phase — an empty meta collapses the masthead and moves the page:

```svelte
<Masthead.Meta>
  {#if store.finishedAt}
    <span>Run at {store.finishedAt.toLocaleTimeString()} on {store.finishedAt.toLocaleDateString()}</span>
  {:else}
    <span>Not run yet</span>
  {/if}
</Masthead.Meta>
```

- [ ] **Step 5: Verify the gates**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

Run: `vp test run-progress speed-test-format bandwidth-stats chart-scale measurement-ladder turn-capability`
Expected: PASS.

- [ ] **Step 6: Prove the region does not resize**

State in the report, for idle → running → paused → finished → failed, that the control region's width and height are unchanged, and how you established it. The invisible reservations are what make this true. **If you find yourself computing a pixel value, you have taken the wrong path.**

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/tools/speed-test "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "fix(tools): the control area is the same size in every phase"
```

---

### Task 21: An unmeasured value reads `N/A`

Owner: blank reads as broken. Put `N/A` where a measurement has not been taken, so a reader sees a field waiting for data rather than an empty box.

This supersedes Task 18's empty string. The em dash is still gone; the constant now carries `N/A`.

**What must not regress:**

- `N/A` must never appear where a _sentence_ belongs. The panels and charts keep `NOT_MEASURED_YET` ("Not measured yet."). `N/A` is for a value slot only.
- Absence must still never read as zero. `formatRatio(0)` is `0%` — a real, good packet-loss reading. `formatRatio(undefined)` is `N/A`.
- The line-box guards from Task 18 become unnecessary for these values, because `N/A` has content. **Leave them in place anyway** where a value could still be empty for another reason, but do not let a non-breaking space and an `N/A` both render.

**Files:**

- Modify: `apps/web/src/lib/tools/speed-test/speed-test-format.ts`
- Modify: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte` (`statRows` null branch)
- Modify: `apps/web/src/lib/tools/speed-test/quality-scores.svelte` (placeholder rating)
- Modify: `apps/web/src/lib/tools/speed-test/metric-tile.svelte` (retire the now-dead empty-value branch if it can no longer be reached)
- Test: `apps/web/test/speed-test-format.test.ts`

- [ ] **Step 1: Change the assertions first**

```ts
describe("an absent measurement", () => {
  it("reads N/A, so an empty field does not read as broken", () => {
    expect(formatBandwidth(undefined)).toBe("N/A");
    expect(formatMilliseconds(undefined)).toBe("N/A");
    expect(formatRatio(undefined)).toBe("N/A");
  });

  it("is never an em dash and never a zero", () => {
    expect(formatBandwidth(undefined)).not.toContain("—");
    expect(formatMilliseconds(undefined)).not.toMatch(/0/);
  });

  it("still distinguishes a measured zero from an absent one", () => {
    expect(formatRatio(0)).toBe("0%");
    expect(formatRatio(undefined)).toBe("N/A");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `vp test speed-test-format`
Expected: FAIL — the formatters return `""`.

- [ ] **Step 3: Change the constant**

```ts
/*
 * How an unmeasured value reads in a value slot. It was an em dash (which said nothing twice, once
 * the page gained a sentence for absence), then nothing (which read as broken). `N/A` shows a field
 * waiting for data. Where a SENTENCE belongs, the page says "Not measured yet." instead — see
 * NOT_MEASURED_YET below. Nothing may ever replace this with a zero: a measured zero is a result.
 */
const ABSENT = "N/A";
```

- [ ] **Step 4: Run it to verify it passes, then sweep the placeholders**

Run: `vp test speed-test-format`
Expected: PASS.

- `statRows`'s null branch returns `"N/A"` for Median, 95th, Peak, Samples, and Transferred.
- `quality-scores.svelte`'s placeholder rating renders `N/A` (its `NOT_MEASURED_YET` line stays).
- In `metric-tile.svelte`, if the empty-value branch is now unreachable for every call site, remove it rather than leave a dead nbsp; if any caller can still pass `""`, keep it and say so in the report.

- [ ] **Step 5: Verify the gates**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

Run: `vp test speed-test-format run-progress bandwidth-stats chart-scale measurement-ladder turn-capability`
Expected: PASS.

Then grep and report every hit, justifying each:

```bash
grep -rn "N/A\|Not measured yet\|—" apps/web/src/lib/tools/speed-test "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
```

No em dash may remain as a rendered value. No `N/A` may sit where a sentence belongs.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/tools/speed-test apps/web/test/speed-test-format.test.ts "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "fix(tools): an unmeasured value reads N/A"
```

---

### Task 22: A low-data mode, an auto-start preference, and one fewer "not yet"

Owner: three things.

1. The masthead says "Not run yet" while the panel says "Not started". Duplicative — drop the masthead's.
2. A **low-internet-usage mode** that runs only the lower-bandwidth measurements, to save data.
3. An **auto-start on opening the page** preference.

Both preferences live in a `…` overflow menu on the page, and both default to **off**.

**Low-data mode is not free, and the page must say so.** Capping the payloads at 1 MB keeps 5 of the 12 rounds. Every request then completes in well under a second, so the connection never reaches steady state and a fast line measures _slower than it is_. It also forfeits comparability with `speed.cloudflare.com`, and it skews the network-quality ratings, because download and upload speed feed them. Disclose this where the switch lives. The owner has accepted the trade — a person who turns it on learns the risk — but the risk must be there to learn.

**The figure to print is 20 MB, and it is an honest ceiling.** The ladder's payloads sum to **15.8 MB** (9.0 down, 6.8 up), but that sum excludes protocol overhead — the same exclusion the per-direction "Transferred" statistic makes. Twenty megabytes covers headers, TLS, and the latency probes, and it is a round tenth of the ~200 MB full run. Print the ceiling, not the payload sum, and **pin it with a test** so the copy cannot quietly become false if the rounds change.

**Auto-start spends the firm's bandwidth on navigation.** That is exactly what "no autostart" was protecting against, which is why it is opt-in, off by default, and only ever fires when the page opens with no run in progress.

**Files:**

- Create: `apps/web/src/lib/tools/speed-test/speed-test-preferences.ts` (pure: shape, defaults, parse)
- Create: `apps/web/src/lib/tools/speed-test/speed-test-preferences.svelte.ts` (the rune store)
- Create: `apps/web/src/lib/tools/speed-test/speed-test-menu.svelte`
- Modify: `apps/web/src/lib/tools/speed-test/measurement-ladder.ts` (a builder, not four constants)
- Modify: `apps/web/src/lib/tools/speed-test/speed-test-engine.svelte.ts`
- Modify: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`
- Test: `apps/web/test/speed-test-preferences.test.ts`, `apps/web/test/measurement-ladder.test.ts`

**Depends on Tasks 19–21.** Do it after them.

#### Part A — the ladder becomes a builder

Four exported constants (full, full+loss, light, light+loss) is a combinatorial mess. One builder, two booleans.

- [ ] **Step 1: Rewrite the ladder test**

Replace `apps/web/test/measurement-ladder.test.ts`'s body with tests over `buildLadder`:

```ts
import { describe, expect, it } from "vitest";
import {
  LOW_DATA_DISCLOSED_CEILING_BYTES,
  LOW_DATA_MAX_BYTES,
  buildLadder,
} from "../src/lib/tools/speed-test/measurement-ladder.ts";

const bytesOf = (ladder: ReturnType<typeof buildLadder>) =>
  ladder.reduce((total, step) => ("bytes" in step ? total + step.bytes * step.count : total), 0);

describe("buildLadder", () => {
  it("never measures packet loss unless asked", () => {
    const ladder = buildLadder({ lowData: false, packetLoss: false });
    expect(ladder.some((step) => step.type === "packetLoss")).toBe(false);
  });

  it("adds exactly one packet-loss phase when asked", () => {
    const ladder = buildLadder({ lowData: false, packetLoss: true });
    expect(ladder.filter((step) => step.type === "packetLoss")).toHaveLength(1);
  });

  it("climbs to Cloudflare's largest payloads in full mode, so results stay comparable", () => {
    const ladder = buildLadder({ lowData: false, packetLoss: false });
    const downloads = ladder.filter((s) => s.type === "download");
    expect(Math.max(...downloads.map((s) => ("bytes" in s ? s.bytes : 0)))).toBe(2.5e8);
  });

  it("caps every payload in low-data mode", () => {
    const ladder = buildLadder({ lowData: true, packetLoss: false });
    for (const step of ladder) {
      if ("bytes" in step) expect(step.bytes).toBeLessThanOrEqual(LOW_DATA_MAX_BYTES);
    }
  });

  it("keeps latency, download and upload phases in low-data mode", () => {
    const types = new Set(buildLadder({ lowData: true, packetLoss: false }).map((s) => s.type));
    expect(types).toEqual(new Set(["latency", "download", "upload"]));
  });

  it("transfers far less in low-data mode", () => {
    const light = bytesOf(buildLadder({ lowData: true, packetLoss: false }));
    const full = bytesOf(buildLadder({ lowData: false, packetLoss: false }));
    expect(light).toBeLessThan(full / 10);
  });

  // The page prints "under 20 MB". That sentence is a promise; this test is what keeps it true if
  // the rounds ever change. The payload sum is ~15.8 MB, and the headroom covers protocol overhead.
  it("stays under the ceiling the page discloses", () => {
    expect(bytesOf(buildLadder({ lowData: true, packetLoss: true }))).toBeLessThan(
      LOW_DATA_DISCLOSED_CEILING_BYTES,
    );
  });

  it("still measures packet loss in low-data mode when asked — it is a few kilobytes", () => {
    const ladder = buildLadder({ lowData: true, packetLoss: true });
    expect(ladder.filter((s) => s.type === "packetLoss")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails, then implement**

Run: `vp test measurement-ladder` → FAIL.

Rewrite `measurement-ladder.ts` around one builder. Keep Cloudflare's rounds and their order exactly; low-data mode **drops** the rounds whose payload exceeds the cap rather than inventing new ones, so the light run is a prefix of the real one and not a different experiment.

```ts
/** Above this payload size a round is dropped in low-data mode. */
export const LOW_DATA_MAX_BYTES = 1e6;

/*
 * The figure the page prints for a low-data run. The payloads sum to about 15.8 MB; this ceiling
 * covers protocol overhead, which the payload sum excludes, and lands on a round tenth of the full
 * run. A test pins the ladder beneath it, so the sentence on the page cannot quietly go false.
 */
export const LOW_DATA_DISCLOSED_CEILING_BYTES = 2e7;

export function buildLadder(options: {
  lowData: boolean;
  packetLoss: boolean;
}): MeasurementConfig[] {
  // …Cloudflare's rounds, filtered by `options.lowData`, with the packetLoss phase spliced in at
  // Cloudflare's own position (after the first upload round) only when `options.packetLoss`.
}
```

Delete `MEASUREMENT_LADDER` and `LADDER_WITH_PACKET_LOSS` once nothing imports them.

#### Part B — the preferences

- [ ] **Step 3: Write the failing preferences test**

`apps/web/test/speed-test-preferences.test.ts` covers `parsePreferences`: an absent or malformed value yields both flags **false**; a stored object with only one flag keeps the other's default; unknown keys are ignored. Both defaults are false — assert that explicitly, because a default of `true` on either would spend a firm's bandwidth without being asked.

- [ ] **Step 4: Implement, mirroring `tools-view-preference`**

`speed-test-preferences.ts` (pure): `SpeedTestPreferences { lowData: boolean; autoStart: boolean }`, `DEFAULT_PREFERENCES` (both `false`), `SPEED_TEST_PREFERENCES_KEY = "mc-speed-test-preferences"`, `parsePreferences(raw: string | null): SpeedTestPreferences`.

`speed-test-preferences.svelte.ts` (rune store): the localStorage read/write and cross-tab `storage` listener, SSR-safe, exactly as `tools-view-preference.svelte.ts` does it. Exports `preferences()`, `setLowData(value)`, `setAutoStart(value)`.

#### Part C — the menu, the engine, the masthead

- [ ] **Step 5: The `…` menu**

Create `speed-test-menu.svelte`: a `DropdownMenu` triggered by an icon button (Lucide `ellipsis`, `aria-label="Test options"`), containing two `DropdownMenu.CheckboxItem`s. Follow the overflow-menu precedent in `apps/web/src/lib/matters/matter-header.svelte`.

Each item states its cost beneath its label, in the muted text token:

- **Low internet usage** — "Transfers under 20 MB instead of about 200 MB. Uses small transfers, so a fast connection will measure slower than it is, and the results are not comparable to other speed tests."
- **Start automatically** — "Begins a test as soon as this page opens, spending data without asking."

Disable the menu while a run is in progress (`running` or `paused`): changing the ladder mid-run would silently mismatch the results on screen. Say why in a comment.

- [ ] **Step 6: The engine honours the preferences**

In `speed-test-engine.svelte.ts`, build the engine from `buildLadder({ lowData, packetLoss: turn.available })`. The ladder is fixed at construction, so **`start()` must build the engine after reading the current preference**, and `cancel()` already disposes it. If `lowData` changes while idle, nothing more is needed; if it could change while an engine exists, dispose it.

Expose `lowData` on the store's snapshot so the page and the report can state which mode produced a result.

- [ ] **Step 7: Auto-start**

On the page, in `onMount`: if the preference is set **and** `store.phase === "idle"`, call `store.start()`. Nowhere else. Never re-fire on a preference change, and never after a cancel — a person who cancelled a run did not ask for another.

- [ ] **Step 8: Drop the duplicate "not yet"**

`Masthead.Meta` currently reads "Not run yet" while the panel reads "Not started". Remove the masthead's. **It must still hold its line box**, or the masthead shrinks and the page moves (Task 9), so render a non-breaking space rather than nothing:

```svelte
<Masthead.Meta>
  {#if store.finishedAt}
    <span>Run at {store.finishedAt.toLocaleTimeString()} on {store.finishedAt.toLocaleDateString()}</span>
  {:else}
    <span> </span>
  {/if}
</Masthead.Meta>
```

- [ ] **Step 9: The footer tells the truth about both modes**

The page-foot disclosure names the mode in force:

> A full test transfers around 200 MB of data; low internet usage mode transfers under 20 MB, and measures a fast connection as slower than it is. Your public address is shared with Cloudflare's measurement endpoints to run it. This tool runs outside any matter, and nothing is saved.

- [ ] **Step 10: Verify the gates**

Run: `pnpm --filter @magna-carta/web run check` → 0 errors, 0 warnings.

Run: `vp test measurement-ladder speed-test-preferences run-progress speed-test-format bandwidth-stats chart-scale turn-capability` → PASS.

- [ ] **Step 11: Commit**

```bash
git add -A apps/web/src/lib/tools/speed-test apps/web/test "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "feat(tools): low-data mode, auto-start, and one fewer not-yet"
```

---

### Task 23: The two control buttons are the same size

Owner: Pause/Resume is not the same size as Cancel/Restart.

The reservation mechanism from Task 19 worked exactly as designed; the design was wrong. Each slot reserves the width of the widest word **it** can show, and the two sets are not the same size:

| Slot      | Words                                | Widest                 |
| --------- | ------------------------------------ | ---------------------- |
| Primary   | Start, Pause, Resume, Retest         | `Resume` (6)           |
| Secondary | Cancel, Restart, **Download report** | `Download report` (15) |

Two independent fixes, and both are wanted.

**1. `Download report` does not belong beside `Pause`.** It is not a run control, and reserving fifteen characters for it in the control row is what made the buttons unequal. Task 12 now places it in the `…` overflow menu instead. Remove it from the control labels.

**2. The two slots share one reservation.** Reserving each slot independently would still leave them unequal — `Resume` is 6 characters, `Restart` is 7. A single shared set of every word either button can show makes both exactly as wide as `Restart`: symmetric, and self-maintaining if a word is ever added.

**Files:**

- Modify: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`

**Depends on Task 19.** Do it after. Task 12 assumes it (its report action lives in the menu).

- [ ] **Step 1: One reservation for both slots**

Replace the two label sets with one, and pass it to both `SteadyLabel`s:

```ts
/*
 * Every word either control button can show. BOTH buttons reserve the width of the widest of
 * them, so the pair is symmetric and neither resizes when its word changes. Reserving each slot
 * against only its own words would still leave them unequal — "Resume" is shorter than "Restart".
 *
 * "Download report" is deliberately absent: it is not a run control, it lives in the overflow
 * menu, and reserving its width here would make both buttons far wider than they need to be.
 */
const CONTROL_LABELS = ["Start", "Pause", "Resume", "Retest", "Cancel", "Restart"] as const;
```

Both call sites become `<SteadyLabel labels={CONTROL_LABELS} current={...} />`. Delete `PRIMARY_LABELS` and `SECONDARY_LABELS`.

- [ ] **Step 2: The secondary slot's word set shrinks**

`secondaryLabel` now only ever yields `Cancel` (running) or `Restart` (paused); the slot is `invisible` in every other phase. Confirm no phase asks it for `Download report`.

- [ ] **Step 3: Verify the gates**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

Run: `vp test run-progress speed-test-format bandwidth-stats chart-scale measurement-ladder turn-capability`
Expected: PASS.

- [ ] **Step 4: State the property you have established**

In your report, confirm: both buttons render at the same width in every phase, because both reserve the same word set; and neither changes width when its word changes. **If you find yourself setting a `min-width`, you have taken the wrong path** — the reservation is done by the browser measuring invisible copies, never by a number.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "fix(tools): both control buttons reserve the same words, so both are the same size"
```

---

### Task 24: One marker for absence, in one place, easy to change

Owner: the page shows `N/A` in some places and "Not measured yet." in others. Use one. `N/A` may not have been the right choice — a plain hyphen `-` (never an em dash) is probably better — and it must be easy to change again later.

**What went wrong.** I split absence into two vocabularies — a marker for value slots, a sentence for prose — and called it a principle. It is not: it is two ways to say one thing, and `quality-scores.svelte` renders **both, stacked** (`N/A` above "Not measured yet."). The page should say a measurement is missing exactly one way.

**The design that makes the next change a one-line edit.**

1. Absence gets **its own module**, not a corner of the number formatter. `speed-test-format.ts` formats numbers; whether a thing was measured is not a number format.
2. **One visible marker**, exported once. Changing `-` to `N/A` or anything else is editing one line.
3. **One accessible description**, separate and deliberately different. A screen reader must hear a word, not a hyphen: `aria-label="Download: not measured"` is right, `aria-label="Download: -"` is useless. That is the same fact in another medium, not a second vocabulary, and it appears only inside `aria-*` attributes.
4. **A fitness test forbids the literals**, so nobody can hand-write `N/A`, `Not measured yet.`, or an em dash again.

**What must not regress:** a measured zero is a result. `formatRatio(0)` is `0%`; `formatRatio(undefined)` is the marker. Every value's line box must survive — the marker has content, so that is free — but do not remove the guards protecting rows that can still be genuinely empty (the progress panel's counter row).

**Files:**

- Create: `apps/web/src/lib/tools/speed-test/absence.ts`
- Create: `apps/web/test/absence.test.ts`
- Modify: `apps/web/src/lib/tools/speed-test/speed-test-format.ts` (consume the marker; delete `ABSENT` and `NOT_MEASURED_YET`)
- Modify: `quality-scores.svelte`, `server-panel.svelte`, `bandwidth-chart.svelte`, `latency-chart.svelte`, `metric-tile.svelte`
- Modify: `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`

**Depends on Task 22.** Do it after.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/absence.test.ts`. It asserts the marker and its spoken form, and then **sweeps the tool directory** for any other way of saying a measurement is missing.

The sweep must prove it actually read files — a sweep that silently matches nothing is worse than no test. Assert that it found a non-zero number of files before asserting there are no offenders. Resolve the directory from `import.meta.dirname` rather than assuming the process working directory.

Banned literals, anywhere under `src/lib/tools/speed-test/` except `absence.ts`: `N/A`, `Not measured yet`, and the em-dash character.

- [ ] **Step 2: Run it to verify it fails**

Run: `vp test absence`
Expected: FAIL — `absence.ts` does not exist; and once it does, the sweep still finds the old literals across the tool.

- [ ] **Step 3: Give absence a home**

Create `apps/web/src/lib/tools/speed-test/absence.ts`:

```ts
/*
 * How this tool says a measurement was not taken.
 *
 * ONE marker, in ONE place. It has been an em dash (which said nothing twice, once the page also had
 * a sentence for absence), then nothing (which read as broken), then "N/A", and now a plain hyphen.
 * Every one of those changes should have been a single edit. Now it is.
 *
 * The spoken form is separate on purpose. A screen reader announcing "Download: hyphen" tells a
 * person nothing; it must hear a word. That is the same fact in a different medium, not a second
 * vocabulary, and it belongs only in `aria-*` attributes, never on screen.
 *
 * Nothing here may ever become "0". A measured zero is a result: packet loss of exactly 0% is the
 * best possible reading, and must never be confused with a measurement that did not happen.
 */

/** Shown wherever a measurement is missing. Change this line, change the page. */
export const ABSENT_MARKER = "-";

/** Announced wherever a measurement is missing. Only ever used inside `aria-*`. */
export const ABSENT_DESCRIPTION = "not measured";
```

- [ ] **Step 4: Make every site consume it**

- `speed-test-format.ts`: import `ABSENT_MARKER` and return it from `formatBandwidth`, `formatMilliseconds`, and `formatRatio`. **Delete `ABSENT` and `NOT_MEASURED_YET`.** Update the module comment: it formats numbers; absence lives elsewhere now.
- `quality-scores.svelte`: the placeholder renders the marker **once**, as the rating. The points line beneath renders a non-breaking space so the row keeps its height — it does not repeat the marker, and it carries no sentence.
- `server-panel.svelte`: when `probe === null`, render the same labelled round-trip row that the reachable branch renders, with the marker as its value — not a standalone sentence. **Leave the `unauthenticated`, `forbidden`, and `unreachable` branches exactly as they are.** Those say _why not_, which is actionable, and they are not absence.
- `bandwidth-chart.svelte` and `latency-chart.svelte`: the empty state renders the marker where the marks would be. Their `aria-label` uses `ABSENT_DESCRIPTION`.
- `metric-tile.svelte`: a `note` with nothing to say renders a non-breaking space, so a tile's height never depends on whether it has a note.
- The page: the packet-loss tile's idle branch passes no note text — the marker in the value slot already says it — while the `forbidden`, `unauthenticated`, and `not-configured` branches keep their specific notes.

- [ ] **Step 5: Run the tests**

Run: `vp test absence speed-test-format run-progress bandwidth-stats chart-scale measurement-ladder turn-capability`
Expected: PASS, and the sweep finds no offenders.

- [ ] **Step 6: Verify the gates**

Run: `pnpm --filter @magna-carta/web run check`
Expected: 0 errors, 0 warnings.

Then confirm the old names are gone everywhere:

```bash
grep -rn "NOT_MEASURED_YET" apps/web/src
grep -rn "ABSENT" apps/web/src | grep -v absence.ts
```

Both must return nothing. Report the output.

- [ ] **Step 7: Commit**

```bash
git add -A apps/web/src/lib/tools/speed-test apps/web/test "apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte"
git commit -m "fix(tools): one marker for absence, in one place"
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
