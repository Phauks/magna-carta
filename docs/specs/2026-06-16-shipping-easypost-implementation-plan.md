# Shipping & postage — Plan 1: `ShippingPort` + EasyPost adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure `@magna-carta/shipping` package (the `ShippingPort` + its canonical model) and a first-class **EasyPost adapter** behind the existing integration port system, plus the two framework seams the first credentialed adapter must land: the per-firm `integration_connection` repository and the `firm_secret`-backed `CredentialStore`.

**Architecture:** Hexagonal. `ShippingPort` is an interface in our own domain vocabulary; the EasyPost adapter implements it and maps EasyPost's HTTP payloads into zod-validated canonical records. The adapter takes an injected `HttpClient` so tests never hit the network. Credentials are API keys (not OAuth), so this adapter widens the framework credential union additively and skips the entire OAuth/refresh machinery. This is **Plan 1 of 2**; Plan 2 builds the shipment schema, services, worker routes, webhook ingress, and R2 label storage on top of this.

**Tech Stack:** TypeScript (ESM, `.ts` extension imports), zod (`catalog:`), Vitest, drizzle-orm (per-firm D1 schema), the built `@magna-carta/integrations` framework, `@magna-carta/identifiers`. Package manager: `pnpm` via `vp`.

**Spec:** `docs/specs/2026-06-16-shipping-easypost-design.md` (ADR-0094 subsystem + EasyPost choice; ADR-0095 API-key credential kind). **Build gate:** the `firm_secret`-backed `CredentialStore` (Task 13) gates on slice 1·2's `getSecret`/`putSecret`, which is in progress — it is built against that interface here and wired live in Plan 2's worker composition.

**Conventions that bind every task:**

- Spell names in full (`@magna-carta/shipping`, `newIdentifier`, `integrationConnection`) — golden rule 12. Storage-encoding suffixes (`amount_minor`) are the only allowed shorthand.
- Source, tests, and comments carry **no** process references (no `ADR-NNNN`, no "spec §N", no "slice 0·N"). State reasoning inline. A _forward-looking_ "wired in Plan 2 / when the firm_secret store lands" is allowed. Enforced by `pnpm run lint:process-refs` — golden rule 13.
- The API key is a secret: never `console.log`, `JSON.stringify` onto a log path, or splice an upstream response body into an error `detail` — golden rule 4.
- Run `pnpm check` (fmt + lint + typecheck) before every commit; it must be green.

---

## File Structure

**New package `packages/shipping/`:**

- `package.json`, `tsconfig.json`, `CLAUDE.md`
- `src/canonical.ts` — zod canonical schemas + inferred types + request-input types
- `src/port.ts` — the `ShippingPort` interface
- `src/easypost/http.ts` — the injected `HttpClient` seam
- `src/easypost/adapter.ts` — `createEasyPostAdapter` (descriptor + `create` + the bound port)
- `src/easypost/map.ts` — pure EasyPost-payload → canonical mapping + error classification
- `test/canonical.test.ts`, `test/adapter.test.ts`, `test/map.test.ts`

**Modified `packages/integrations/`:**

- `src/credentials.ts` — add `ApiKeyCredential` to the `Credential` union
- `src/port.ts` — add `{ kind: "apiKey"; scope }` to `CredentialRequirement`
- `test/credentials.test.ts` (or existing) — cover the new kind through `resolve`

**Modified `packages/identifiers/`:**

- `src/registry.ts` — add `integrationConnection` prefix
- `src/types.ts` — add `IntegrationConnectionId`

**Modified `packages/database/`:**

- `src/per-firm-schema.ts` — add the `integration_connection` table
- `drizzle/per-firm/0006_*.sql` — generated migration

**Modified `packages/data-access/`:**

- `src/integration-connection-statements.ts` — statement builders + row type
- `src/integration-connection-store.ts` — `ConnectionStore` impl + insert/update-status
- `src/firm-secret-credential-store.ts` — `CredentialStore` over the `firm_secret` interface
- `test/integration-connection-store.test.ts`, `test/firm-secret-credential-store.test.ts`

---

## Task 1: Extend the framework credential model with an API-key kind

**Files:**

- Modify: `packages/integrations/src/credentials.ts`
- Modify: `packages/integrations/src/port.ts`
- Test: `packages/integrations/test/credentials.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/integrations/test/credentials.test.ts
import { describe, expect, it } from "vitest";
import type { Credential } from "../src/credentials.ts";
import type { CredentialRequirement } from "../src/port.ts";

describe("api-key credential kind", () => {
  it("admits an apiKey credential into the Credential union", () => {
    const credential: Credential = { kind: "apiKey", apiKey: "ezk_test_123" };
    expect(credential.kind).toBe("apiKey");
  });

  it("admits an apiKey requirement carrying a scope", () => {
    const requirement: CredentialRequirement = { kind: "apiKey", scope: "firm" };
    expect(requirement).toEqual({ kind: "apiKey", scope: "firm" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/integrations exec vitest run test/credentials.test.ts`
Expected: FAIL — TypeScript error, `{ kind: "apiKey" }` not assignable to `Credential` / `CredentialRequirement`.

- [ ] **Step 3: Add `ApiKeyCredential` to the union**

In `packages/integrations/src/credentials.ts`, after the `OAuthCredential` interface and before `export type Credential`:

```typescript
export interface ApiKeyCredential {
  readonly kind: "apiKey";
  readonly apiKey: string;
}

export type Credential = OAuthCredential | ApiKeyCredential;
```

(Replace the existing `export type Credential = OAuthCredential;` line.)

- [ ] **Step 4: Add the `apiKey` requirement**

In `packages/integrations/src/port.ts`, extend the union:

```typescript
export type CredentialRequirement =
  | { readonly kind: "none" }
  | { readonly kind: "oauth"; readonly scope: AdapterScope }
  | { readonly kind: "apiKey"; readonly scope: AdapterScope };
```

The registry's `resolve` already branches on `kind === "none"` then reads `requirement.scope` for everything else — an apiKey requirement carries `scope`, so it needs no registry change.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @magna-carta/integrations exec vitest run` then `pnpm check`
Expected: PASS; full integrations suite still green (the existing resolve tests are unaffected).

- [ ] **Step 6: Commit**

```bash
git add packages/integrations/src/credentials.ts packages/integrations/src/port.ts packages/integrations/test/credentials.test.ts
git commit -m "feat(integrations): add api-key credential kind to the port model

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Scaffold the `@magna-carta/shipping` package

**Files:**

- Create: `packages/shipping/package.json`
- Create: `packages/shipping/tsconfig.json`
- Create: `packages/shipping/CLAUDE.md`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@magna-carta/shipping",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./port": "./src/port.ts",
    "./canonical": "./src/canonical.ts",
    "./easypost": "./src/easypost/adapter.ts",
    "./easypost/http": "./src/easypost/http.ts"
  },
  "scripts": {
    "test": "vp test run"
  },
  "dependencies": {
    "@magna-carta/integrations": "workspace:*",
    "@magna-carta/identifiers": "workspace:*",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@magna-carta/tsconfig": "workspace:*",
    "@types/node": "catalog:",
    "vitest": "catalog:"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../tsconfig/base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"],
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Create `CLAUDE.md`**

```markdown
# @magna-carta/shipping — local notes

