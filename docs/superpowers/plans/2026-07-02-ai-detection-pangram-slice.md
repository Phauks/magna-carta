# AI-Text Detection — Pangram First-Vendor Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Pangram behind the existing `AiTextDetectionPort` so the AI-Text Detection tool actually works — a platform-managed, backend-only, paste-text detection endpoint with per-firm consent and metering.

**Architecture:** A concrete `pangram` adapter drops in beside the deferred one in the pure `@magna-carta/ai-detection` package: it calls Pangram over an injected `HttpClient`, validates the response at the trust boundary, maps it to `RawDetection`, and runs it through the existing `normalize()`. A firm consent setting (default off) is enforced at the slice-0·5 worker chokepoint — the route reads it before constructing the adapter. Every successful detection appends one row to a dedicated per-firm `ai_detection_usage` table (word-native metering). No UI (gated on the 0·7 design-system shell).

**Tech Stack:** TypeScript, Cloudflare Workers + Hono (`@hono/zod-openapi`), per-firm SQLite Durable Object, Drizzle (schema + migrations), Vitest (`cloudflare:test` Miniflare pool for worker integration tests), `vp` CLI.

**Spec:** `docs/specs/2026-06-29-ai-text-detection-pangram-slice-design.md`. Read it before starting.

## Global Constraints

Every task's requirements implicitly include this section.

- **Purity (pure package):** `@magna-carta/ai-detection/src` may import only relative paths or an explicit allowlist (enforced by `packages/ai-detection/test/purity.test.ts`). No D1, Hono, env, Svelte, network, or vendor SDK. New allowlist entries permitted this slice: `@magna-carta/integrations/http` (the `HttpClient` interface type), `@magna-carta/data-access/setting-statements` (the `FirmSettingDefinition` type — a pure-data type-only import, the same tradeoff `@magna-carta/inference` makes), and `zod` (pure validation, no I/O — required ONLY by `settings.ts` because `FirmSettingDefinition.schema` is typed `z.ZodType<T>` and cannot be satisfied without it; this mirrors `@magna-carta/inference`, which depends on `zod` for the identical reason). The **response parser and adapter (Tasks 1-2) stay zod-free** — validate the untrusted Pangram response by hand-rolled type guard, keeping the network-boundary code dependency-light; `zod` enters the package solely for the settings definition.
- **No `Date.now()` in the pure core.** Timestamps are passed in — the worker supplies `detectedAt`. (`report.ts`, `normalize.ts` already enforce this.)
- **`egressedTo` is required** on every `DetectionReport.provenance` — the Pangram adapter always passes `egressedTo: "pangram"` into `normalize()`.
- **Signal, not proof stays structural.** Do not add a boolean verdict, do not weaken `FATAL_CAVEATS`, do not bypass `normalize()`. The adapter's only job is vendor→`RawDetection`; framing is `normalize()`'s.
- **Consent default OFF.** `aiDetection.externalDetectionEnabled` defaults `false`; privilege never egresses on an implicit yes. The route is the single enforcement point.
- **Never log or echo the analyzed text.** Adapter/route error `detail` strings carry no request text and no upstream response body.
- **Full names, no shorthand** (golden rule 12): `newIdentifier` not `newId`, "the data-access layer" not "the DAL", `firmId`, etc.
- **No process-doc references in source** (golden rule 13): no `ADR-NNNN`, "spec §N", "slice N", "Phase N" in code/tests/OpenAPI `description`s. State the reasoning inline or cite a file path. A forward-looking "built in a later slice" schedule note is the only allowed exception.
- **Docs same commit** (golden rule 5): the feature is not done until a `changelog.d/<slug>.md` fragment and a `docs/decisions/pending/<slug>.md` ADR fragment exist. Never hand-edit `CHANGELOG.md` or the Decision-Log register on a branch.
- **Contract is code-as-contract:** adding the route regenerates the OpenAPI snapshot + the generated client, or the byte-exact drift test fails.
- **Migration slot:** the next free per-firm migration index is **0033** (journal `packages/database/drizzle/per-firm/meta/_journal.json` ends at idx 32, tag `0032_seed-tools-file-type-verifier`). The drizzle snapshot chain is known-fragile — verify with the database test suite after every migration change; never guess snapshot JSON.
- **Already present (do NOT re-add):** the `tools:aiTextDetection` permission (`packages/access-control/src/registry.ts`), the `ai-text-detection` catalog row (`packages/tools/src/catalog.ts`), and the `ai-detection` manifest + deferred adapter (`packages/ai-detection/src/manifest.ts`, `src/adapters/deferred.ts`). These merged with the core.
- **Working directory:** the worktree `C:/dev/magna-carta-worktrees/ai-detection-pangram` (branch `ai-detection-pangram`). Run package tests with `vp test` or `pnpm --filter <pkg> test run`; the full gate is `pnpm check`.

---

## File Structure

**`packages/ai-detection/`** (pure — extend)

- `src/adapters/pangram-response.ts` — the Pangram `predict` response shape + a hand-rolled `parsePangramResponse(json: unknown)` type guard (trust-boundary validation, no zod).
- `src/adapters/pangram.ts` — `createPangramAdapter(config)` → `AiTextDetectionPort`; maps the validated response → `RawDetection`, runs `normalize()`, maps transport/vendor failures → `adapterError`.
- `src/settings.ts` — `externalDetectionEnabledDefinition: FirmSettingDefinition<boolean>`.
- `test/pangram-response.test.ts`, `test/pangram.test.ts`, `test/settings.test.ts` — new tests.
- `test/purity.test.ts` — extend the allowlist.
- `package.json` — add the three new `exports` subpaths.

**`packages/data-access/`** (extend)

- `src/ai-detection-usage-statements.ts` — `recordAiDetectionUsageStatement(...)` (one-row insert) + `readAiDetectionUsage(...)` (the firm-usage read).
- `test/ai-detection-usage-statements.test.ts`.

**`packages/identifiers/`** (extend)

- `src/registry.ts` — add `aiDetectionUsage` prefix.
- `src/types.ts` — add `AiDetectionUsageId` alias.

**`packages/database/`** (extend)

- `src/per-firm-schema.ts` — add the `aiDetectionUsage` `sqliteTable`.
- `drizzle/per-firm/0033_ai-detection-usage.sql` + `meta/0033_snapshot.json` + `meta/_journal.json` entry — the CREATE TABLE migration (drizzle-generated, then verified).
- `drizzle/per-firm/0034_seed-tools-ai-text-detection.sql` + `meta/_journal.json` entry — the role-permission seed (hand-authored, no snapshot).

**`apps/worker/`** (extend)

- `src/http/routes/files/ai-detection.ts` — `POST /api/v1/ai-detection/detect` through the chokepoint; consent gate; adapter construction (Pangram when the key is set, deferred otherwise); metering write; problem mapping.
- `src/http/app.ts` — import + call `registerAiDetectionRoutes`; add `PANGRAM_API_KEY?: string` + `PANGRAM_BASE_URL?: string` to `Bindings`.
- `wrangler.jsonc` / `.dev.vars` (or the test var seam) — declare the binding.
- `test/ai-detection-route.test.ts`, `test/seed-tools-ai-text-detection.test.ts` — new tests.
- OpenAPI snapshot + generated client — regenerated.

**Docs**

- `changelog.d/ai-detection-pangram.md`, `docs/decisions/pending/ai-detection-pangram-adapter.md`, `STATUS.md` row.

---

## Task 1: Pangram response contract + boundary parser (pure)

**Files:**

- Create: `packages/ai-detection/src/adapters/pangram-response.ts`
- Test: `packages/ai-detection/test/pangram-response.test.ts`

**Interfaces:**

- Produces: `interface PangramWindow { start_index: number; end_index: number; ai_assistance_score: number; confidence?: number }`; `interface PangramPrediction { fraction_ai: number; fraction_ai_assisted?: number; version?: string; stage?: string; windows?: readonly PangramWindow[] }`; `parsePangramResponse(json: unknown): PangramPrediction | null` (returns `null` on any shape violation — never throws).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/ai-detection/test/pangram-response.test.ts
import { describe, expect, it } from "vitest";
import { parsePangramResponse } from "../src/adapters/pangram-response.ts";