The shipping & postage domain: the `ShippingPort` (our vocabulary — `validateAddress`,
`rateShipment`, `buyLabel`, `getTracking`, `refundLabel`) and the EasyPost adapter behind it.

- Pure package — no D1, no Hono, no `env`. The adapter takes an injected `HttpClient`; the worker
  backs it with `fetch`, tests with a fake.
- Certified mail / return receipt / signature / insurance are canonical `ShipmentOptions`, not
  operations — the adapter maps them to EasyPost `options`.
- Canonical records carry `remoteId` + opt-in `raw`, built with `canonicalRecordSchema` and validated
  at the boundary (EasyPost output is untrusted).
- The credential is an API key (`{ kind: "apiKey", scope: "firm" }`) — one postage account per firm.
  Never log it or splice an upstream body into an error detail.
```

- [ ] **Step 4: Install + verify the workspace picks up the package**

Run: `vp install`
Expected: completes; `@magna-carta/shipping` resolves as a workspace package (no error).

- [ ] **Step 5: Commit**

```bash
git add packages/shipping/package.json packages/shipping/tsconfig.json packages/shipping/CLAUDE.md
git commit -m "chore(shipping): scaffold @magna-carta/shipping package

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Register the `integrationConnection` identifier

**Files:**

- Modify: `packages/identifiers/src/registry.ts`
- Modify: `packages/identifiers/src/types.ts`
- Test: `packages/identifiers/test/generate.test.ts` (extend, or create a focused test)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/identifiers/test/integration-connection-id.test.ts
import { describe, expect, it } from "vitest";
import { newIdentifier } from "../src/generate.ts";