describe("parsePangramResponse", () => {
  it("accepts a well-formed prediction and preserves optional fields", () => {
    const parsed = parsePangramResponse({
      fraction_ai: 0.92,
      fraction_ai_assisted: 0.1,
      version: "v3",
      stage: "production",
      windows: [{ start_index: 0, end_index: 40, ai_assistance_score: 0.9, confidence: 0.8 }],
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.fraction_ai).toBe(0.92);
    expect(parsed?.windows?.[0]?.end_index).toBe(40);
  });

  it("accepts the minimal shape (only fraction_ai)", () => {
    expect(parsePangramResponse({ fraction_ai: 0.1 })).toEqual({ fraction_ai: 0.1 });
  });

  it("returns null when fraction_ai is missing or non-numeric", () => {
    expect(parsePangramResponse({})).toBeNull();
    expect(parsePangramResponse({ fraction_ai: "0.5" })).toBeNull();
  });

  it("returns null for a non-object", () => {
    expect(parsePangramResponse(null)).toBeNull();
    expect(parsePangramResponse("nope")).toBeNull();
  });

  it("rejects a malformed window rather than dropping it", () => {
    expect(parsePangramResponse({ fraction_ai: 0.5, windows: [{ start_index: 0 }] })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @magna-carta/ai-detection test run pangram-response`
Expected: FAIL — `parsePangramResponse` is not defined.

- [ ] **Step 3: Write the parser**

```typescript
// packages/ai-detection/src/adapters/pangram-response.ts
// Pangram's `predict` response, validated at the trust boundary before any mapping. Hand-rolled (no
// schema library) so the pure package stays dependency-free. A shape violation returns null — the
// adapter maps that to a validation problem, never a throw and never a silently-dropped field.

export interface PangramWindow {
  readonly start_index: number;
  readonly end_index: number;
  readonly ai_assistance_score: number;
  readonly confidence?: number;
}

export interface PangramPrediction {
  readonly fraction_ai: number;
  readonly fraction_ai_assisted?: number;
  readonly version?: string;
  readonly stage?: string;
  readonly windows?: readonly PangramWindow[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalNumber(value: unknown): value is number | undefined {
  return value === undefined || typeof value === "number";
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function parseWindow(value: unknown): PangramWindow | null {
  if (!isRecord(value)) return null;
  if (typeof value.start_index !== "number") return null;
  if (typeof value.end_index !== "number") return null;
  if (typeof value.ai_assistance_score !== "number") return null;
  if (!optionalNumber(value.confidence)) return null;
  return {
    start_index: value.start_index,
    end_index: value.end_index,
    ai_assistance_score: value.ai_assistance_score,
    ...(value.confidence !== undefined ? { confidence: value.confidence } : {}),
  };
}

export function parsePangramResponse(json: unknown): PangramPrediction | null {
  if (!isRecord(json)) return null;
  if (typeof json.fraction_ai !== "number") return null;
  if (!optionalNumber(json.fraction_ai_assisted)) return null;
  if (!optionalString(json.version)) return null;
  if (!optionalString(json.stage)) return null;

  let windows: PangramWindow[] | undefined;
  if (json.windows !== undefined) {
    if (!Array.isArray(json.windows)) return null;
    windows = [];
    for (const raw of json.windows) {
      const parsed = parseWindow(raw);
      if (parsed === null) return null;
      windows.push(parsed);
    }
  }

  return {
    fraction_ai: json.fraction_ai,
    ...(json.fraction_ai_assisted !== undefined
      ? { fraction_ai_assisted: json.fraction_ai_assisted }
      : {}),
    ...(json.version !== undefined ? { version: json.version } : {}),
    ...(json.stage !== undefined ? { stage: json.stage } : {}),
    ...(windows !== undefined ? { windows } : {}),
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @magna-carta/ai-detection test run pangram-response`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ai-detection/src/adapters/pangram-response.ts packages/ai-detection/test/pangram-response.test.ts
git commit -m "feat(ai-detection): Pangram response boundary parser"
```

---

## Task 2: Pangram adapter (pure)

**Files:**

- Create: `packages/ai-detection/src/adapters/pangram.ts`
- Modify: `packages/ai-detection/test/purity.test.ts` (allowlist), `packages/ai-detection/package.json` (exports)
- Test: `packages/ai-detection/test/pangram.test.ts`

**Interfaces:**

- Consumes: `parsePangramResponse` / `PangramPrediction` (Task 1); `normalize`, `MIN_RELIABLE_CHARACTERS` (`../normalize.ts`); `AiTextDetectionPort`, `DetectionInput`, `RawDetection`, `RawSegment` (`../port.ts`); `HttpClient`, `HttpRequest` (`@magna-carta/integrations/http`); `ok`, `adapterError`, `Dispatch` (`@magna-carta/integrations/dispatch`); `IntegrationProblem` (`@magna-carta/integrations/problem`).
- Produces: `interface PangramAdapterConfig { http: HttpClient; apiKey: string; baseUrl: string; now: () => string }`; `createPangramAdapter(config: PangramAdapterConfig): AiTextDetectionPort`.

**Reference — the transport seam (`packages/integrations/src/http.ts`):** `HttpClient.request(input: HttpRequest): Promise<HttpResponse>`; `HttpRequest = { method: "GET"|"POST"; url: string; headers: Record<string,string>; body?: string }`; `HttpResponse = { status: number; json(): Promise<unknown> }`.

**Reference — dispatch (`packages/integrations/src/dispatch.ts`):** `ok(value)`, `adapterError(problem: IntegrationProblem)`. Check the exact `IntegrationProblem` fields with a quick read of `packages/integrations/src/problem.ts` before writing (it has a `category` and a caller-safe `detail`).

- [ ] **Step 1: Read the problem contract**

Run: open `packages/integrations/src/problem.ts` and note the `IntegrationProblem` shape + how existing adapters build one (e.g. `packages/shipping/src/easypost.ts`). Use `category: "upstream"` for a 5xx/transport failure and `category: "validation"` for a malformed/parse failure. Confirm field names before Step 3.

- [ ] **Step 2: Write the failing test**

```typescript
// packages/ai-detection/test/pangram.test.ts
import { describe, expect, it } from "vitest";
import type { HttpClient, HttpRequest, HttpResponse } from "@magna-carta/integrations/http";
import type { FirmId } from "@magna-carta/identifiers/types";
import { createPangramAdapter } from "../src/adapters/pangram.ts";

const FIRM = "firm_test000000000000000" as FirmId;
const AT = "2026-07-02T00:00:00.000Z";
// 300 characters — above MIN_RELIABLE_CHARACTERS so a clean result is not forced inconclusive.
const LONG_TEXT = "a".repeat(300);

function stubClient(response: HttpResponse, capture?: (req: HttpRequest) => void): HttpClient {
  return {
    async request(req) {
      capture?.(req);
      return response;
    },
  };
}
function jsonResponse(status: number, body: unknown): HttpResponse {
  return { status, json: async () => body };
}

function adapter(client: HttpClient) {
  return createPangramAdapter({
    http: client,
    apiKey: "test-key",
    baseUrl: "https://pangram.example",
    now: () => AT,
  });
}

describe("createPangramAdapter.detect", () => {
  it("maps a clean-AI response to band 'likely' with pangram provenance", async () => {
    let seen: HttpRequest | undefined;
    const port = adapter(
      stubClient(
        jsonResponse(200, { fraction_ai: 0.95, version: "v3", stage: "production" }),
        (req) => (seen = req),
      ),
    );
    const result = await port.detect({ text: LONG_TEXT, firmId: FIRM });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.band).toBe("likely");
    expect(result.value.provenance.egressedTo).toBe("pangram");
    expect(result.value.provenance.adapterId).toBe("pangram");
    expect(result.value.provenance.detectedAt).toBe(AT);
    // The request carries the key and never sets a public dashboard link for privileged content.
    expect(seen?.method).toBe("POST");
    expect(JSON.stringify(seen?.headers)).toContain("test-key");
    expect(seen?.body).toContain('"public_dashboard_link":false');
  });

  it("forces 'inconclusive' when Pangram reports AI-assisted (paraphrase caveat)", async () => {
    const port = adapter(
      stubClient(jsonResponse(200, { fraction_ai: 0.9, fraction_ai_assisted: 0.4 })),
    );
    const result = await port.detect({ text: LONG_TEXT, firmId: FIRM });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.band).toBe("inconclusive");
    expect(result.value.caveats).toContain("possible-paraphrase-or-humanization");
  });

  it("maps window offsets to character segments", async () => {
    const port = adapter(
      stubClient(
        jsonResponse(200, {
          fraction_ai: 0.9,
          windows: [{ start_index: 0, end_index: 50, ai_assistance_score: 0.9, confidence: 0.9 }],
        }),
      ),
    );
    const result = await port.detect({ text: LONG_TEXT, firmId: FIRM });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.segments?.[0]?.startCharacter).toBe(0);
    expect(result.value.segments?.[0]?.endCharacter).toBe(50);
  });

  it("returns adapter-error (no text leak) on a 5xx", async () => {
    const port = adapter(stubClient(jsonResponse(503, { error: "upstream" })));
    const result = await port.detect({ text: "secret privileged content", firmId: FIRM });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("adapter-error");
    expect(JSON.stringify(result)).not.toContain("secret privileged content");
  });

  it("returns adapter-error (validation) on a malformed 200 body, not a throw", async () => {
    const port = adapter(stubClient(jsonResponse(200, { not_a_prediction: true })));
    const result = await port.detect({ text: LONG_TEXT, firmId: FIRM });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("adapter-error");
  });
});
```

- [ ] **Step 3: Write the adapter**

```typescript
// packages/ai-detection/src/adapters/pangram.ts
import { adapterError, ok, type Dispatch } from "@magna-carta/integrations/dispatch";
import type { HttpClient } from "@magna-carta/integrations/http";
import type { AiTextDetectionPort, DetectionInput, RawDetection, RawSegment } from "../port.ts";
import type { DetectionReport } from "../report.ts";
import { normalize } from "../normalize.ts";
import { parsePangramResponse, type PangramPrediction } from "./pangram-response.ts";

// The platform-managed Pangram adapter. It calls Pangram over the injected HttpClient (the pure
// package never touches the network itself), validates the response at the boundary, maps it to the
// vendor-neutral RawDetection, and hands that to normalize() — the framing (band/reliability/caveats)
// is ours. The API key is injected at construction (a platform secret, not a per-firm credential), so
// the adapter declares no connection. Errors surface as an adapter-error dispatch whose detail never
// echoes the analyzed text.
export interface PangramAdapterConfig {
  readonly http: HttpClient;
  readonly apiKey: string;
  readonly baseUrl: string; // e.g. https://text.api.pangram.com — a binding, not a code constant
  readonly now: () => string; // ISO-8601 instant; the pure core never calls Date.now()
}

const ADAPTER_ID = "pangram";
const EGRESSED_TO = "pangram";

function toSegments(prediction: PangramPrediction): readonly RawSegment[] | undefined {
  if (prediction.windows === undefined) return undefined;
  return prediction.windows.map((window) => ({
    startCharacter: window.start_index,
    endCharacter: window.end_index,
    score: window.ai_assistance_score,
  }));
}

// The lowest per-window confidence is the adapter's vendorConfidence: one weak window undercuts the
// whole result, which is the conservative reading the caveat layer wants.
function minWindowConfidence(prediction: PangramPrediction): number | undefined {
  const confidences = (prediction.windows ?? [])
    .map((window) => window.confidence)
    .filter((value): value is number => value !== undefined);
  return confidences.length > 0 ? Math.min(...confidences) : undefined;
}

function toRawDetection(prediction: PangramPrediction): RawDetection {
  const vendorConfidence = minWindowConfidence(prediction);
  const segments = toSegments(prediction);
  const paraphraseSuspected =
    prediction.fraction_ai_assisted !== undefined && prediction.fraction_ai_assisted > 0;
  return {
    score: prediction.fraction_ai,
    ...(vendorConfidence !== undefined ? { vendorConfidence } : {}),
    ...(prediction.version !== undefined ? { vendorModel: prediction.version } : {}),
    ...(prediction.stage !== undefined ? { vendorVersion: prediction.stage } : {}),
    ...(segments !== undefined ? { segments } : {}),
    ...(paraphraseSuspected ? { signals: { paraphraseSuspected: true } } : {}),
  };
}

export function createPangramAdapter(config: PangramAdapterConfig): AiTextDetectionPort {
  return {
    async detect(input: DetectionInput): Promise<Dispatch<DetectionReport>> {
      let status: number;
      let body: unknown;
      try {
        const response = await config.http.request({
          method: "POST",
          url: `${config.baseUrl}/predict`,
          headers: {
            "content-type": "application/json",
            "x-api-key": config.apiKey,
          },
          body: JSON.stringify({ text: input.text, public_dashboard_link: false }),
        });
        status = response.status;
        body = await response.json();
      } catch {
        // A transport failure carries nothing caller-safe from the request; never include the text.
        return adapterError({
          category: "upstream",
          detail: "The detection provider could not be reached.",
        });
      }
      if (status < 200 || status >= 300) {
        return adapterError({
          category: "upstream",
          detail: `The detection provider returned status ${status}.`,
        });
      }
      const prediction = parsePangramResponse(body);
      if (prediction === null) {
        return adapterError({
          category: "validation",
          detail: "The detection provider returned an unexpected response shape.",
        });
      }
      return ok(
        normalize(input, toRawDetection(prediction), {
          adapterId: ADAPTER_ID,
          detectedAt: config.now(),
          egressedTo: EGRESSED_TO,
        }),
      );
    },
  };
}
```

> Adjust the `adapterError({...})` payload in Step 3 to the exact `IntegrationProblem` shape you confirmed in Step 1 (field names/category values). If `adapterError` takes the problem directly, the above is correct; if it wraps differently, match the shipping adapter's usage.

- [ ] **Step 4: Extend the purity allowlist**

In `packages/ai-detection/test/purity.test.ts`, add to `allowedPackages`:

```typescript
  "@magna-carta/integrations/http", // the HttpClient interface type — a pure transport seam, no network here
```

- [ ] **Step 5: Add package exports**

In `packages/ai-detection/package.json`, add to `exports`:

```json
    "./adapters/pangram": "./src/adapters/pangram.ts",
```

- [ ] **Step 6: Run the tests, verify they pass**

Run: `pnpm --filter @magna-carta/ai-detection test run`
Expected: PASS — the new pangram tests + purity still green (all existing tests unaffected).

- [ ] **Step 7: Commit**

```bash
git add packages/ai-detection/src/adapters/pangram.ts packages/ai-detection/test/pangram.test.ts packages/ai-detection/test/purity.test.ts packages/ai-detection/package.json
git commit -m "feat(ai-detection): platform-managed Pangram adapter"
```

---

## Task 3: Firm consent setting (pure)

**Files:**

- Create: `packages/ai-detection/src/settings.ts`
- Modify: `packages/ai-detection/test/purity.test.ts` (allowlist), `packages/ai-detection/package.json` (exports)
- Test: `packages/ai-detection/test/settings.test.ts`

**Interfaces:**

- Consumes: `FirmSettingDefinition` (`@magna-carta/data-access/setting-statements`, type-only).
- Produces: `externalDetectionEnabledDefinition: FirmSettingDefinition<boolean>` — key `aiDetection.externalDetectionEnabled`, default `false`.

**Reference — the mirror pattern (`packages/inference/src/settings.ts` line 25):** `aiProcessingEligibilityDefinition: FirmSettingDefinition<boolean>` with `schema: z.boolean()`, `defaultValue: false`. NOTE: inference uses `zod` for the schema, but this package must stay zod-free. Provide the `z.ZodType<boolean>` via a tiny hand-rolled schema object that satisfies the `FirmSettingDefinition` `schema` field's `safeParse`/`parse` contract — OR confirm whether a `zod`-free boolean validator is acceptable. Check `FirmSettingDefinition.schema`'s type: it is `z.ZodType<T>` (`packages/data-access/src/setting-statements.ts` line 16). A hand-rolled object cannot satisfy `z.ZodType`. **Resolution:** add `zod` to this package (it is a pure validation library, not a vendor SDK or I/O) — add `"zod": "catalog:"` to `dependencies` and `"zod"` to the purity allowlist with a comment. This is the pragmatic, codebase-consistent choice for the one place a `FirmSettingDefinition` is declared.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/ai-detection/test/settings.test.ts
import { describe, expect, it } from "vitest";
import { externalDetectionEnabledDefinition } from "../src/settings.ts";

describe("externalDetectionEnabledDefinition", () => {
  it("keys aiDetection.externalDetectionEnabled and defaults to false", () => {
    expect(externalDetectionEnabledDefinition.key).toBe("aiDetection.externalDetectionEnabled");
    expect(externalDetectionEnabledDefinition.defaultValue).toBe(false);
  });

  it("validates booleans through its schema", () => {
    expect(externalDetectionEnabledDefinition.schema.safeParse(true).success).toBe(true);
    expect(externalDetectionEnabledDefinition.schema.safeParse("yes").success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @magna-carta/ai-detection test run settings`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the setting**

```typescript
// packages/ai-detection/src/settings.ts
import type { FirmSettingDefinition } from "@magna-carta/data-access/setting-statements";
import { z } from "zod";

// The firm-default consent axis for external AI-text detection: may this firm's text be sent to a
// third-party detector at all? Default OFF — the strictest posture; privileged content never egresses
// on an implicit yes. Read through the generic firm-setting accessor (a missing row = this default),
// enforced at the detection route before any provider call. The consent UI is a later slice.
export const externalDetectionEnabledDefinition: FirmSettingDefinition<boolean> = {
  key: "aiDetection.externalDetectionEnabled",
  schema: z.boolean(),
  defaultValue: false,
};
```

- [ ] **Step 4: Add the dependency + allowlist entries**

In `packages/ai-detection/package.json` `dependencies`, add `"zod": "catalog:"`. In `exports`, add `"./settings": "./src/settings.ts"`. In `packages/ai-detection/test/purity.test.ts` `allowedPackages`, add:

```typescript
  "@magna-carta/data-access/setting-statements", // FirmSettingDefinition type only — pure data, no D1
  "zod", // pure boundary/settings validation — no I/O, not a vendor SDK
```

- [ ] **Step 5: Run tests, verify pass**

Run: `pnpm --filter @magna-carta/ai-detection test run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ai-detection/src/settings.ts packages/ai-detection/test/settings.test.ts packages/ai-detection/test/purity.test.ts packages/ai-detection/package.json
git commit -m "feat(ai-detection): firm consent setting (external detection, default off)"
```

---

## Task 4: Identifier registration for the usage handle

**Files:**

- Modify: `packages/identifiers/src/registry.ts`, `packages/identifiers/src/types.ts`

**Interfaces:**

- Produces: entity type `aiDetectionUsage`; `AiDetectionUsageId = Identifier<"aiDetectionUsage">`.

- [ ] **Step 1: Add the prefix**

In `packages/identifiers/src/registry.ts`, add to `ENTITY_PREFIXES` (near the other Tools/integration entries, keeping the "prefix = key, spelled in full" rule):

```typescript
  aiDetectionUsage: "aiDetectionUsage",
```

- [ ] **Step 2: Add the type alias**

In `packages/identifiers/src/types.ts`, add beside the other id aliases:

```typescript
export type AiDetectionUsageId = Identifier<"aiDetectionUsage">;
```

- [ ] **Step 3: Run the identifiers tests**

Run: `pnpm --filter @magna-carta/identifiers test run`
Expected: PASS (the registry/type coherence tests accept the new entry).

- [ ] **Step 4: Commit**

```bash
git add packages/identifiers/src/registry.ts packages/identifiers/src/types.ts
git commit -m "feat(identifiers): aiDetectionUsage handle prefix"
```

---

## Task 5: Metering data-access statements

**Files:**

- Create: `packages/data-access/src/ai-detection-usage-statements.ts`
- Test: `packages/data-access/test/ai-detection-usage-statements.test.ts`

**Interfaces:**

- Consumes: `SqlDatabase`, `SqlStatement` (`./idempotency-statements.ts`); `AiDetectionUsageId` (`@magna-carta/identifiers/types`).
- Produces: `AI_DETECTION_USAGE_TABLE = "ai_detection_usage"`; `interface AiDetectionUsageInsert { id: AiDetectionUsageId; requestedBy: string; wordCount: number; mode: "realtime" | "bulk"; costMinor: number; adapterId: string; vendorVersion: string | null; resultBand: string | null; matterId: string | null; createdAt: string }`; `recordAiDetectionUsageStatement(db, row): SqlStatement`; `readAiDetectionUsage(db): Promise<AiDetectionUsageSummary>`.

**Reference — the metering idiom (`packages/data-access/src/token-usage-statements.ts`):** statements imported from `./idempotency-statements.ts`; one function returns a bound `SqlStatement`, one `read*` runs a `SELECT ... all<Row>()`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/data-access/test/ai-detection-usage-statements.test.ts
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { AiDetectionUsageId } from "@magna-carta/identifiers/types";
import { drizzle } from "drizzle-orm/node-sqlite"; // match the pattern used by sibling data-access tests
import {
  AI_DETECTION_USAGE_TABLE,
  readAiDetectionUsage,
  recordAiDetectionUsageStatement,
} from "../src/ai-detection-usage-statements.ts";

// NOTE: mirror the exact test harness a sibling statements test uses (e.g.
// packages/data-access/test/token-usage-statements.test.ts if present, else the setting-statements
// test) for constructing the SqlDatabase fake and creating the table. The assertions below are the
// contract; adapt the setup to that harness.

function makeDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE ${AI_DETECTION_USAGE_TABLE} (
    id TEXT PRIMARY KEY, requested_by TEXT NOT NULL, word_count INTEGER NOT NULL,
    mode TEXT NOT NULL, cost_minor INTEGER NOT NULL, adapter_id TEXT NOT NULL,
    vendor_version TEXT, result_band TEXT, matter_id TEXT, created_at TEXT NOT NULL)`);
  return drizzle(sqlite);
}

describe("ai_detection_usage statements", () => {
  it("records one row and reads it back in the summary", async () => {
    const db = makeDb();
    const statement = recordAiDetectionUsageStatement(db, {
      id: "aiDetectionUsage_test0000000000000" as AiDetectionUsageId,
      requestedBy: "user_x",
      wordCount: 1500,
      mode: "realtime",
      costMinor: 8,
      adapterId: "pangram",
      vendorVersion: "v3",
      resultBand: "likely",
      matterId: null,
      createdAt: "2026-07-02T00:00:00.000Z",
    });
    await statement.run();
    const summary = await readAiDetectionUsage(db);
    expect(summary.totalRequests).toBe(1);
    expect(summary.totalWords).toBe(1500);
    expect(summary.totalCostMinor).toBe(8);
  });
});
```

> If `packages/data-access` uses a specific in-memory `SqlDatabase` builder in its existing tests, use that instead of the raw `DatabaseSync`/`drizzle` sketch above — read `packages/data-access/test/setting-statements.test.ts` first and copy its harness. Keep the three assertions.

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @magna-carta/data-access test run ai-detection-usage`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the statements**

```typescript
// packages/data-access/src/ai-detection-usage-statements.ts
import type { AiDetectionUsageId } from "@magna-carta/identifiers/types";
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";

// Authoritative per-firm AI-text-detection usage: one row per successful detection. Word count is the
// billing-relevant unit (Pangram bills by words, not tokens); cost_minor is an indicative snapshot at
// the recorded rate, and a future billing decision reads word_count, not summed rounded cents. The
// matter_id column is the (currently unused) matter-action seam. Behavior over the table lives here;
// the structure lives in @magna-carta/database's per-firm schema.
export const AI_DETECTION_USAGE_TABLE = "ai_detection_usage";

export type AiDetectionUsageMode = "realtime" | "bulk";

export interface AiDetectionUsageInsert {
  readonly id: AiDetectionUsageId;
  readonly requestedBy: string;
  readonly wordCount: number;
  readonly mode: AiDetectionUsageMode;
  readonly costMinor: number;
  readonly adapterId: string;
  readonly vendorVersion: string | null;
  readonly resultBand: string | null;
  readonly matterId: string | null;
  readonly createdAt: string;
}

export function recordAiDetectionUsageStatement(
  database: SqlDatabase,
  row: AiDetectionUsageInsert,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${AI_DETECTION_USAGE_TABLE} (id, requested_by, word_count, mode, cost_minor, adapter_id, vendor_version, result_band, matter_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
    )
    .bind(
      row.id,
      row.requestedBy,
      row.wordCount,
      row.mode,
      row.costMinor,
      row.adapterId,
      row.vendorVersion,
      row.resultBand,
      row.matterId,
      row.createdAt,
    );
}

export interface AiDetectionUsageSummary {
  readonly totalRequests: number;
  readonly totalWords: number;
  readonly totalCostMinor: number;
}

export async function readAiDetectionUsage(
  database: SqlDatabase,
): Promise<AiDetectionUsageSummary> {
  const { results } = await database
    .prepare(
      `SELECT COUNT(*) AS requests, COALESCE(SUM(word_count), 0) AS words, COALESCE(SUM(cost_minor), 0) AS cost FROM ${AI_DETECTION_USAGE_TABLE}`,
    )
    .all<{ requests: number; words: number; cost: number }>();
  const row = results[0];
  return {
    totalRequests: row?.requests ?? 0,
    totalWords: row?.words ?? 0,
    totalCostMinor: row?.cost ?? 0,
  };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @magna-carta/data-access test run ai-detection-usage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/data-access/src/ai-detection-usage-statements.ts packages/data-access/test/ai-detection-usage-statements.test.ts
git commit -m "feat(data-access): ai_detection_usage metering statements"
```

---

## Task 6: Per-firm table + CREATE TABLE migration

**Files:**

- Modify: `packages/database/src/per-firm-schema.ts`
- Create (via drizzle-kit, then verify): `packages/database/drizzle/per-firm/0033_ai-detection-usage.sql`, `.../meta/0033_snapshot.json`, `.../meta/_journal.json` entry

**Interfaces:**

- Produces: the `ai_detection_usage` per-firm table (matches Task 5's DDL).

**Reference — a hand-authored table migration (`packages/database/drizzle/per-firm/0014_inference-token-usage.sql`)** and its schema (`per-firm-schema.ts` line 784, `tokenUsageMeter`).

- [ ] **Step 1: Add the table to the drizzle schema**

In `packages/database/src/per-firm-schema.ts`, add near `tokenUsageMeter` (import `AiDetectionUsageId` from `@magna-carta/identifiers/types` at the top if the file brands ids that way — check how `shipment` brands `ShipmentId`):

```typescript
// Authoritative per-firm AI-text-detection usage — one row per successful detection. Word count is the
// billing-relevant unit (the provider bills by words); cost_minor is an indicative snapshot. matter_id
// is the matter-action seam (nullable — Tools detection is matter-less today). Handle PK.
export const aiDetectionUsage = sqliteTable(
  "ai_detection_usage",
  {
    id: text("id").primaryKey().$type<AiDetectionUsageId>(),
    requestedBy: text("requested_by").notNull(),
    wordCount: integer("word_count").notNull(),
    mode: text("mode", { enum: ["realtime", "bulk"] }).notNull(),
    costMinor: integer("cost_minor").notNull(),
    adapterId: text("adapter_id").notNull(),
    vendorVersion: text("vendor_version"),
    resultBand: text("result_band"),
    matterId: text("matter_id").$type<MatterId>(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("ai_detection_usage_created_at_index").on(table.createdAt)],
);
```

> Match the imports already present in the file (`index`, `integer`, `text`, `MatterId`, etc.). Do NOT add a foreign key to `matter` — Tools detection is matter-less and the column is a forward seam; keep it a plain branded column like `shipment.matterRef` only if a FK is the file's convention, otherwise leave it unreferenced.

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @magna-carta/database run generate-per-firm-migrations`
Then inspect the newly created `drizzle/per-firm/00NN_*.sql`. Expected: a single `CREATE TABLE \`ai_detection_usage\`` (+ the one index), and NO other table rebuilds/drops.

- [ ] **Step 3: Reconcile the tag and slot**

The generator names files by index off the latest snapshot (0024) but the journal already runs to idx 32 with seed-only migrations that carry no snapshot. Confirm the generated journal entry lands at **idx 33 / tag `0033_...`**. If drizzle picked a random name, rename the `.sql` and its journal `tag` to `0033_ai-detection-usage` (and rename the snapshot to `0033_snapshot.json`) for readability, matching the hand-named style of `0014_inference-token-usage`. Ensure `meta/_journal.json` has exactly one new entry appended with `idx: 33`.

- [ ] **Step 4: Verify the migration chain applies**

Run: `pnpm --filter @magna-carta/database test run`
Expected: PASS — `generated-migrations.test.ts` loads the per-firm lineage cleanly, `schema-conformance` and `node-sqlite`/`per-firm-schema` tests accept the new table. If a test asserts a specific migration count or a "no spurious rebuild" invariant, confirm the new migration only adds the table.

- [ ] **Step 5: Commit**

```bash
git add packages/database/src/per-firm-schema.ts packages/database/drizzle/per-firm/0033_ai-detection-usage.sql packages/database/drizzle/per-firm/meta/0033_snapshot.json packages/database/drizzle/per-firm/meta/_journal.json
git commit -m "feat(database): per-firm ai_detection_usage table"
```

---

## Task 7: Role-permission seed migration

**Files:**

- Create: `packages/database/drizzle/per-firm/0034_seed-tools-ai-text-detection.sql`
- Modify: `packages/database/drizzle/per-firm/meta/_journal.json`
- Test: `packages/database/test/generated-migrations.test.ts` (add an assertion), `apps/worker/test/seed-tools-ai-text-detection.test.ts` (new)

**Reference — the seed pattern (`packages/database/drizzle/per-firm/0032_seed-tools-file-type-verifier.sql`):** five `INSERT INTO \`role*permission\``rows, one per default role, with freshly-minted`rolePermission*`handle literals. The five default role ids (committed literals from`0002_member-rbac.sql`): `role_Gw-zKO8hOHQuNv2bWokMp`(Owner/Admin),`role_gEyJ_YqL1_RI_yDqSa28Y`, `role_917LCQyRKP50Z9bW89vXl`, `role_hwwC1D98d8Lazc_asL6vO`, `role_WojF9F7kksBEftsmZGNhb`.

**Decision — grant breadth:** AI-text detection egresses privileged content to a third party, gated by a firm consent setting that defaults OFF. Unlike the everyday `tools:*` utilities (metadata, file-type) that seed onto ALL five roles, this tool is only usable once an admin opts the firm in. Seed it onto **all five default roles** (consistent with the sibling Tools utilities — the consent setting, not the permission, is the egress gate), OR restrict to Owner/Admin if the reviewer prefers a tighter default. **This plan seeds all five** for parity with the other Tools utilities; the consent setting is the meaningful control.

- [ ] **Step 1: Mint five fresh rolePermission handles**

Run: generate five identifiers. In a scratch node/vitest snippet or the repo's id CLI, call `newIdentifier("rolePermission")` five times, OR hand-write five unique `rolePermission_<21-char-nanoid>` literals in the same alphabet as existing seeds. They must be unique across all committed seeds.

- [ ] **Step 2: Write the seed SQL**

```sql
-- packages/database/drizzle/per-firm/0034_seed-tools-ai-text-detection.sql
-- Seed tools:aiTextDetection onto every default role, matching the other tools:* utilities. Unlike
-- those, this tool only egresses text once the firm opts in via the aiDetection.externalDetectionEnabled
-- setting (default off) — the consent setting is the egress gate, not the permission. The
-- rolePermission_ handles are minted once and committed as literals; the role_id values are the
-- default roles from the member-rbac seed.
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_AiTextDetect00000000001', 'role_Gw-zKO8hOHQuNv2bWokMp', 'tools:aiTextDetection');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_AiTextDetect00000000002', 'role_gEyJ_YqL1_RI_yDqSa28Y', 'tools:aiTextDetection');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_AiTextDetect00000000003', 'role_917LCQyRKP50Z9bW89vXl', 'tools:aiTextDetection');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_AiTextDetect00000000004', 'role_hwwC1D98d8Lazc_asL6vO', 'tools:aiTextDetection');--> statement-breakpoint
INSERT INTO `role_permission` (`id`, `role_id`, `permission`) VALUES ('rolePermission_AiTextDetect00000000005', 'role_WojF9F7kksBEftsmZGNhb', 'tools:aiTextDetection');
```

> Replace the placeholder handle literals with real ones from Step 1 that pass `isIdentifier(id, "rolePermission")` (the `generated-migrations.test` fitness function validates this). The alphabet is `[A-Za-z0-9_-]`; check `packages/identifiers/src/nanoid.ts` for length.

- [ ] **Step 3: Append the journal entry**

In `packages/database/drizzle/per-firm/meta/_journal.json`, append after the idx-33 entry (from Task 6):

```json
{
  "idx": 34,
  "version": "6",
  "when": 1782950000000,
  "tag": "0034_seed-tools-ai-text-detection",
  "breakpoints": true
}
```

> Seed-only migrations carry NO snapshot (see `0032`, `0020` — no `00NN_snapshot.json`). Do not create one.

- [ ] **Step 4: Add the seed assertion**

In `packages/database/test/generated-migrations.test.ts`, add a test mirroring the `0010 seeds tools:firmUsage` test:

```typescript
it("per-firm 0034 seeds tools:aiTextDetection onto all five default roles", async () => {
  const migrations = await loadLineage("per-firm");
  const migration = migrations.find((m) => m.tag === "0034_seed-tools-ai-text-detection");
  expect(migration, "0034 missing from the per-firm lineage").toBeDefined();
  const seeds = (migration?.statements ?? [])
    .filter((statement) => statement.includes("INSERT INTO `role_permission`"))
    .map(parseSingleRowInsert);
  expect(seeds).toHaveLength(5);
  for (const seed of seeds) {
    expect(seed.permission).toBe("tools:aiTextDetection");
    expect(isIdentifier(seed.id, "rolePermission"), String(seed.id)).toBe(true);
  }
});
```

- [ ] **Step 5: Run the database tests**

Run: `pnpm --filter @magna-carta/database test run`
Expected: PASS — including the seed-permission-registry fitness function (which requires `tools:aiTextDetection` to be registered; it already is).

- [ ] **Step 6: Commit**

```bash
git add packages/database/drizzle/per-firm/0034_seed-tools-ai-text-detection.sql packages/database/drizzle/per-firm/meta/_journal.json packages/database/test/generated-migrations.test.ts
git commit -m "feat(database): seed tools:aiTextDetection onto default roles"
```

---

## Task 8: Worker binding for the platform key

**Files:**

- Modify: `apps/worker/src/app.ts` (`Bindings`), `apps/worker/wrangler.jsonc`, `apps/worker/.dev.vars` (and the test var seam if separate)

**Interfaces:**

- Produces: `Bindings.PANGRAM_API_KEY?: string`, `Bindings.PANGRAM_BASE_URL?: string`.

- [ ] **Step 1: Add the binding fields**

In `apps/worker/src/app.ts` `Bindings` interface, add beside the other platform secrets (near `AI`, `AUTH_SECRET`):

```typescript
  // The platform-managed AI-text-detection provider key + base URL. Optional: absent in tests and
  // until the deploy-time secret is set, in which case the detection route wires the deferred adapter
  // (capability-unsupported). A platform secret, never a per-firm credential; production sets it with
  // `wrangler secret put PANGRAM_API_KEY`.
  PANGRAM_API_KEY?: string;
  PANGRAM_BASE_URL?: string;
```

- [ ] **Step 2: Declare the public base URL default (not the secret) in wrangler**

In `apps/worker/wrangler.jsonc` `vars`, add `"PANGRAM_BASE_URL": "https://text.api.pangram.com"` (confirm the real host from the Pangram call — a var, not a secret, so it is safe in config). The key itself is a `wrangler secret`, never committed. Add a placeholder to `apps/worker/.dev.vars` for local dev if that file is the local-secret seam: `PANGRAM_API_KEY=dev-placeholder`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @magna-carta/worker exec tsc --noEmit` (or `vp check` scoped to the worker)
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/app.ts apps/worker/wrangler.jsonc apps/worker/.dev.vars
git commit -m "feat(worker): PANGRAM_API_KEY / PANGRAM_BASE_URL bindings"
```

---

## Task 9: The detection route

**Files:**

- Create: `apps/worker/src/routes/files/ai-detection.ts`
- Modify: `apps/worker/src/app.ts` (import + register)
- Test: `apps/worker/test/ai-detection-route.test.ts`
- Regenerate: OpenAPI snapshot + generated client

**Interfaces:**

- Consumes: `createPangramAdapter` (`@magna-carta/ai-detection/adapters/pangram`), `deferredAiDetectionAdapter` (`@magna-carta/ai-detection/adapters/deferred`), `externalDetectionEnabledDefinition` (`@magna-carta/ai-detection/settings`); `readFirmSetting` (`@magna-carta/data-access/setting-statements`), `recordAiDetectionUsageStatement` (`@magna-carta/data-access/ai-detection-usage-statements`), `commitEffectBatch` (`@magna-carta/data-access/effect-batch`); `fetchHttpClient` (`@magna-carta/integrations/http`); `newIdentifier` (`@magna-carta/identifiers/generate`); the chokepoint helpers (`requireChokepointFirmContext`, `requireChokepointFirmId`, `requireChokepointUserId`), `defineOpenAPIRoute`, `chokepointMiddleware`, `problemJson`, `Problem`.
- Produces: `registerAiDetectionRoutes(app, chokepoint): void`; route `POST /api/v1/ai-detection/detect`.

**Reference — route shape:** `apps/worker/src/routes/files/file-type.ts` (chokepoint + `tools:*` permission + `problemJson` for engine-unavailable). **Reference — word count + metering write off the effect path:** the metering is a single-row insert; commit it via `commitEffectBatch(firm.firmDatabase, { statements: [recordAiDetectionUsageStatement(...)], outboxMessages: [] }, { now })` after the successful detection (not inside `runIdempotentEffect` — this route is idempotency: "optional" and does not need the effect ledger).

- [ ] **Step 1: Write the route**

```typescript
// apps/worker/src/routes/files/ai-detection.ts
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { deferredAiDetectionAdapter } from "@magna-carta/ai-detection/adapters/deferred";
import { createPangramAdapter } from "@magna-carta/ai-detection/adapters/pangram";
import { externalDetectionEnabledDefinition } from "@magna-carta/ai-detection/settings";
import { recordAiDetectionUsageStatement } from "@magna-carta/data-access/ai-detection-usage-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { readFirmSetting } from "@magna-carta/data-access/setting-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { fetchHttpClient } from "@magna-carta/integrations/http";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { Problem, problemJson } from "../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

// AI-Text Detection: send pasted text to the platform-managed detector and return a calibrated
// likelihood band (a signal, never a boolean verdict). Firm consent (default off) is enforced here —
// the single gate — before any provider call; privileged text never egresses on an implicit yes.
// Backend only; the UI lands with the design-system shell. Nothing is stored except the usage meter.

const REALTIME_RATE_MINOR_PER_1000_WORDS = 5; // indicative snapshot; word_count is the billing unit

const detectMeta: RouteMeta = {
  operationId: "aiDetection.detect",
  surface: "app",
  authenticated: true,
  permission: "tools:aiTextDetection",
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "expensive",
};

const DetectRequest = z
  .object({
    text: z.string().min(1),
    languageHint: z.string().optional(),
    matterId: z.string().optional(),
  })
  .openapi("AiDetectionDetectRequest");

const SegmentSchema = z.object({
  startCharacter: z.number(),
  endCharacter: z.number(),
  score: z.number(),
  band: z.enum(["unlikely", "mixed", "likely", "inconclusive"]),
});
const DetectResponse = z
  .object({
    band: z.enum(["unlikely", "mixed", "likely", "inconclusive"]),
    score: z.number(),
    reliability: z.enum(["high", "moderate", "low"]),
    caveats: z.array(z.string()),
    segments: z.array(SegmentSchema).optional(),
    provenance: z.object({
      adapterId: z.string(),
      vendorModel: z.string().optional(),
      vendorVersion: z.string().optional(),
      detectedAt: z.string(),
      egressedTo: z.string(),
    }),
  })
  .openapi("AiDetectionReport");

const detectRoute = defineOpenAPIRoute(detectMeta, {
  method: "post",
  path: "/api/v1/ai-detection/detect",
  description:
    "Estimate the likelihood that pasted text was machine-generated. Returns a coarse likelihood " +
    "band with an explicit reliability grade and the reasons to hesitate — a signal, not proof. " +
    "Requires the firm to have enabled external detection; text is sent to the configured provider " +
    "and is not retained. Nothing is stored except a usage meter entry.",
  request: {
    body: { content: { "application/json": { schema: DetectRequest } }, required: true },
  },
  responses: {
    200: {
      description: "The detection report",
      content: { "application/json": { schema: DetectResponse } },
    },
    401: {
      description: "No valid session",
      content: { "application/problem+json": { schema: Problem } },
    },
    403: {
      description: "The session member lacks tools:aiTextDetection",
      content: { "application/problem+json": { schema: Problem } },
    },
    422: {
      description: "External detection is disabled for this firm, or detection is unavailable",
      content: { "application/problem+json": { schema: Problem } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
    502: {
      description: "The detection provider rejected the request or is unavailable",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

function wordCount(text: string): number {
  return text.trim().split(/\s+/u).filter(Boolean).length;
}

export function registerAiDetectionRoutes(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    { ...detectRoute, middleware: chokepointMiddleware(chokepoint, detectRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const { text, languageHint, matterId } = c.req.valid("json");

      // Consent gate — the single enforcement point. Off (or unset) → refuse before any provider call.
      const enabled = await readFirmSetting(firm.firmDatabase, externalDetectionEnabledDefinition);
      if (!enabled) {
        return problemJson(c, {
          type: "validation",
          title: "External AI-text detection is disabled",
          status: 422,
          detail: "Enable external detection in firm settings before using this tool.",
        });
      }

      // Construct the adapter: platform key present → Pangram; absent → the deferred adapter, which
      // returns capability-unsupported so the route degrades honestly instead of calling a dead vendor.
      const apiKey = c.env.PANGRAM_API_KEY;
      const port =
        apiKey === undefined || apiKey === ""
          ? deferredAiDetectionAdapter.create({} as never)
          : createPangramAdapter({
              http: fetchHttpClient(),
              apiKey,
              baseUrl: c.env.PANGRAM_BASE_URL ?? "https://text.api.pangram.com",
              now: () => new Date().toISOString(),
            });

      const result = await port.detect({ text, languageHint, firmId: firm.firmId });
      if (!result.ok) {
        if (result.reason === "capability-unsupported") {
          return problemJson(c, {
            type: "validation",
            title: "Detection unavailable",
            status: 422,
            detail: "AI-text detection is not currently available.",
          });
        }
        return problemJson(c, {
          type: "conflict",
          title: "The detection provider is unavailable",
          status: 502,
        });
      }

      // Meter one row per successful detection (word count is the billing-relevant unit). Off the
      // response's critical correctness path but committed before returning so the record is durable.
      const words = wordCount(text);
      const now = () => new Date().toISOString();
      await commitEffectBatch(
        firm.firmDatabase,
        {
          statements: [
            recordAiDetectionUsageStatement(firm.firmDatabase, {
              id: newIdentifier("aiDetectionUsage"),
              requestedBy: userId,
              wordCount: words,
              mode: "realtime",
              costMinor: Math.round((words * REALTIME_RATE_MINOR_PER_1000_WORDS) / 1000),
              adapterId: result.value.provenance.adapterId,
              vendorVersion: result.value.provenance.vendorVersion ?? null,
              resultBand: result.value.band,
              matterId: matterId ?? null,
              createdAt: now(),
            }),
          ],
          outboxMessages: [],
        },
        { now },
      );

      return c.json(result.value, 200);
    },
  );
}
```

> Confirm `requireChokepointFirmContext(c)` exposes `firm.firmId` and `firm.firmDatabase` (it does in `conversions.ts`/`shipping.ts` — `firm.firmDatabase`, and `requireChokepointFirmId(c)` for the id; use whichever the accessor provides). Confirm `commitEffectBatch`'s signature against `shipping.ts` line 617. Adjust `deferredAiDetectionAdapter.create({} as never)` to the real `AdapterContext` shape if a no-arg/empty context is not accepted — simplest is to inline `async detect() { return capabilityUnsupported(); }` guard, or check for the key BEFORE calling and return the 422 directly when absent (cleaner — prefer that: if `apiKey` is empty, return the "Detection unavailable" 422 without constructing any adapter).

- [ ] **Step 2: Simplify the no-key path (recommended)**

Prefer this over constructing the deferred adapter: right after the consent gate, if `apiKey` is absent/empty, return the 422 "Detection unavailable" problem directly. Then the only adapter constructed is Pangram. This drops the `deferredAiDetectionAdapter` import from the route.

- [ ] **Step 3: Register the route**

In `apps/worker/src/app.ts`: add `import { registerAiDetectionRoutes } from "./routes/files/ai-detection.ts";` beside the other route imports, and `registerAiDetectionRoutes(app, chokepoint);` beside `registerFileTypeRoutes(app, chokepoint);` (~line 376).

- [ ] **Step 4: Write the integration test**

```typescript
// apps/worker/test/ai-detection-route.test.ts
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { createApp } from "../src/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

const OWNER_ADMIN_ROLE_ID = "role_Gw-zKO8hOHQuNv2bWokMp";
const app = createApp();
let poolFirmId: FirmId;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (
    await seedFirm({ name: "AI Detection Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
    .prepare("INSERT OR IGNORE INTO role_permission (id, role_id, permission) VALUES (?1, ?2, ?3)")
    .bind("rolePermission_AiDetectRouteTest00001", OWNER_ADMIN_ROLE_ID, "tools:aiTextDetection")
    .run();
});

async function authed(email: string): Promise<string> {
  const { userId } = await seedCredentialedUser(email, { userName: email, firmId: poolFirmId });
  await mirrorMemberWithOwnerRole(userId, email, poolFirmId);
  return signInForSessionCookie(email);
}

function post(cookie: string, body: unknown) {
  return app.request(
    "https://example.com/api/v1/ai-detection/detect",
    {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
  );
}

describe("POST /api/v1/ai-detection/detect", () => {
  it("refuses with 422 when the firm has not enabled external detection (default off)", async () => {
    const cookie = await authed("ai-detect-off@example.com");
    const response = await post(cookie, { text: "some pasted text" });
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("rejects without the permission with 403", async () => {
    await seedCredentialedUser("ai-detect-noperm@example.com", {
      userName: "No Perm",
      firmId: poolFirmId,
    });
    const cookie = await signInForSessionCookie("ai-detect-noperm@example.com");
    const response = await post(cookie, { text: "some pasted text" });
    expect(response.status).toBe(403);
  });

  it("returns 422 'unavailable' when enabled but no platform key is configured", async () => {
    // Enable the setting for this firm, then call. The test env sets no PANGRAM_API_KEY, so the route
    // reports detection-unavailable rather than calling a live provider.
    await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
      .prepare(
        "INSERT INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .bind("aiDetection.externalDetectionEnabled", "true", "2026-07-02T00:00:00.000Z")
      .run();
    const cookie = await authed("ai-detect-on@example.com");
    const response = await post(cookie, { text: "some pasted text" });
    expect(response.status).toBe(422);
  });
});
```

> If the Miniflare test env CAN inject `PANGRAM_API_KEY` + a stubbed fetch, add a happy-path test asserting a 200 with `band` present and one `ai_detection_usage` row. If the harness does not allow per-test fetch stubbing at the worker boundary, leave the happy path to the adapter unit tests (Task 2) and keep these three route-contract tests.

- [ ] **Step 5: Run the worker tests**

Run: `pnpm --filter @magna-carta/worker test run ai-detection-route`
Expected: PASS (3 tests).

- [ ] **Step 6: Regenerate the OpenAPI contract + client**

Run the repo's contract-generation command (check `apps/worker/package.json` / root scripts for the OpenAPI snapshot + Hey API client generator — e.g. `vp run openapi` or a `pnpm --filter ... generate` script). Then run the contract drift test.
Expected: the snapshot now includes `aiDetection.detect`; the drift test passes.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/routes/files/ai-detection.ts apps/worker/src/app.ts apps/worker/test/ai-detection-route.test.ts <regenerated-openapi-and-client-paths>
git commit -m "feat(worker): AI-text detection route (consent-gated, metered)"
```

---

## Task 10: Worker seed test + docs fragments

**Files:**

- Create: `apps/worker/test/seed-tools-ai-text-detection.test.ts` (mirror `seed-tools-metadata-scrubber.test.ts`)
- Create: `changelog.d/ai-detection-pangram.md`, `docs/decisions/pending/ai-detection-pangram-adapter.md`
- Modify: `STATUS.md` (this slice's row only)

- [ ] **Step 1: Write the seed integration test**

Read `apps/worker/test/seed-tools-metadata-scrubber.test.ts` and mirror it: after the per-firm migrations run, a fresh firm's default roles carry `tools:aiTextDetection`. Assert the permission resolves for a default-role member.

- [ ] **Step 2: Run it**

Run: `pnpm --filter @magna-carta/worker test run seed-tools-ai-text-detection`
Expected: PASS.

- [ ] **Step 3: Write the changelog fragment**

```markdown
<!-- changelog.d/ai-detection-pangram.md -->

### Added

- **AI-Text Detection (Pangram):** the AI-Text Detection tool now works end to end — paste text and
  get a calibrated likelihood band (a signal, not proof). Detection is platform-managed, off by
  default per firm (an admin enables it in settings before any text is sent to the provider), and
  metered per firm. Backend only; the interface arrives with the design-system shell.
```

- [ ] **Step 4: Write the ADR fragment**

```markdown
<!-- docs/decisions/pending/ai-detection-pangram-adapter.md -->

# Pangram first-vendor adapter for AI-Text Detection

**Status:** Accepted
**Date:** 2026-07-02

## Context

The vendor-agnostic AI-Text Detection core shipped with a deferred adapter. A concrete vendor was
needed to make the tool work. Detection is an arms race; an external, actively-maintained vendor beats
a static in-house model.

## Decision

Wire **Pangram** as the first vendor behind `AiTextDetectionPort`, **platform-managed**: the platform
holds one provider key (a Cloudflare secret, `credential: none`), exposes detection to all firms, and
meters per firm itself. Consent is a per-firm setting (`aiDetection.externalDetectionEnabled`, default
off) enforced at the API chokepoint. Usage is recorded in a dedicated per-firm `ai_detection_usage`
table (word-native — the provider bills by words). BYO-key is a deferred separate-adapter seam;
billing pass-through, document text-extraction, a bulk endpoint, and the UI are out of scope.

## Consequences

The heavy per-firm credentialed-adapter infrastructure is not built. The consent setting is the single
egress gate for privileged content. A future billing decision reads the usage table's word counts.
```

- [ ] **Step 5: Update STATUS.md**

Edit only this slice's row in `STATUS.md` to reflect the Pangram slice built/tested state. Run `vp run worktrees` first if touching any other shared line.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/test/seed-tools-ai-text-detection.test.ts changelog.d/ai-detection-pangram.md docs/decisions/pending/ai-detection-pangram-adapter.md STATUS.md
git commit -m "test(worker): tools:aiTextDetection seed + docs fragments"
```

---

## Task 11: Adversarial review + full quality gate

**Files:** none (verification + any fixes surfaced).

- [ ] **Step 1: Run the full gate**

Run: `pnpm check` (fmt + lint + TS typecheck + svelte-check) and `vp test` (unit + integration incl. the Miniflare worker test).
Expected: PASS. Fix anything that fails; commit fixes with a focused message.

- [ ] **Step 2: Run the process-ref + purity fitness functions explicitly**

Run: `pnpm run lint:process-refs` and `pnpm --filter @magna-carta/ai-detection test run purity`.
Expected: PASS — no `ADR-NNNN`/"slice N"/"spec §" in the new source; the pure package imports only allowlisted specifiers.

- [ ] **Step 3: 7-angle adversarial review**

Review the slice against these angles; record findings and fix material ones:

1. **Confidentiality/egress** — is text ever logged, echoed in a problem `detail`, or sent with `public_dashboard_link: true`? Does every report carry `egressedTo: "pangram"`? Is the consent gate un-bypassable (no adapter constructed when off)?
2. **Signal-not-proof integrity** — can any path return a directional band on low reliability? Confirm `normalize()` is the only framing path and `FATAL_CAVEATS` is intact.
3. **Tenancy** — is the metering write firm-scoped (per-firm DO)? Any cross-firm cache key? Is `firmId` carried, never a connection object?
4. **Boundary validation** — does a malformed/hostile Pangram response produce a validation problem, never a throw or a silently-dropped field?
5. **Failure mapping** — 5xx → 502, capability-unsupported/disabled → 422, missing permission → 403; no upstream body leaks into any problem.
6. **Metering correctness** — one row per successful detection; word count server-computed; no row on failure; `cost_minor` documented as indicative (word_count is the billing unit).
7. **Migration safety** — the CREATE TABLE adds only the table (no spurious rebuild); the seed registers a real handle for a registered permission; journal chain applies clean.

- [ ] **Step 4: Sync main and confirm no drift on shared files**

Run: `vp run worktrees` — confirm no other stream touched the migration slot / `app.ts` / `per-firm-schema.ts` since branch. If `main` advanced, merge it and re-run `vp test`. Reconcile the migration index if another migration claimed 0033/0034.

- [ ] **Step 5: Final commit (if fixes were made)**

```bash
git add -A
git commit -m "chore(ai-detection): adversarial-review fixes + gate green"
```

---

## Self-Review (plan author)

**Spec coverage:** §1 module placement → Tasks 1-9. §2 adapter (mapping table, request, response→RawDetection, error handling) → Tasks 1-2. §3 consent setting (chokepoint-enforced) → Tasks 3, 9. §4 metering table → Tasks 5-6, 9. §5 route → Task 9. §6 permission/role-seed → Task 7 (+ permission already registered). §7 out-of-scope seams → respected (no BYO-key, no billing, no extraction, no UI, no bulk, no type-level witness). §8 testing → per-task tests + Task 11. §9 build gotchas (migration slot, seed-union, contract regen) → Tasks 6, 7, 9, 11.

**Open confirmations (from the Pangram call, fold in when known):** exact REST endpoint path + auth header scheme (Task 2 uses `POST {baseUrl}/predict` + `x-api-key` — adjust if different); `windows` index unit char vs token (Task 2 maps 1:1 to characters — if token/word offsets, add a conversion or document the unit); the real base-URL host (Task 8); ZDR-as-default contractual (no code impact). These are configuration/mapping details isolated to Tasks 2 and 8 — a change is a small, localized edit, not a re-plan.

**Type consistency:** `AiDetectionUsageInsert` fields (Task 5) match the route's insert call (Task 9) and the table columns (Task 6). `createPangramAdapter(config)` signature (Task 2) matches the route's construction (Task 9). `externalDetectionEnabledDefinition` key/default consistent across Tasks 3 and 9.