describe("integrationConnection identifier", () => {
  it("mints an integrationConnection_ handle", () => {
    const id = newIdentifier("integrationConnection");
    expect(id).toMatch(/^integrationConnection_[A-Za-z0-9_-]+$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/identifiers exec vitest run test/integration-connection-id.test.ts`
Expected: FAIL — `"integrationConnection"` not assignable to `EntityType`.

- [ ] **Step 3: Add the prefix**

In `packages/identifiers/src/registry.ts`, add one row to `ENTITY_PREFIXES` (keep alphabetical-ish grouping with the other infra entities):

```typescript
  integrationConnection: "integrationConnection",
```

- [ ] **Step 4: Add the type alias**

In `packages/identifiers/src/types.ts`, add:

```typescript
export type IntegrationConnectionId = Identifier<"integrationConnection">;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @magna-carta/identifiers exec vitest run` then `pnpm check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/identifiers/src/registry.ts packages/identifiers/src/types.ts packages/identifiers/test/integration-connection-id.test.ts
git commit -m "feat(identifiers): add integrationConnection handle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Define the canonical shipping model

**Files:**

- Create: `packages/shipping/src/canonical.ts`
- Test: `packages/shipping/test/canonical.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shipping/test/canonical.test.ts
import { describe, expect, it } from "vitest";
import { addressSchema, rateSchema, labelSchema } from "../src/canonical.ts";

describe("canonical shipping schemas", () => {
  it("accepts a well-formed address with remoteId", () => {
    const parsed = addressSchema.parse({
      remoteId: "adr_1",
      name: "Jane Roe",
      company: null,
      street1: "1 Main St",
      street2: null,
      city: "Reno",
      state: "NV",
      zip: "89501",
      country: "US",
      phone: null,
      residential: true,
      verified: true,
    });
    expect(parsed.city).toBe("Reno");
  });

  it("rejects a rate missing remoteId (boundary guard)", () => {
    expect(() =>
      rateSchema.parse({
        carrier: "USPS",
        service: "Priority",
        amountMinor: 745,
        currency: "USD",
        deliveryDays: 2,
        estDeliveryDate: null,
      }),
    ).toThrow();
  });

  it("rejects a label with a negative cost", () => {
    expect(() =>
      labelSchema.parse({
        remoteId: "shp_1",
        carrier: "USPS",
        service: "Priority",
        trackingCode: "9400...",
        labelUrl: "https://easypost.example/label.pdf",
        labelFormat: "PDF",
        costMinor: -1,
        currency: "USD",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/shipping exec vitest run test/canonical.test.ts`
Expected: FAIL — module `../src/canonical.ts` not found.

- [ ] **Step 3: Write the canonical schemas + input types**

```typescript
// packages/shipping/src/canonical.ts
import { z } from "zod";
import { canonicalRecordSchema } from "@magna-carta/integrations/canonical";

// Amounts are integer minor units (cents) + an ISO-4217 currency — no floats cross the boundary.
const moneyFields = {
  amountMinor: z.number().int().nonnegative(),
  currency: z.string().length(3),
};

export const addressSchema = canonicalRecordSchema({
  name: z.string(),
  company: z.string().nullable(),
  street1: z.string(),
  street2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  country: z.string(), // ISO-3166 alpha-2
  phone: z.string().nullable(),
  residential: z.boolean().nullable(),
  verified: z.boolean(),
});
export type CanonicalAddress = z.infer<typeof addressSchema>;

export const rateSchema = canonicalRecordSchema({
  carrier: z.string(),
  service: z.string(),
  ...moneyFields,
  deliveryDays: z.number().int().nullable(),
  estDeliveryDate: z.string().nullable(),
});
export type Rate = z.infer<typeof rateSchema>;

// remoteId is the EasyPost shipment id; buyLabel needs it plus a chosen rate's remoteId.
export const ratedShipmentSchema = canonicalRecordSchema({
  rates: z.array(rateSchema),
});
export type RatedShipment = z.infer<typeof ratedShipmentSchema>;

export const labelSchema = canonicalRecordSchema({
  carrier: z.string(),
  service: z.string(),
  trackingCode: z.string(),
  labelUrl: z.string(), // EasyPost's URL is transient; the worker copies the bytes to R2
  labelFormat: z.string(), // "PDF" | "ZPL" | "PNG"
  costMinor: z.number().int().nonnegative(),
  currency: z.string().length(3),
});
export type Label = z.infer<typeof labelSchema>;

export const trackingEventSchema = canonicalRecordSchema({
  status: z.string(),
  occurredAt: z.string().nullable(),
  location: z.string().nullable(),
  message: z.string().nullable(),
});
export type TrackingEvent = z.infer<typeof trackingEventSchema>;

export const refundResultSchema = canonicalRecordSchema({
  status: z.string(), // "submitted" | "refunded" | "rejected"
});
export type RefundResult = z.infer<typeof refundResultSchema>;

// --- Request inputs (our shapes; not canonical records) ---

export interface AddressInput {
  readonly name: string;
  readonly company?: string | null;
  readonly street1: string;
  readonly street2?: string | null;
  readonly city: string;
  readonly state: string;
  readonly zip: string;
  readonly country: string;
  readonly phone?: string | null;
}

export interface ParcelInput {
  readonly lengthIn?: number;
  readonly widthIn?: number;
  readonly heightIn?: number;
  readonly weightOz: number;
  readonly predefinedPackage?: string | null;
}

export interface ShipmentOptions {
  readonly certifiedMail?: boolean;
  readonly returnReceipt?: "none" | "electronic" | "physical";
  readonly signatureConfirmation?: "none" | "signature" | "adult";
  readonly insuranceAmountMinor?: number | null;
}

export interface RateRequest {
  readonly from: AddressInput;
  readonly to: AddressInput;
  readonly parcel: ParcelInput;
  readonly options?: ShipmentOptions;
}

export interface BuyLabelRequest {
  readonly remoteShipmentId: string;
  readonly remoteRateId: string;
  readonly labelFormat?: "PDF" | "ZPL" | "PNG";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @magna-carta/shipping exec vitest run test/canonical.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shipping/src/canonical.ts packages/shipping/test/canonical.test.ts
git commit -m "feat(shipping): canonical address/rate/label/tracking model + request inputs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Define the `ShippingPort` interface

**Files:**

- Create: `packages/shipping/src/port.ts`
- Test: covered by the adapter tests (Task 8) — no standalone test for a bare interface.

- [ ] **Step 1: Write the interface**

```typescript
// packages/shipping/src/port.ts
import type { Dispatch } from "@magna-carta/integrations/dispatch";
import type {
  AddressInput,
  BuyLabelRequest,
  CanonicalAddress,
  Label,
  RateRequest,
  RatedShipment,
  RefundResult,
  TrackingEvent,
} from "./canonical.ts";

// Named in our vocabulary, not EasyPost's. Every method returns a typed Dispatch so an adapter
// maps a vendor error into a first-class `adapter-error` rather than throwing.
export interface ShippingPort {
  validateAddress(input: AddressInput): Promise<Dispatch<CanonicalAddress>>;
  rateShipment(input: RateRequest): Promise<Dispatch<RatedShipment>>;
  buyLabel(input: BuyLabelRequest): Promise<Dispatch<Label>>;
  getTracking(trackingCode: string): Promise<Dispatch<readonly TrackingEvent[]>>;
  refundLabel(remoteShipmentId: string): Promise<Dispatch<RefundResult>>;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm check`
Expected: PASS — the interface compiles against the canonical types.

- [ ] **Step 3: Commit**

```bash
git add packages/shipping/src/port.ts
git commit -m "feat(shipping): ShippingPort interface

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: The injected `HttpClient` seam

**Files:**

- Create: `packages/shipping/src/easypost/http.ts`

- [ ] **Step 1: Write the seam**

```typescript
// packages/shipping/src/easypost/http.ts
// The adapter's only outbound surface. The worker backs this with global fetch; tests pass a fake.
// Keeping it tiny (no Request/Response objects) makes adapter tests trivial and keeps the package
// free of any runtime dependency.
export interface HttpRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface HttpResponse {
  readonly status: number;
  json(): Promise<unknown>;
}

export interface HttpClient {
  request(input: HttpRequest): Promise<HttpResponse>;
}

// A fetch-backed client for the worker to inject. Lives here so every consumer builds it the same way.
export function fetchHttpClient(fetchImpl: typeof fetch = fetch): HttpClient {
  return {
    async request(input) {
      const response = await fetchImpl(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
      });
      return { status: response.status, json: () => response.json() };
    },
  };
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm check`
Expected: PASS.

```bash
git add packages/shipping/src/easypost/http.ts
git commit -m "feat(shipping): HttpClient seam for the EasyPost adapter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: EasyPost payload mapping + error classification (pure)

> **Build note (golden rule 11):** before writing the mapping, open the current EasyPost API docs (`https://docs.easypost.com`) and confirm the live field names for Shipment / Rate / PostageLabel / Tracker / Address-verification and the `options` keys (`certified_mail`, `return_receipt`, `delivery_confirmation`). The shapes below match the documented v2 API; adjust if the docs have moved. This is a verification step, not a guess to ship blind.

**Files:**

- Create: `packages/shipping/src/easypost/map.ts`
- Test: `packages/shipping/test/map.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shipping/test/map.test.ts
import { describe, expect, it } from "vitest";
import {
  classifyError,
  mapLabel,
  mapRatedShipment,
  mapShipmentOptions,
} from "../src/easypost/map.ts";

describe("EasyPost mapping", () => {
  it("maps a shipment payload to canonical rates (dollars → minor units)", () => {
    const result = mapRatedShipment({
      id: "shp_abc",
      rates: [
        {
          id: "rate_1",
          carrier: "USPS",
          service: "Priority",
          rate: "7.45",
          currency: "USD",
          delivery_days: 2,
          est_delivery_date: "2026-06-18",
        },
      ],
    });
    expect(result.remoteId).toBe("shp_abc");
    expect(result.rates[0]).toMatchObject({
      remoteId: "rate_1",
      carrier: "USPS",
      amountMinor: 745,
      currency: "USD",
      deliveryDays: 2,
    });
  });

  it("maps a bought shipment to a canonical label", () => {
    const label = mapLabel({
      id: "shp_abc",
      tracking_code: "9400111",
      selected_rate: { carrier: "USPS", service: "Priority", rate: "7.45", currency: "USD" },
      postage_label: { label_url: "https://ep.example/l.pdf", label_file_type: "application/pdf" },
    });
    expect(label).toMatchObject({
      remoteId: "shp_abc",
      trackingCode: "9400111",
      costMinor: 745,
      labelFormat: "application/pdf",
    });
  });

  it("maps certified mail + electronic return receipt to EasyPost options", () => {
    expect(mapShipmentOptions({ certifiedMail: true, returnReceipt: "electronic" })).toEqual({
      certified_mail: true,
      return_receipt: "electronic",
    });
  });

  it("classifies a 401 as a terminal auth problem", () => {
    const problem = classifyError(401, "Unauthorized");
    expect(problem).toMatchObject({ category: "auth", retryable: false, status: 401 });
  });

  it("classifies a 429 as a retryable rate-limit problem", () => {
    expect(classifyError(429, "Too Many Requests")).toMatchObject({
      category: "rate_limit",
      retryable: true,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/shipping exec vitest run test/map.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the mapping module**

```typescript
// packages/shipping/src/easypost/map.ts
import { integrationProblem, type IntegrationProblem } from "@magna-carta/integrations/problem";
import type {
  CanonicalAddress,
  Label,
  RatedShipment,
  RefundResult,
  ShipmentOptions,
  TrackingEvent,
} from "../canonical.ts";

// EasyPost returns money as a decimal-dollar string ("7.45"). Convert to integer minor units without
// float drift: parse the two sides of the decimal point.
export function dollarsToMinor(amount: string): number {
  const [whole, frac = ""] = amount.trim().split(".");
  const cents = `${frac}00`.slice(0, 2);
  const sign = whole.startsWith("-") ? -1 : 1;
  const wholeMinor = Math.abs(Number.parseInt(whole, 10)) * 100;
  return sign * (wholeMinor + Number.parseInt(cents, 10));
}

interface EpRate {
  id: string;
  carrier: string;
  service: string;
  rate: string;
  currency: string;
  delivery_days?: number | null;
  est_delivery_date?: string | null;
}

interface EpShipment {
  id: string;
  rates?: EpRate[];
  tracking_code?: string;
  selected_rate?: { carrier: string; service: string; rate: string; currency: string };
  postage_label?: { label_url: string; label_file_type?: string };
}

export function mapRatedShipment(shipment: EpShipment): RatedShipment {
  return {
    remoteId: shipment.id,
    raw: shipment,
    rates: (shipment.rates ?? []).map((rate) => ({
      remoteId: rate.id,
      carrier: rate.carrier,
      service: rate.service,
      amountMinor: dollarsToMinor(rate.rate),
      currency: rate.currency,
      deliveryDays: rate.delivery_days ?? null,
      estDeliveryDate: rate.est_delivery_date ?? null,
    })),
  };
}

export function mapLabel(shipment: EpShipment): Label {
  const selected = shipment.selected_rate;
  if (
    selected === undefined ||
    shipment.postage_label === undefined ||
    shipment.tracking_code === undefined
  ) {
    throw new Error("EasyPost shipment is not in a bought state");
  }
  return {
    remoteId: shipment.id,
    raw: shipment,
    carrier: selected.carrier,
    service: selected.service,
    trackingCode: shipment.tracking_code,
    labelUrl: shipment.postage_label.label_url,
    labelFormat: shipment.postage_label.label_file_type ?? "application/pdf",
    costMinor: dollarsToMinor(selected.rate),
    currency: selected.currency,
  };
}

interface EpAddress {
  id: string;
  name?: string | null;
  company?: string | null;
  street1: string;
  street2?: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string | null;
  residential?: boolean | null;
  verifications?: { delivery?: { success: boolean } };
}

export function mapAddress(address: EpAddress): CanonicalAddress {
  return {
    remoteId: address.id,
    raw: address,
    name: address.name ?? "",
    company: address.company ?? null,
    street1: address.street1,
    street2: address.street2 ?? null,
    city: address.city,
    state: address.state,
    zip: address.zip,
    country: address.country,
    phone: address.phone ?? null,
    residential: address.residential ?? null,
    verified: address.verifications?.delivery?.success === true,
  };
}

interface EpTracker {
  tracking_details?: {
    status?: string;
    datetime?: string | null;
    message?: string | null;
    tracking_location?: { city?: string | null; state?: string | null } | null;
  }[];
}

export function mapTrackingEvents(tracker: EpTracker): TrackingEvent[] {
  return (tracker.tracking_details ?? []).map((detail, index) => ({
    remoteId: `${detail.status ?? "event"}:${detail.datetime ?? index}`,
    raw: detail,
    status: detail.status ?? "unknown",
    occurredAt: detail.datetime ?? null,
    location: locationOf(detail.tracking_location),
    message: detail.message ?? null,
  }));
}

function locationOf(
  loc: { city?: string | null; state?: string | null } | null | undefined,
): string | null {
  if (loc === null || loc === undefined) return null;
  const parts = [loc.city, loc.state].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

export function mapRefund(shipment: { id: string; refund_status?: string }): RefundResult {
  return { remoteId: shipment.id, raw: shipment, status: shipment.refund_status ?? "submitted" };
}

// Certified mail / return receipt / signature / insurance → EasyPost `options`. Only emit keys the
// caller actually set, so an unset option never overrides an EasyPost default.
export function mapShipmentOptions(options: ShipmentOptions | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (options === undefined) return out;
  if (options.certifiedMail) out.certified_mail = true;
  if (options.returnReceipt && options.returnReceipt !== "none")
    out.return_receipt = options.returnReceipt;
  if (options.signatureConfirmation && options.signatureConfirmation !== "none") {
    out.delivery_confirmation =
      options.signatureConfirmation === "adult" ? "ADULT_SIGNATURE" : "SIGNATURE";
  }
  return out;
}

// HTTP status → the one integration taxonomy. Title is caller-safe; the upstream body is never spliced
// into detail (it can echo auth headers / tokens).
export function classifyError(status: number, title: string): IntegrationProblem {
  if (status === 401 || status === 403) return integrationProblem("auth", status, title);
  if (status === 429) return integrationProblem("rate_limit", status, title);
  if (status >= 400 && status < 500) return integrationProblem("validation", status, title);
  return integrationProblem("upstream", status, title);
}

export function networkProblem(): IntegrationProblem {
  return integrationProblem("network", 0, "EasyPost request failed");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @magna-carta/shipping exec vitest run test/map.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shipping/src/easypost/map.ts packages/shipping/test/map.test.ts
git commit -m "feat(shipping): EasyPost payload mapping + error classification

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: The EasyPost adapter

**Files:**

- Create: `packages/shipping/src/easypost/adapter.ts`
- Test: `packages/shipping/test/adapter.test.ts`

- [ ] **Step 1: Write the failing test (a fake HttpClient drives the adapter)**

```typescript
// packages/shipping/test/adapter.test.ts
import { describe, expect, it } from "vitest";
import type { HttpClient, HttpRequest } from "../src/easypost/http.ts";
import { createEasyPostAdapter } from "../src/easypost/adapter.ts";
import type { ShippingPort } from "../src/port.ts";

function fakeHttp(handler: (req: HttpRequest) => { status: number; body: unknown }): HttpClient {
  return {
    async request(req) {
      const { status, body } = handler(req);
      return { status, json: async () => body };
    },
  };
}

const ADDRESS = {
  name: "Jane",
  street1: "1 Main St",
  city: "Reno",
  state: "NV",
  zip: "89501",
  country: "US",
};

function portWith(http: HttpClient): ShippingPort {
  return createEasyPostAdapter({ http }).create({
    credential: { kind: "apiKey", apiKey: "ezk_test" },
  });
}

describe("EasyPost adapter", () => {
  it("declares a firm-scoped api-key descriptor with all operations", () => {
    const descriptor = createEasyPostAdapter({
      http: fakeHttp(() => ({ status: 200, body: {} })),
    }).descriptor;
    expect(descriptor.adapterId).toBe("easypost");
    expect(descriptor.category).toBe("shipping");
    expect(descriptor.credential).toEqual({ kind: "apiKey", scope: "firm" });
    expect(descriptor.operations.buyLabel.supported).toBe(true);
  });

  it("rateShipment posts a shipment and returns canonical rates", async () => {
    let seen: HttpRequest | undefined;
    const port = portWith(
      fakeHttp((req) => {
        seen = req;
        return {
          status: 201,
          body: {
            id: "shp_1",
            rates: [
              { id: "rate_1", carrier: "USPS", service: "Priority", rate: "7.45", currency: "USD" },
            ],
          },
        };
      }),
    );
    const result = await port.rateShipment({
      from: ADDRESS,
      to: ADDRESS,
      parcel: { weightOz: 10 },
      options: { certifiedMail: true },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rates[0].amountMinor).toBe(745);
    expect(seen?.headers.Authorization).toMatch(/^Basic /);
    expect(seen?.url).toContain("/shipments");
    expect(JSON.parse(seen?.body ?? "{}").shipment.options).toEqual({ certified_mail: true });
  });

  it("maps a 401 into a typed adapter-error, not a throw", async () => {
    const port = portWith(
      fakeHttp(() => ({ status: 401, body: { error: { message: "bad key" } } })),
    );
    const result = await port.rateShipment({
      from: ADDRESS,
      to: ADDRESS,
      parcel: { weightOz: 10 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("adapter-error");
      expect(result.problem?.category).toBe("auth");
    }
  });

  it("buyLabel posts the chosen rate and returns a canonical label", async () => {
    const port = portWith(
      fakeHttp(() => ({
        status: 200,
        body: {
          id: "shp_1",
          tracking_code: "9400",
          selected_rate: { carrier: "USPS", service: "Priority", rate: "7.45", currency: "USD" },
          postage_label: { label_url: "https://ep/l.pdf", label_file_type: "application/pdf" },
        },
      })),
    );
    const result = await port.buyLabel({ remoteShipmentId: "shp_1", remoteRateId: "rate_1" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.trackingCode).toBe("9400");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/shipping exec vitest run test/adapter.test.ts`
Expected: FAIL — module `../src/easypost/adapter.ts` not found.

- [ ] **Step 3: Write the adapter**

```typescript
// packages/shipping/src/easypost/adapter.ts
import { adapterError, ok, type Dispatch } from "@magna-carta/integrations/dispatch";
import type { Adapter, AdapterContext, CapabilityDescriptor } from "@magna-carta/integrations/port";
import type {
  BuyLabelRequest,
  CanonicalAddress,
  Label,
  RateRequest,
  RatedShipment,
  RefundResult,
  AddressInput,
  TrackingEvent,
} from "../canonical.ts";
import type { ShippingPort } from "../port.ts";
import type { HttpClient } from "./http.ts";
import {
  classifyError,
  mapAddress,
  mapLabel,
  mapRatedShipment,
  mapRefund,
  mapShipmentOptions,
  mapTrackingEvents,
  networkProblem,
} from "./map.ts";

const DEFAULT_BASE_URL = "https://api.easypost.com/v2";

const descriptor: CapabilityDescriptor = {
  adapterId: "easypost",
  category: "shipping",
  credential: { kind: "apiKey", scope: "firm" },
  operations: {
    validateAddress: { supported: true },
    rateShipment: { supported: true },
    buyLabel: { supported: true },
    getTracking: { supported: true },
    refundLabel: { supported: true },
  },
  passthroughAvailable: true,
};

export interface EasyPostAdapterDeps {
  readonly http: HttpClient;
  readonly baseUrl?: string;
}

export function createEasyPostAdapter(deps: EasyPostAdapterDeps): Adapter<ShippingPort> {
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  return {
    descriptor,
    create(context: AdapterContext): ShippingPort {
      const credential = context.credential;
      if (credential === undefined || credential.kind !== "apiKey") {
        throw new Error("EasyPost adapter requires an apiKey credential");
      }
      // EasyPost uses HTTP Basic auth with the API key as the username and an empty password.
      const authHeader = `Basic ${btoa(`${credential.apiKey}:`)}`;
      const headers = { Authorization: authHeader, "Content-Type": "application/json" };

      async function call<T>(
        method: "GET" | "POST",
        path: string,
        body: unknown,
        map: (json: unknown) => T,
      ): Promise<Dispatch<T>> {
        let response;
        try {
          response = await deps.http.request({
            method,
            url: `${baseUrl}${path}`,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
          });
        } catch {
          return adapterError(networkProblem());
        }
        if (response.status >= 400) {
          // Title is the status family — never the upstream body (it can echo the auth header).
          return adapterError(
            classifyError(response.status, `EasyPost responded ${response.status}`),
          );
        }
        const json = await response.json();
        return ok(map(json));
      }

      function epAddress(input: AddressInput) {
        return {
          name: input.name,
          company: input.company ?? undefined,
          street1: input.street1,
          street2: input.street2 ?? undefined,
          city: input.city,
          state: input.state,
          zip: input.zip,
          country: input.country,
          phone: input.phone ?? undefined,
        };
      }

      return {
        validateAddress(input) {
          return call(
            "POST",
            "/addresses",
            { address: epAddress(input), verify: ["delivery"] },
            (json) => mapAddress(json as never) as CanonicalAddress,
          );
        },
        rateShipment(input: RateRequest) {
          const shipment = {
            to_address: epAddress(input.to),
            from_address: epAddress(input.from),
            parcel: {
              length: input.parcel.lengthIn,
              width: input.parcel.widthIn,
              height: input.parcel.heightIn,
              weight: input.parcel.weightOz,
              predefined_package: input.parcel.predefinedPackage ?? undefined,
            },
            options: mapShipmentOptions(input.options),
          };
          return call(
            "POST",
            "/shipments",
            { shipment },
            (json) => mapRatedShipment(json as never) as RatedShipment,
          );
        },
        buyLabel(input: BuyLabelRequest) {
          const body = {
            rate: { id: input.remoteRateId },
            label_format: input.labelFormat ?? "PDF",
          };
          return call(
            "POST",
            `/shipments/${input.remoteShipmentId}/buy`,
            body,
            (json) => mapLabel(json as never) as Label,
          );
        },
        getTracking(trackingCode: string) {
          return call(
            "GET",
            `/trackers?tracking_code=${encodeURIComponent(trackingCode)}`,
            undefined,
            (json) => {
              const trackers = (json as { trackers?: unknown[] }).trackers ?? [json];
              return mapTrackingEvents(trackers[0] as never) as TrackingEvent[];
            },
          );
        },
        refundLabel(remoteShipmentId: string) {
          return call(
            "POST",
            `/shipments/${remoteShipmentId}/refund`,
            {},
            (json) => mapRefund(json as never) as RefundResult,
          );
        },
      };
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @magna-carta/shipping exec vitest run` then `pnpm check`
Expected: PASS (all shipping tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shipping/src/easypost/adapter.ts packages/shipping/test/adapter.test.ts
git commit -m "feat(shipping): EasyPost adapter behind ShippingPort

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: The `integration_connection` per-firm table + migration

**Files:**

- Modify: `packages/database/src/per-firm-schema.ts`
- Generated: `packages/database/drizzle/per-firm/0006_*.sql`
- Test: `packages/database/test/per-firm-schema.test.ts` (extend if a table-presence test exists; otherwise the migration round-trips in Task 12's repo test)

- [ ] **Step 1: Add the table definition**

In `packages/database/src/per-firm-schema.ts`, near the other infra tables, add (import `IntegrationConnectionId` from `@magna-carta/identifiers/types` at the top with the other id types):

```typescript
// One authorized external account per category (the grant). Firm-scoped today (shipping); the unique
// index keys it on (category, principal) so a firm has exactly one connection per category.
// `credential_ref` points at the firm_secret entry; `capability_snapshot` is the adapter descriptor
// captured at connect time.
export const integrationConnection = sqliteTable(
  "integration_connection",
  {
    id: text("id").primaryKey().$type<IntegrationConnectionId>(),
    category: text("category").notNull(),
    adapterId: text("adapter_id").notNull(),
    scope: text("scope", { enum: ["firm", "user"] }).notNull(),
    principalRef: text("principal_ref").notNull(),
    credentialRef: text("credential_ref").notNull(),
    status: text("status", {
      enum: ["connected", "degraded", "needs_reauth", "disabled"],
    })
      .notNull()
      .default("connected"),
    capabilitySnapshot: text("capability_snapshot").notNull(), // JSON-serialized CapabilityDescriptor
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("integration_connection_principal_category_unique_index").on(
      table.category,
      table.principalRef,
    ),
  ],
);
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @magna-carta/database run generate-per-firm-migrations`
Expected: a new `drizzle/per-firm/0006_*.sql` containing `CREATE TABLE \`integration_connection\`` with the columns + the unique index above.

- [ ] **Step 3: Verify the generated SQL**

Open the generated file and confirm it matches (column names, defaults, the unique index). Expected `CREATE TABLE` shape:

```sql
CREATE TABLE `integration_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`adapter_id` text NOT NULL,
	`scope` text NOT NULL,
	`principal_ref` text NOT NULL,
	`credential_ref` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`capability_snapshot` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_connection_principal_category_unique_index` ON `integration_connection` (`category`,`principal_ref`);
```

- [ ] **Step 4: Commit**

```bash
git add packages/database/src/per-firm-schema.ts packages/database/drizzle/per-firm/
git commit -m "feat(database): integration_connection per-firm table

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Connection statement builders

**Files:**

- Create: `packages/data-access/src/integration-connection-statements.ts`

- [ ] **Step 1: Write the statement builders**

```typescript
// packages/data-access/src/integration-connection-statements.ts
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";
import type { IntegrationConnectionId } from "@magna-carta/identifiers/types";

export const INTEGRATION_CONNECTION_TABLE = "integration_connection";

export interface InsertConnectionRow {
  readonly id: IntegrationConnectionId;
  readonly category: string;
  readonly adapterId: string;
  readonly scope: "firm" | "user";
  readonly principalRef: string;
  readonly credentialRef: string;
  readonly capabilitySnapshot: string; // JSON
  readonly createdAt: string;
}

export function insertConnectionStatement(
  database: SqlDatabase,
  row: InsertConnectionRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${INTEGRATION_CONNECTION_TABLE} (id, category, adapter_id, scope, principal_ref, credential_ref, status, capability_snapshot, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'connected', ?7, ?8, ?8)`,
    )
    .bind(
      row.id,
      row.category,
      row.adapterId,
      row.scope,
      row.principalRef,
      row.credentialRef,
      row.capabilitySnapshot,
      row.createdAt,
    );
}

export function selectConnectionStatement(
  database: SqlDatabase,
  category: string,
  principalRef: string,
): SqlStatement {
  return database
    .prepare(
      `SELECT id, category, adapter_id, scope, principal_ref, credential_ref, status, capability_snapshot FROM ${INTEGRATION_CONNECTION_TABLE} WHERE category = ?1 AND principal_ref = ?2`,
    )
    .bind(category, principalRef);
}

export function updateConnectionStatusStatement(
  database: SqlDatabase,
  id: IntegrationConnectionId,
  status: string,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${INTEGRATION_CONNECTION_TABLE} SET status = ?2, updated_at = ?3 WHERE id = ?1`,
    )
    .bind(id, status, updatedAt);
}

export function deleteConnectionStatement(
  database: SqlDatabase,
  id: IntegrationConnectionId,
): SqlStatement {
  return database.prepare(`DELETE FROM ${INTEGRATION_CONNECTION_TABLE} WHERE id = ?1`).bind(id);
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm check`
Expected: PASS.

```bash
git add packages/data-access/src/integration-connection-statements.ts
git commit -m "feat(data-access): integration_connection statement builders

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: The `ConnectionStore` repository

**Files:**

- Create: `packages/data-access/src/integration-connection-store.ts`
- Test: `packages/data-access/test/integration-connection-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/data-access/test/integration-connection-store.test.ts
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { describe, expect, it } from "vitest";
import { createConnectionStore } from "../src/integration-connection-store.ts";
import { insertConnectionStatement } from "../src/integration-connection-statements.ts";

const SNAPSHOT = JSON.stringify({
  adapterId: "easypost",
  category: "shipping",
  credential: { kind: "apiKey", scope: "firm" },
  operations: {},
  passthroughAvailable: true,
});

describe("ConnectionStore.getConnection", () => {
  it("returns a connected firm-scoped connection by (category, principal)", async () => {
    const database = createMigratedNodeDatabase("per-firm").database;
    await insertConnectionStatement(database, {
      id: newIdentifier("integrationConnection"),
      category: "shipping",
      adapterId: "easypost",
      scope: "firm",
      principalRef: "firm_1",
      credentialRef: "secret_ref_1",
      capabilitySnapshot: SNAPSHOT,
      createdAt: "2026-06-16T00:00:00.000Z",
    }).run();

    const store = createConnectionStore(database);
    const connection = await store.getConnection({ firmId: "firm_1", category: "shipping" });
    expect(connection).not.toBeNull();
    expect(connection?.credentialRef).toBe("secret_ref_1");
    expect(connection?.capabilitySnapshot.adapterId).toBe("easypost");
  });

  it("returns null when no connection exists for the principal", async () => {
    const database = createMigratedNodeDatabase("per-firm").database;
    const store = createConnectionStore(database);
    expect(await store.getConnection({ firmId: "firm_404", category: "shipping" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/data-access exec vitest run test/integration-connection-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the store**

```typescript
// packages/data-access/src/integration-connection-store.ts
import type { CapabilityDescriptor } from "@magna-carta/integrations/port";
import type {
  ConnectionLookup,
  ConnectionStore,
  IntegrationConnection,
} from "@magna-carta/integrations/connection";
import type { SqlDatabase } from "./idempotency-statements.ts";
import { selectConnectionStatement } from "./integration-connection-statements.ts";

interface ConnectionRow {
  id: string;
  category: string;
  adapter_id: string;
  scope: "firm" | "user";
  principal_ref: string;
  credential_ref: string;
  status: IntegrationConnection["status"];
  capability_snapshot: string;
}

// Firm-scoped: the database handed in IS the firm's D1, so isolation is structural — a lookup can only
// ever read this firm's connections. The principal is the user for user-scoped ports, else the firm.
export function createConnectionStore(database: SqlDatabase): ConnectionStore {
  return {
    async getConnection(lookup: ConnectionLookup): Promise<IntegrationConnection | null> {
      const principalRef = lookup.userId ?? lookup.firmId;
      const { results } = await selectConnectionStatement(
        database,
        lookup.category,
        principalRef,
      ).all<ConnectionRow>();
      const row = results[0];
      if (row === undefined) return null;
      return {
        id: row.id,
        category: row.category,
        adapterId: row.adapter_id,
        scope: row.scope,
        principalRef: row.principal_ref,
        credentialRef: row.credential_ref,
        status: row.status,
        capabilitySnapshot: JSON.parse(row.capability_snapshot) as CapabilityDescriptor,
      };
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @magna-carta/data-access exec vitest run test/integration-connection-store.test.ts`
Expected: PASS (2 tests).

> If `.all<ConnectionRow>()` is not the exact generic form used elsewhere in data-access, match the codebase's existing `.all()` row-typing convention (check `cursor-pagination.ts` or a sibling statement consumer) and adjust — keep the behavior identical.

- [ ] **Step 5: Commit**

```bash
git add packages/data-access/src/integration-connection-store.ts packages/data-access/test/integration-connection-store.test.ts
git commit -m "feat(data-access): firm-scoped ConnectionStore over integration_connection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: The `firm_secret`-backed `CredentialStore` (gated on slice 1·2)

> **Gate:** the real backing is slice 1·2's `firm_secret` store (`getSecret`/`putSecret`), in progress. This task builds the `CredentialStore` against that interface and tests it with an in-memory fake, so it compiles and is fully unit-tested now; the worker passes the real store in Plan 2 once 1·2 lands.

**Files:**

- Create: `packages/data-access/src/firm-secret-credential-store.ts`
- Test: `packages/data-access/test/firm-secret-credential-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/data-access/test/firm-secret-credential-store.test.ts
import { describe, expect, it } from "vitest";
import {
  createFirmSecretCredentialStore,
  type SecretStore,
} from "../src/firm-secret-credential-store.ts";

function memorySecretStore(): SecretStore {
  const map = new Map<string, string>();
  return {
    getSecret: async (ref) => map.get(ref) ?? null,
    putSecret: async (ref, value) => void map.set(ref, value),
  };
}

describe("firm_secret-backed CredentialStore", () => {
  it("round-trips an api-key credential through the secret store", async () => {
    const store = createFirmSecretCredentialStore(memorySecretStore());
    await store.put("cred_ref_1", { kind: "apiKey", apiKey: "ezk_live_xyz" });
    const loaded = await store.get("cred_ref_1");
    expect(loaded).toEqual({ kind: "apiKey", apiKey: "ezk_live_xyz" });
  });

  it("returns null for an unknown ref", async () => {
    const store = createFirmSecretCredentialStore(memorySecretStore());
    expect(await store.get("missing")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @magna-carta/data-access exec vitest run test/firm-secret-credential-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the store**

```typescript
// packages/data-access/src/firm-secret-credential-store.ts
import type { Credential, CredentialStore } from "@magna-carta/integrations/credentials";

// The slice-1·2 per-firm secret store interface. A Credential is JSON-serialized into one secret
// entry (envelope-encrypted at rest by that store). This module never logs the value.
export interface SecretStore {
  getSecret(ref: string): Promise<string | null>;
  putSecret(ref: string, value: string): Promise<void>;
}

export function createFirmSecretCredentialStore(secrets: SecretStore): CredentialStore {
  return {
    async get(credentialRef: string): Promise<Credential | null> {
      const serialized = await secrets.getSecret(credentialRef);
      if (serialized === null) return null;
      return JSON.parse(serialized) as Credential;
    },
    async put(credentialRef: string, credential: Credential): Promise<void> {
      await secrets.putSecret(credentialRef, JSON.stringify(credential));
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @magna-carta/data-access exec vitest run test/firm-secret-credential-store.test.ts` then `pnpm check`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/data-access/src/firm-secret-credential-store.ts packages/data-access/test/firm-secret-credential-store.test.ts
git commit -m "feat(data-access): firm_secret-backed CredentialStore seam

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: End-to-end registry resolution test (the whole spine)

Proves the built pieces compose: a seeded connection + credential resolve through the framework registry to a working EasyPost port, with `capability-unsupported` and `not-connected` as first-class outcomes.

**Files:**

- Test: `packages/shipping/test/registry-resolution.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// packages/shipping/test/registry-resolution.test.ts
import type { ConnectionStore } from "@magna-carta/integrations/connection";
import type { Credential, CredentialStore } from "@magna-carta/integrations/credentials";
import { createIntegrationRegistry, requireCapability } from "@magna-carta/integrations/registry";
import { describe, expect, it } from "vitest";
import { createEasyPostAdapter } from "../src/easypost/adapter.ts";
import type { HttpClient } from "../src/easypost/http.ts";
import type { ShippingPort } from "../src/port.ts";

const http: HttpClient = {
  async request() {
    return {
      status: 201,
      json: async () => ({
        id: "shp_1",
        rates: [
          { id: "rate_1", carrier: "USPS", service: "Priority", rate: "7.45", currency: "USD" },
        ],
      }),
    };
  },
};

const descriptor = createEasyPostAdapter({ http }).descriptor;

const connectionStore: ConnectionStore = {
  async getConnection(lookup) {
    if (lookup.category !== "shipping") return null;
    return {
      id: "integrationConnection_1",
      category: "shipping",
      adapterId: "easypost",
      scope: "firm",
      principalRef: lookup.firmId,
      credentialRef: "ref_1",
      status: "connected",
      capabilitySnapshot: descriptor,
    };
  },
};

const credentialStore: CredentialStore = {
  async get(): Promise<Credential | null> {
    return { kind: "apiKey", apiKey: "ezk_test" };
  },
  async put() {},
};

describe("registry resolution of the shipping adapter", () => {
  it("resolves a connected firm to a working ShippingPort", async () => {
    const registry = createIntegrationRegistry({ connectionStore, credentialStore });
    registry.register(createEasyPostAdapter({ http }));
    const resolved = await registry.resolve<ShippingPort>("shipping", { firmId: "firm_1" });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      const rated = await resolved.value.port.rateShipment({
        from: { name: "a", street1: "1", city: "c", state: "NV", zip: "1", country: "US" },
        to: { name: "b", street1: "2", city: "d", state: "NV", zip: "2", country: "US" },
        parcel: { weightOz: 8 },
      });
      expect(rated.ok).toBe(true);
    }
  });

  it("returns not-connected for a firm with no connection", async () => {
    const empty: ConnectionStore = {
      async getConnection() {
        return null;
      },
    };
    const registry = createIntegrationRegistry({ connectionStore: empty, credentialStore });
    registry.register(createEasyPostAdapter({ http }));
    const resolved = await registry.resolve<ShippingPort>("shipping", { firmId: "firm_x" });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.reason).toBe("not-connected");
  });

  it("gates an unsupported operation name via the descriptor", async () => {
    const registry = createIntegrationRegistry({ connectionStore, credentialStore });
    registry.register(createEasyPostAdapter({ http }));
    const resolved = await registry.resolve<ShippingPort>("shipping", { firmId: "firm_1" });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      const gate = requireCapability(resolved.value, "schedulePickup");
      expect(gate.ok).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @magna-carta/shipping exec vitest run test/registry-resolution.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add packages/shipping/test/registry-resolution.test.ts
git commit -m "test(shipping): registry resolves EasyPost adapter end-to-end

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Fitness — adapter not imported by core; descriptor present; key never logged

**Files:**

- Test: `packages/shipping/test/fitness.test.ts`

- [ ] **Step 1: Write the fitness tests**

```typescript
// packages/shipping/test/fitness.test.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEasyPostAdapter } from "../src/easypost/adapter.ts";
import type { HttpClient } from "../src/easypost/http.ts";

const http: HttpClient = {
  async request() {
    return { status: 200, json: async () => ({}) };
  },
};

describe("shipping fitness", () => {
  it("the adapter ships a descriptor with a category and a credential requirement", () => {
    const { descriptor } = createEasyPostAdapter({ http });
    expect(descriptor.category).toBe("shipping");
    expect(descriptor.credential.kind).toBe("apiKey");
  });

  it("the port module does not import any easypost adapter (dependency-inversion guard)", () => {
    const portSource = readFileSync(
      fileURLToPath(new URL("../src/port.ts", import.meta.url)),
      "utf8",
    );
    expect(portSource).not.toMatch(/easypost/i);
  });

  it("the adapter never writes the credential to a console/log surface", () => {
    const adapterSource = readFileSync(
      fileURLToPath(new URL("../src/easypost/adapter.ts", import.meta.url)),
      "utf8",
    );
    expect(adapterSource).not.toMatch(/console\./);
    expect(adapterSource).not.toMatch(/JSON\.stringify\([^)]*credential/);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter @magna-carta/shipping exec vitest run test/fitness.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add packages/shipping/test/fitness.test.ts
git commit -m "test(shipping): fitness guards (dependency inversion, no secret logging)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Documentation + status

**Files:**

- Modify: `docs/Decision-Log.md` (ADR-0094, ADR-0095)
- Modify: `STATUS.md` (Cross-cutting table: correct the integration-port row to built; add a shipping row)
- Modify: `ROADMAP.md` (Phase 7 / cross-cutting: shipping in progress)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Record the ADRs**

In `docs/Decision-Log.md`, add ADR-0094 (shipping & postage subsystem + EasyPost as the first credentialed adapter — Pirate Ship rejected for no API + no certified mail; EasyPost Forge child-user centralized billing) and ADR-0095 (API-key credential kind added to the integration credential model; amends ADR-0091/0092). Follow the existing ADR entry format in that file.

- [ ] **Step 2: Update STATUS / ROADMAP / CHANGELOG**

- `STATUS.md`: correct the **Integration port system** row (it is built, not `[ ]`). Add a **Shipping & postage (Plan 1)** row: Spec `[x]`, Plan `[x]`, Built `[~]`.
- `ROADMAP.md`: note shipping (EasyPost) as in-progress under the integrations work.
- `CHANGELOG.md`: an entry for the `@magna-carta/shipping` package + EasyPost adapter + the API-key credential kind + the `integration_connection` repository.

- [ ] **Step 3: Final full gate**

Run: `pnpm check && pnpm --filter @magna-carta/shipping exec vitest run && pnpm --filter @magna-carta/data-access exec vitest run && pnpm --filter @magna-carta/integrations exec vitest run && pnpm run lint:process-refs`
Expected: all green; `lint:process-refs` reports no process references in source/tests.

- [ ] **Step 4: Commit**

```bash
git add docs/Decision-Log.md STATUS.md ROADMAP.md CHANGELOG.md
git commit -m "docs(shipping): record ADR-0094/0095, status, changelog for Plan 1

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (Plan 1 portion of the design):**

- §1 module placement — `@magna-carta/shipping` (Tasks 2,4–8), `integrations` extension (Task 1), data-access seams (Tasks 10–12), database table (Task 9). ✓
- §2 `ShippingPort` + adapter — operations (Task 5), canonical model + options-as-data (Task 4), descriptor firm-scoped api-key (Task 8), error taxonomy mapping (Task 7), first-credentialed-adapter seams: connection repo (Tasks 9–11) + `firm_secret` `CredentialStore` (Task 12). ✓
- §6 cross-cutting — money as `amountMinor` (Task 4), secret-never-logged (Tasks 8,14). ✓
- §7 testing — canonical/zod boundary (Task 4), descriptor honesty + dependency inversion (Task 14), adapter mapping incl. certified mail (Tasks 7–8), error categories (Task 7), connection tenant isolation (Task 11), end-to-end resolve (Task 13). ✓
- **Out of Plan 1 (→ Plan 2):** shipment/label/tracking tables + service, all worker routes (connection-management, shipments, rates, purchase, label, tracking, refund), the EasyPost webhook ingress, R2 label storage, the load-profile extension, and the live `firm_secret` wiring. Piece C (service fee + cost recovery) stays a Phase 3 seam.

**Placeholder scan:** none — every code step carries full source. Task 7 and Task 9 contain _verification_ steps (confirm EasyPost field names against live docs; confirm generated SQL) — these are required checks, not deferred work.

**Type consistency:** `Credential`/`ApiKeyCredential` (Task 1) used in Tasks 8,12,13. `ShippingPort` (Task 5) returns the canonical types (Task 4) and is used in Tasks 8,13,14. `ConnectionStore`/`IntegrationConnection`/`ConnectionLookup` from the framework (`connection.ts`) implemented in Task 11, consumed in Task 13. `IntegrationConnectionId` (Task 3) used in Tasks 9,10. `createEasyPostAdapter({ http })` signature identical across Tasks 8,13,14. `RatedShipment.remoteId` = EasyPost shipment id, consumed by `BuyLabelRequest.remoteShipmentId` — consistent (Tasks 4,7,8).

---

## Plan 2 (next, separate document)

The shipping vertical-slice backend: `shipment` / `shipment_label` / `tracking_event` tables; the shipment statement builders + service (draft → rate-record → purchase → tracking-append → refund) returning `EffectWrite`; the worker composition (register the adapter; back the `CredentialStore` with the live `firm_secret` store once slice 1·2 lands; build `fetchHttpClient`); the routes through the 0·5 chokepoint (connection-management, `POST /v1/shipments`, `…/rates`, idempotent `…/purchase` with R2 label copy, `GET …/label`, `…/tracking`, `…/refund`); the HMAC-verified `POST /v1/webhooks/easypost` tracking ingress; the Miniflare e2e; and the load-profile extension (shipments-per-matter + tracking-event volume). Piece C (configurable service fee + matter-disbursement cost recovery) is designed in the spec and built with the Phase 3 financial core.
