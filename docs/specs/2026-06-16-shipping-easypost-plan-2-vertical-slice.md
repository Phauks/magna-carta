# Shipping & postage — Plan 2: vertical-slice backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shipping vertical-slice backend on top of Plan 1's `ShippingPort` + EasyPost adapter — per-firm shipment/label/tracking tables, the shipment service, the worker connection-management + shipment routes through the 0·5 chokepoint, R2 label storage, the Miniflare end-to-end, and the load-profile extension.

**Architecture:** A firm creates a draft shipment (addresses + parcel + options stored as JSON text), rate-shops live via the resolved EasyPost port, buys a label (idempotent; the label PDF is copied from EasyPost's transient URL into per-firm R2), and tracks it. The integration registry is built per request from the firm's D1 (`ConnectionStore`) and a `firm_secret`-backed `CredentialStore` injected through a worker seam. Tracking is **pull-based** (the route calls EasyPost on demand and caches events) — adequate at firm mailing volume; push-webhook ingress is a captured follow-up (Task 13), not built here.

**Tech Stack:** TypeScript (ESM, `.ts` imports), zod, Hono + `@hono/zod-openapi`, drizzle-orm (per-firm D1), Vitest + `cloudflare:test` (Miniflare), R2. Builds on `@magna-carta/shipping`, `@magna-carta/integrations`, `@magna-carta/data-access`.

**Spec:** `docs/specs/2026-06-16-shipping-easypost-design.md`. **Depends on:** Plan 1 (merged). **Gate:** the live `firm_secret` `CredentialStore` backing is slice 1·2 (in progress) — wired through an injectable worker seam (Task 5) so tests run now with a fake; production swaps in the real store when 1·2 lands. Piece **C** (service fee + matter-disbursement cost recovery) stays a Phase 3 seam: the cost columns ship here (Task 2), the posting hook is built with the financial core.

**Conventions (bind every task):** full names (golden rule 12); no process references in source/tests, forward-looking "when 1·2 lands" allowed (golden rule 13, `pnpm run lint:process-refs`); the API key is a secret — never logged/serialized onto an observable path (golden rule 4); bulk bytes to R2, never D1 (golden rule 3); `pnpm check` green before every commit.

---

## File Structure

**Modified `packages/identifiers/`:** `src/registry.ts` (+3 prefixes), `src/types.ts` (+3 ids).
**Modified `packages/database/`:** `src/per-firm-schema.ts` (+3 tables), generated `drizzle/per-firm/0007_*.sql`.
**Modified `packages/shipping/`:** `src/canonical.ts` (+ optional `idempotencyKey` on `BuyLabelRequest`), `src/easypost/adapter.ts` (send `Idempotency-Key`).
**New `packages/data-access/`:** `src/shipment-statements.ts`, `src/shipment-service.ts`; tests `test/shipment-service.test.ts`.
**New `apps/worker/`:** `src/shipping/secret-store.ts` (the `firm_secret` `CredentialStore` seam + injection), `src/shipping/registry.ts` (per-request registry builder), `src/http/routes/communications/shipping.ts` (connection + shipment routes); test `test/shipping-e2e.test.ts`.
**Modified `apps/worker/`:** `src/http/app.ts` (register routes + thread shipping deps), `src/access-control` registry (a `shipping:manage` permission — follow the existing permission-registry pattern).
**Modified `packages/fixtures/`:** `src/load-profile/shipping-measurements.ts` + generation hook + smoke list.

---

## Task 1: Add shipment identifiers

**Files:** Modify `packages/identifiers/src/registry.ts`, `packages/identifiers/src/types.ts`. Test: `packages/identifiers/test/shipment-ids.test.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/identifiers/test/shipment-ids.test.ts
import { describe, expect, it } from "vitest";
import { newIdentifier } from "../src/generate.ts";

describe("shipment identifiers", () => {
  it.each(["shipment", "shipmentLabel", "trackingEvent"] as const)("mints a %s handle", (type) => {
    expect(newIdentifier(type)).toMatch(new RegExp(`^${type}_[A-Za-z0-9_-]+$`));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @magna-carta/identifiers exec vitest run test/shipment-ids.test.ts`
Expected: FAIL — types not in `EntityType`.

- [ ] **Step 3: Add the prefixes**

In `packages/identifiers/src/registry.ts`, add to `ENTITY_PREFIXES`:

```typescript
  shipment: "shipment",
  shipmentLabel: "shipmentLabel",
  trackingEvent: "trackingEvent",
```

- [ ] **Step 4: Add the type aliases**

In `packages/identifiers/src/types.ts`:

```typescript
export type ShipmentId = Identifier<"shipment">;
export type ShipmentLabelId = Identifier<"shipmentLabel">;
export type TrackingEventId = Identifier<"trackingEvent">;
```

- [ ] **Step 5: Run + commit**

Run: `pnpm --filter @magna-carta/identifiers exec vitest run && pnpm check`
Expected: PASS.

```bash
git add packages/identifiers/src/registry.ts packages/identifiers/src/types.ts packages/identifiers/test/shipment-ids.test.ts
git commit -m "feat(identifiers): add shipment/shipmentLabel/trackingEvent handles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Per-firm shipment / label / tracking tables + migration

**Files:** Modify `packages/database/src/per-firm-schema.ts`. Generated `drizzle/per-firm/0007_*.sql`.

- [ ] **Step 1: Add the table definitions**

In `packages/database/src/per-firm-schema.ts` add (import `ShipmentId`, `ShipmentLabelId`, `TrackingEventId`, `MatterId` from `@magna-carta/identifiers/types` with the other id types). Addresses/parcel/options are stored as JSON text — never queried by sub-field; cost columns carry the Phase-3 cost-recovery seam:

```typescript
// A mailing/postage shipment. Addresses, parcel, and options are JSON text (never sub-queried).
// postage_cost_minor / service_fee_minor are recorded at purchase — the cost-recovery seam the
// Phase-3 financial core reads to post a matter disbursement. matter_ref is optional (a shipment may
// be firm-administrative, not matter-linked).
export const shipment = sqliteTable(
  "shipment",
  {
    id: text("id").primaryKey().$type<ShipmentId>(),
    matterRef: text("matter_ref")
      .$type<MatterId>()
      .references(() => matter.id),
    status: text("status", {
      enum: ["draft", "rated", "purchased", "in_transit", "delivered", "refunded"],
    })
      .notNull()
      .default("draft"),
    fromAddress: text("from_address").notNull(), // JSON
    toAddress: text("to_address").notNull(), // JSON
    parcel: text("parcel").notNull(), // JSON
    options: text("options").notNull().default("{}"), // JSON ShipmentOptions
    remoteShipmentId: text("remote_shipment_id"), // EasyPost shipment id, set once rated/bought
    carrier: text("carrier"),
    service: text("service"),
    trackingCode: text("tracking_code"),
    labelRef: text("label_ref").$type<ShipmentLabelId>(),
    postageCostMinor: integer("postage_cost_minor"),
    serviceFeeMinor: integer("service_fee_minor"),
    currency: text("currency"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("shipment_matter_ref_index").on(table.matterRef),
    index("shipment_tracking_code_index").on(table.trackingCode),
  ],
);

// A bought label's metadata; the PDF bytes live in per-firm R2 at r2_key (golden rule 3).
export const shipmentLabel = sqliteTable("shipment_label", {
  id: text("id").primaryKey().$type<ShipmentLabelId>(),
  shipmentRef: text("shipment_ref")
    .notNull()
    .$type<ShipmentId>()
    .references(() => shipment.id),
  format: text("format").notNull(), // content type, e.g. application/pdf
  r2Key: text("r2_key").notNull(),
  trackingCode: text("tracking_code").notNull(),
  costMinor: integer("cost_minor").notNull(),
  currency: text("currency").notNull(),
  voided: integer("voided").notNull().default(0), // 0/1
  createdAt: text("created_at").notNull(),
});

// A carrier tracking event, appended as tracking is pulled. Dedup by (shipment_ref, remote_id).
export const trackingEvent = sqliteTable(
  "tracking_event",
  {
    id: text("id").primaryKey().$type<TrackingEventId>(),
    shipmentRef: text("shipment_ref")
      .notNull()
      .$type<ShipmentId>()
      .references(() => shipment.id),
    remoteId: text("remote_id").notNull(),
    status: text("status").notNull(),
    occurredAt: text("occurred_at"),
    location: text("location"),
    message: text("message"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("tracking_event_shipment_remote_unique_index").on(
      table.shipmentRef,
      table.remoteId,
    ),
  ],
);
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @magna-carta/database run generate-per-firm-migrations`
Expected: `drizzle/per-firm/0007_*.sql` with the three `CREATE TABLE`s + their indexes.

- [ ] **Step 3: Verify the generated SQL** (open the file; confirm `shipment`, `shipment_label`, `tracking_event` + the `tracking_event_shipment_remote_unique_index`).

- [ ] **Step 4: Commit**

```bash
git add packages/database/src/per-firm-schema.ts packages/database/drizzle/per-firm/
git commit -m "feat(database): shipment, shipment_label, tracking_event per-firm tables

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Add an idempotency key to `buyLabel`

So a retried purchase never double-charges EasyPost. Additive optional field on Plan 1's `BuyLabelRequest`.

**Files:** Modify `packages/shipping/src/canonical.ts`, `packages/shipping/src/easypost/adapter.ts`. Test: extend `packages/shipping/test/adapter.test.ts`.

- [ ] **Step 1: Write the failing test (append to adapter.test.ts)**

```typescript
it("buyLabel sends an Idempotency-Key header when given a key", async () => {
  let seen: { headers: Record<string, string> } | undefined;
  const port = createEasyPostAdapter({
    http: {
      async request(req) {
        seen = { headers: { ...req.headers } };
        return {
          status: 200,
          json: async () => ({
            id: "shp_1",
            tracking_code: "9400",
            selected_rate: { carrier: "USPS", service: "Priority", rate: "7.45", currency: "USD" },
            postage_label: { label_url: "https://ep/l.pdf", label_file_type: "application/pdf" },
          }),
        };
      },
    },
  }).create({ credential: { kind: "apiKey", apiKey: "ezk_test" } });
  await port.buyLabel({
    remoteShipmentId: "shp_1",
    remoteRateId: "rate_1",
    idempotencyKey: "key-123",
  });
  expect(seen?.headers["Idempotency-Key"]).toBe("key-123");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @magna-carta/shipping exec vitest run test/adapter.test.ts`
Expected: FAIL — `idempotencyKey` not on `BuyLabelRequest` / header absent.

- [ ] **Step 3: Add the field**

In `packages/shipping/src/canonical.ts`, extend `BuyLabelRequest`:

```typescript
export interface BuyLabelRequest {
  readonly remoteShipmentId: string;
  readonly remoteRateId: string;
  readonly labelFormat?: "PDF" | "ZPL" | "PNG";
  readonly idempotencyKey?: string;
}
```

- [ ] **Step 4: Send the header**

In `packages/shipping/src/easypost/adapter.ts`, the `call` helper takes fixed `headers`. Add a per-call header override. Change the `call` signature and the `buyLabel` body:

```typescript
async function call<T>(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  map: (json: unknown) => T,
  extraHeaders: Record<string, string> = {},
): Promise<Dispatch<T>> {
  let response;
  try {
    response = await deps.http.request({
      method,
      url: `${baseUrl}${path}`,
      headers: { ...headers, ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return adapterError(networkProblem());
  }
  if (response.status >= 400) {
    return adapterError(classifyError(response.status, `EasyPost responded ${response.status}`));
  }
  const json = await response.json();
  return ok(map(json));
}
```

And `buyLabel`:

```typescript
        buyLabel(input: BuyLabelRequest) {
          const body = { rate: { id: input.remoteRateId }, label_format: input.labelFormat ?? "PDF" };
          const extra = input.idempotencyKey === undefined ? {} : { "Idempotency-Key": input.idempotencyKey };
          return call("POST", `/shipments/${input.remoteShipmentId}/buy`, body, (json) => mapLabel(json as never) as Label, extra);
        },
```

- [ ] **Step 5: Run + commit**

Run: `pnpm --filter @magna-carta/shipping exec vitest run && pnpm check`
Expected: PASS.

```bash
git add packages/shipping/src/canonical.ts packages/shipping/src/easypost/adapter.ts packages/shipping/test/adapter.test.ts
git commit -m "feat(shipping): buyLabel idempotency key (EasyPost Idempotency-Key header)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Shipment statement builders

**Files:** Create `packages/data-access/src/shipment-statements.ts`.

- [ ] **Step 1: Write the builders**

```typescript
// packages/data-access/src/shipment-statements.ts
import type { SqlDatabase, SqlStatement } from "./idempotency-statements.ts";
import type {
  ShipmentId,
  ShipmentLabelId,
  TrackingEventId,
  MatterId,
} from "@magna-carta/identifiers/types";

export const SHIPMENT_TABLE = "shipment";
export const SHIPMENT_LABEL_TABLE = "shipment_label";
export const TRACKING_EVENT_TABLE = "tracking_event";

export interface InsertShipmentRow {
  readonly id: ShipmentId;
  readonly matterRef: MatterId | null;
  readonly fromAddress: string; // JSON
  readonly toAddress: string; // JSON
  readonly parcel: string; // JSON
  readonly options: string; // JSON
  readonly createdAt: string;
}

export function insertShipmentDraftStatement(
  database: SqlDatabase,
  row: InsertShipmentRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${SHIPMENT_TABLE} (id, matter_ref, status, from_address, to_address, parcel, options, created_at, updated_at) VALUES (?1, ?2, 'draft', ?3, ?4, ?5, ?6, ?7, ?7)`,
    )
    .bind(
      row.id,
      row.matterRef,
      row.fromAddress,
      row.toAddress,
      row.parcel,
      row.options,
      row.createdAt,
    );
}

export function selectShipmentStatement(database: SqlDatabase, id: ShipmentId): SqlStatement {
  return database
    .prepare(
      `SELECT id, matter_ref, status, from_address, to_address, parcel, options, remote_shipment_id, carrier, service, tracking_code, label_ref, postage_cost_minor, service_fee_minor, currency FROM ${SHIPMENT_TABLE} WHERE id = ?1`,
    )
    .bind(id);
}

export interface PurchaseUpdate {
  readonly remoteShipmentId: string;
  readonly carrier: string;
  readonly service: string;
  readonly trackingCode: string;
  readonly labelRef: ShipmentLabelId;
  readonly postageCostMinor: number;
  readonly serviceFeeMinor: number;
  readonly currency: string;
}

export function markShipmentPurchasedStatement(
  database: SqlDatabase,
  id: ShipmentId,
  update: PurchaseUpdate,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(
      `UPDATE ${SHIPMENT_TABLE} SET status = 'purchased', remote_shipment_id = ?2, carrier = ?3, service = ?4, tracking_code = ?5, label_ref = ?6, postage_cost_minor = ?7, service_fee_minor = ?8, currency = ?9, updated_at = ?10 WHERE id = ?1`,
    )
    .bind(
      id,
      update.remoteShipmentId,
      update.carrier,
      update.service,
      update.trackingCode,
      update.labelRef,
      update.postageCostMinor,
      update.serviceFeeMinor,
      update.currency,
      updatedAt,
    );
}

export function markShipmentRefundedStatement(
  database: SqlDatabase,
  id: ShipmentId,
  updatedAt: string,
): SqlStatement {
  return database
    .prepare(`UPDATE ${SHIPMENT_TABLE} SET status = 'refunded', updated_at = ?2 WHERE id = ?1`)
    .bind(id, updatedAt);
}

export interface InsertLabelRow {
  readonly id: ShipmentLabelId;
  readonly shipmentRef: ShipmentId;
  readonly format: string;
  readonly r2Key: string;
  readonly trackingCode: string;
  readonly costMinor: number;
  readonly currency: string;
  readonly createdAt: string;
}

export function insertLabelStatement(database: SqlDatabase, row: InsertLabelRow): SqlStatement {
  return database
    .prepare(
      `INSERT INTO ${SHIPMENT_LABEL_TABLE} (id, shipment_ref, format, r2_key, tracking_code, cost_minor, currency, voided, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)`,
    )
    .bind(
      row.id,
      row.shipmentRef,
      row.format,
      row.r2Key,
      row.trackingCode,
      row.costMinor,
      row.currency,
      row.createdAt,
    );
}

export interface InsertTrackingEventRow {
  readonly id: TrackingEventId;
  readonly shipmentRef: ShipmentId;
  readonly remoteId: string;
  readonly status: string;
  readonly occurredAt: string | null;
  readonly location: string | null;
  readonly message: string | null;
  readonly createdAt: string;
}

// INSERT OR IGNORE: the (shipment_ref, remote_id) unique index makes a re-pulled event a no-op.
export function insertTrackingEventStatement(
  database: SqlDatabase,
  row: InsertTrackingEventRow,
): SqlStatement {
  return database
    .prepare(
      `INSERT OR IGNORE INTO ${TRACKING_EVENT_TABLE} (id, shipment_ref, remote_id, status, occurred_at, location, message, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      row.id,
      row.shipmentRef,
      row.remoteId,
      row.status,
      row.occurredAt,
      row.location,
      row.message,
      row.createdAt,
    );
}

export function listTrackingEventsStatement(
  database: SqlDatabase,
  shipmentRef: ShipmentId,
): SqlStatement {
  return database
    .prepare(
      `SELECT remote_id, status, occurred_at, location, message FROM ${TRACKING_EVENT_TABLE} WHERE shipment_ref = ?1 ORDER BY occurred_at`,
    )
    .bind(shipmentRef);
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm check`
Expected: PASS.

```bash
git add packages/data-access/src/shipment-statements.ts
git commit -m "feat(data-access): shipment/label/tracking statement builders

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Shipment service

Mirrors the location-service pattern: validate + read pre-query, return an `EffectWrite` (statements + outbox + audit) the caller commits.

**Files:** Create `packages/data-access/src/shipment-service.ts`. Test: `packages/data-access/test/shipment-service.test.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/data-access/test/shipment-service.test.ts
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import type { UserId } from "@magna-carta/identifiers/types";
import { describe, expect, it } from "vitest";
import { commitEffectBatch, type BatchDatabase } from "../src/effect-batch.ts";
import { createShipmentDraft, recordPurchase } from "../src/shipment-service.ts";

const clock = { now: () => "2026-06-16T12:00:00.000Z" };
const now = () => clock.now();
const options = { clock, actorUserId: "user_a" as UserId };
const ADDR = JSON.stringify({
  name: "Jane",
  street1: "1 Main",
  city: "Reno",
  state: "NV",
  zip: "89501",
  country: "US",
});

function db(): BatchDatabase {
  return createMigratedNodeDatabase("per-firm").database;
}

describe("shipment service", () => {
  it("creates a draft shipment row", async () => {
    const database = db();
    const { shipmentId, effect } = await createShipmentDraft(
      database,
      {
        matterRef: null,
        fromAddress: ADDR,
        toAddress: ADDR,
        parcel: JSON.stringify({ weightOz: 8 }),
        options: "{}",
      },
      options,
    );
    await commitEffectBatch(database, effect, { now });
    const { results } = await database
      .prepare("SELECT status FROM shipment WHERE id = ?1")
      .bind(shipmentId)
      .all();
    expect(results[0]).toEqual({ status: "draft" });
  });

  it("records a purchase: shipment → purchased + a label row", async () => {
    const database = db();
    const draft = await createShipmentDraft(
      database,
      {
        matterRef: null,
        fromAddress: ADDR,
        toAddress: ADDR,
        parcel: JSON.stringify({ weightOz: 8 }),
        options: "{}",
      },
      options,
    );
    await commitEffectBatch(database, draft.effect, { now });
    const purchase = await recordPurchase(
      database,
      {
        shipmentId: draft.shipmentId,
        remoteShipmentId: "shp_1",
        carrier: "USPS",
        service: "Priority",
        trackingCode: "9400",
        labelFormat: "application/pdf",
        r2Key: `labels/${draft.shipmentId}.pdf`,
        postageCostMinor: 745,
        serviceFeeMinor: 5,
        currency: "USD",
      },
      options,
    );
    await commitEffectBatch(database, purchase.effect, { now });
    const { results } = await database
      .prepare(
        "SELECT status, tracking_code, postage_cost_minor, service_fee_minor FROM shipment WHERE id = ?1",
      )
      .bind(draft.shipmentId)
      .all();
    expect(results[0]).toEqual({
      status: "purchased",
      tracking_code: "9400",
      postage_cost_minor: 745,
      service_fee_minor: 5,
    });
    const labels = await database
      .prepare("SELECT cost_minor FROM shipment_label WHERE shipment_ref = ?1")
      .bind(draft.shipmentId)
      .all();
    expect(labels.results[0]).toEqual({ cost_minor: 745 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @magna-carta/data-access exec vitest run test/shipment-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

```typescript
// packages/data-access/src/shipment-service.ts
import { domainAuditStatement } from "./audit-statements.ts";
import type { EffectWrite } from "./effect-batch.ts";
import type { SqlDatabase } from "./idempotency-statements.ts";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { MatterId, ShipmentId, UserId } from "@magna-carta/identifiers/types";
import {
  insertLabelStatement,
  insertShipmentDraftStatement,
  markShipmentPurchasedStatement,
  markShipmentRefundedStatement,
} from "./shipment-statements.ts";

export interface ClockPort {
  now(): string;
}

export interface ShipmentServiceOptions {
  readonly clock: ClockPort;
  readonly actorUserId: UserId | null;
  readonly randomSource?: RandomSource;
}

function audit(
  database: SqlDatabase,
  options: ShipmentServiceOptions,
  event: string,
  subjectId: string,
) {
  return domainAuditStatement(database, {
    event,
    subjectId,
    actorUserId: options.actorUserId,
    clock: options.clock,
    randomSource: options.randomSource,
  });
}

export interface CreateShipmentDraftInput {
  readonly matterRef: MatterId | null;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly parcel: string;
  readonly options: string;
}

export async function createShipmentDraft(
  database: SqlDatabase,
  input: CreateShipmentDraftInput,
  options: ShipmentServiceOptions,
): Promise<{ shipmentId: ShipmentId; effect: EffectWrite }> {
  const shipmentId = newIdentifier("shipment", options.randomSource);
  const createdAt = options.clock.now();
  return {
    shipmentId,
    effect: {
      statements: [
        insertShipmentDraftStatement(database, {
          id: shipmentId,
          matterRef: input.matterRef,
          fromAddress: input.fromAddress,
          toAddress: input.toAddress,
          parcel: input.parcel,
          options: input.options,
          createdAt,
        }),
        audit(database, options, "shipment.created", shipmentId),
      ],
      outboxMessages: [{ topic: "shipment.created", payload: { shipmentId } }],
    },
  };
}

export interface RecordPurchaseInput {
  readonly shipmentId: ShipmentId;
  readonly remoteShipmentId: string;
  readonly carrier: string;
  readonly service: string;
  readonly trackingCode: string;
  readonly labelFormat: string;
  readonly r2Key: string;
  readonly postageCostMinor: number;
  readonly serviceFeeMinor: number;
  readonly currency: string;
}

export async function recordPurchase(
  database: SqlDatabase,
  input: RecordPurchaseInput,
  options: ShipmentServiceOptions,
): Promise<{ labelId: string; effect: EffectWrite }> {
  const labelId = newIdentifier("shipmentLabel", options.randomSource);
  const updatedAt = options.clock.now();
  return {
    labelId,
    effect: {
      statements: [
        insertLabelStatement(database, {
          id: labelId,
          shipmentRef: input.shipmentId,
          format: input.labelFormat,
          r2Key: input.r2Key,
          trackingCode: input.trackingCode,
          costMinor: input.postageCostMinor,
          currency: input.currency,
          createdAt: updatedAt,
        }),
        markShipmentPurchasedStatement(
          database,
          input.shipmentId,
          {
            remoteShipmentId: input.remoteShipmentId,
            carrier: input.carrier,
            service: input.service,
            trackingCode: input.trackingCode,
            labelRef: labelId,
            postageCostMinor: input.postageCostMinor,
            serviceFeeMinor: input.serviceFeeMinor,
            currency: input.currency,
          },
          updatedAt,
        ),
        audit(database, options, "shipment.purchased", input.shipmentId),
      ],
      // The cost-recovery seam: the Phase-3 financial core consumes this to post a matter disbursement.
      outboxMessages: [
        {
          topic: "shipment.purchased",
          payload: {
            shipmentId: input.shipmentId,
            postageCostMinor: input.postageCostMinor,
            serviceFeeMinor: input.serviceFeeMinor,
            currency: input.currency,
          },
        },
      ],
    },
  };
}

export async function recordRefund(
  database: SqlDatabase,
  shipmentId: ShipmentId,
  options: ShipmentServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const updatedAt = options.clock.now();
  return {
    effect: {
      statements: [
        markShipmentRefundedStatement(database, shipmentId, updatedAt),
        audit(database, options, "shipment.refunded", shipmentId),
      ],
      outboxMessages: [{ topic: "shipment.refunded", payload: { shipmentId } }],
    },
  };
}
```

> Confirm `domainAuditStatement`'s exact option shape and `newIdentifier`'s second-arg `randomSource` against `packages/locations/src/location-service.ts` (the reference consumer) and adjust the calls if the signatures differ — keep behavior identical.

- [ ] **Step 4: Run + commit**

Run: `pnpm --filter @magna-carta/data-access exec vitest run test/shipment-service.test.ts && pnpm check`
Expected: PASS (2 tests).

```bash
git add packages/data-access/src/shipment-service.ts packages/data-access/test/shipment-service.test.ts
git commit -m "feat(data-access): shipment service (draft, purchase, refund) returning EffectWrite

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: The worker secret-store seam + per-request registry builder

**Files:** Create `apps/worker/src/shipping/secret-store.ts`, `apps/worker/src/shipping/registry.ts`.

- [ ] **Step 1: Write the secret-store seam**

```typescript
// apps/worker/src/shipping/secret-store.ts
import type { SecretStore } from "@magna-carta/data-access/firm-secret-credential-store";

// The slice-1·2 firm_secret store, backed by the firm's D1. Until 1·2 lands, the production builder
// throws (no credential path exists yet); tests inject an in-memory SecretStore through CreateAppOptions.
// When 1·2 lands, replace the body with the real getSecret/putSecret over firmDatabase — the single
// line that turns shipping on in production.
export type SecretStoreForFirm = (firmDatabase: unknown) => SecretStore;

export const firmSecretStoreNotYetAvailable: SecretStoreForFirm = () => {
  throw new Error("firm_secret store is not yet wired (slice 1·2)");
};
```

- [ ] **Step 2: Write the per-request registry builder**

```typescript
// apps/worker/src/shipping/registry.ts
import { createConnectionStore } from "@magna-carta/data-access/integration-connection-store";
import {
  createFirmSecretCredentialStore,
  type SecretStore,
} from "@magna-carta/data-access/firm-secret-credential-store";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import {
  createIntegrationRegistry,
  type IntegrationRegistry,
} from "@magna-carta/integrations/registry";
import { createEasyPostAdapter } from "@magna-carta/shipping/easypost";
import { fetchHttpClient, type HttpClient } from "@magna-carta/shipping/easypost/http";

// One registry per request, over the firm's D1 (ConnectionStore) and its firm_secret CredentialStore.
// The HttpClient is injectable so tests pass a fake EasyPost.
export function buildShippingRegistry(
  firmDatabase: SqlDatabase,
  secretStore: SecretStore,
  http: HttpClient = fetchHttpClient(),
): IntegrationRegistry {
  const registry = createIntegrationRegistry({
    connectionStore: createConnectionStore(firmDatabase),
    credentialStore: createFirmSecretCredentialStore(secretStore),
  });
  registry.register(createEasyPostAdapter({ http }));
  return registry;
}
```

> `@magna-carta/shipping/easypost/http` must be in the package's `exports` (Plan 1 Task 2 declared it). Confirm and add if missing.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm check`
Expected: PASS.

```bash
git add apps/worker/src/shipping/secret-store.ts apps/worker/src/shipping/registry.ts
git commit -m "feat(worker): shipping registry builder + firm_secret store seam

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Add the `shipping:manage` permission

**Files:** Modify the access-control permission registry (the file that declares `locations:manage` etc. — find it via `KnownPermission` in `@magna-carta/access-control/registry`).

- [ ] **Step 1: Add the permission**

Add `"shipping:manage"` to the known-permission set, following the exact pattern of `locations:manage` (same registry entry shape; assign to the same roles that get `locations:manage`).

- [ ] **Step 2: Verify + commit**

Run: `pnpm check` (the `RouteMeta.permission` literal type now admits `"shipping:manage"`).

```bash
git add packages/access-control/
git commit -m "feat(access-control): shipping:manage permission

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Connection-management routes (connect / health / disconnect)

**Files:** Create `apps/worker/src/routes/communications/shipping.ts` (this task adds the connection routes; later tasks extend it). Modify `apps/worker/src/app.ts`.

> This task introduces `registerShippingRoutes(app, chokepoint, deps)` where `deps` carries the injectable `secretStoreForFirm` and `httpClient` (Task 6). Connect stores the EasyPost child-user API key via `secretStore.putSecret`, then inserts the connection.

- [ ] **Step 1: Write the connection routes**

```typescript
// apps/worker/src/routes/communications/shipping.ts
import { z, type OpenAPIHono } from "@hono/zod-openapi";
import { canonicalJsonStringify } from "@magna-carta/data-access/canonical";
import { runIdempotentEffect } from "@magna-carta/data-access/run-idempotent-effect";
import { insertConnectionStatement } from "@magna-carta/data-access/integration-connection-statements";
import type { SecretStore } from "@magna-carta/data-access/firm-secret-credential-store";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { createEasyPostAdapter } from "@magna-carta/shipping/easypost";
import type { HttpClient } from "@magna-carta/shipping/easypost/http";
import type { Bindings } from "../app.ts";
import type { Chokepoint } from "../chokepoint/chokepoint.ts";
import {
  requireChokepointFirmContext,
  requireChokepointIdempotency,
  requireChokepointUserId,
} from "../chokepoint/context-accessors.ts";
import type { AppVariables } from "../chokepoint/ports.ts";
import { chokepointMiddleware } from "../chokepoint/register.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../contracts/route-meta.ts";

export interface ShippingRouteDeps {
  readonly secretStoreForFirm: (firmDatabase: unknown) => SecretStore;
  readonly httpClient: HttpClient;
}

type ShippingApp = OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>;
const MANAGE = "shipping:manage" as const;

function writeMeta(operationId: string): RouteMeta {
  return {
    operationId,
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    resource: "firm",
    audited: true,
    idempotency: "required",
    idempotencyStore: "firm",
    rateLimit: "default",
  };
}

const ConnectRequest = z.object({ apiKey: z.string().min(1) }).openapi("ShippingConnectRequest");
const ConnectAck = z.object({ id: z.string(), status: z.string() }).openapi("ShippingConnectAck");

const connectRoute = defineOpenAPIRoute(writeMeta("shipping.connect"), {
  method: "post",
  path: "/api/v1/integrations/shipping/connection",
  description:
    "Connects the firm's EasyPost postage account by storing its API key as a firm secret.",
  request: {
    body: { content: { "application/json": { schema: ConnectRequest } }, required: true },
  },
  responses: {
    201: { description: "Connected", content: { "application/json": { schema: ConnectAck } } },
  },
});

export function registerShippingRoutes(
  app: ShippingApp,
  chokepoint: Chokepoint,
  deps: ShippingRouteDeps,
): void {
  app.openapi(
    { ...connectRoute, middleware: chokepointMiddleware(chokepoint, connectRoute) },
    async (c) => {
      const firm = requireChokepointFirmContext(c);
      const userId = requireChokepointUserId(c);
      const idempotency = requireChokepointIdempotency(c);
      const { apiKey } = c.req.valid("json");
      const now = () => new Date().toISOString();
      const secrets = deps.secretStoreForFirm(firm.firmDatabase);
      const descriptor = createEasyPostAdapter({ http: deps.httpClient }).descriptor;

      const connectionId = newIdentifier("integrationConnection");
      const credentialRef = `integration:shipping:${connectionId}`;
      // Store the secret first (idempotent by ref), then commit the connection row in the effect batch.
      await secrets.putSecret(credentialRef, JSON.stringify({ kind: "apiKey", apiKey }));

      const result = await runIdempotentEffect({
        database: firm.firmDatabase,
        key: idempotency.key,
        fingerprint: idempotency.fingerprint,
        now,
        effect: async () => ({
          write: {
            statements: [
              insertConnectionStatement(firm.firmDatabase, {
                id: connectionId,
                category: "shipping",
                adapterId: "easypost",
                scope: "firm",
                principalRef: firm.firmId,
                credentialRef,
                capabilitySnapshot: JSON.stringify(descriptor),
                createdAt: now(),
              }),
            ],
            outboxMessages: [],
          },
          responseCode: 201,
          responseBody: canonicalJsonStringify({ id: connectionId, status: "connected" }),
        }),
      });
      if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
        return problemForIdempotency(c, result);
      return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof ConnectAck>, 201);
    },
  );
}

// Minimal local helper — mirror the idempotency-conflict problem shape used in routes/matters/locations.ts.
function problemForIdempotency(
  c: Parameters<ShippingApp["openapi"]>[1] extends (c: infer C, ...args: never[]) => unknown
    ? C
    : never,
  _result: unknown,
): never {
  throw new Error(
    "replace with the shared idempotency-conflict problem helper used in routes/matters/locations.ts",
  );
}
```

> **Build note:** copy the _exact_ idempotency-conflict handling (`problemResponseForIdempotencyConflict`, the `replayed` header) and the `userId` audit wiring from `apps/worker/src/routes/matters/locations.ts` — the stub above marks where it goes. Keep this file consistent with that reference route. `userId` is read to satisfy the audited-route contract.

- [ ] **Step 2: Register in `app.ts`**

In `apps/worker/src/app.ts`, extend `CreateAppOptions` and register the routes:

```typescript
// add to CreateAppOptions:
  shipping?: import("./routes/communications/shipping.ts").ShippingRouteDeps;
```

```typescript
// inside createApp, with the other route registrations:
if (options.shipping) registerShippingRoutes(app, chokepoint, options.shipping);
```

Add the import: `import { registerShippingRoutes } from "./routes/communications/shipping.ts";`. (Production wiring in `index.ts` passes `shipping: { secretStoreForFirm: firmSecretStoreNotYetAvailable, httpClient: fetchHttpClient() }` until 1·2 lands; tests pass a fake — Task 12.)

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm check`
Expected: PASS.

```bash
git add apps/worker/src/routes/communications/shipping.ts apps/worker/src/app.ts
git commit -m "feat(worker): shipping connection-management connect route

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Create-draft + rate-shop routes

**Files:** Modify `apps/worker/src/routes/communications/shipping.ts`.

- [ ] **Step 1: Add the address/parcel/options request schemas + the two routes**

Append to `registerShippingRoutes` (and define the schemas at module scope):

```typescript
const AddressSchema = z.object({
  name: z.string().min(1),
  company: z.string().nullable().optional(),
  street1: z.string().min(1),
  street2: z.string().nullable().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  zip: z.string().min(1),
  country: z.string().length(2),
  phone: z.string().nullable().optional(),
});
const ParcelSchema = z.object({
  lengthIn: z.number().positive().optional(),
  widthIn: z.number().positive().optional(),
  heightIn: z.number().positive().optional(),
  weightOz: z.number().positive(),
  predefinedPackage: z.string().nullable().optional(),
});
const OptionsSchema = z.object({
  certifiedMail: z.boolean().optional(),
  returnReceipt: z.enum(["none", "electronic", "physical"]).optional(),
  signatureConfirmation: z.enum(["none", "signature", "adult"]).optional(),
  insuranceAmountMinor: z.number().int().nullable().optional(),
});
const CreateShipmentRequest = z
  .object({
    matterRef: z.string().nullable().optional(),
    from: AddressSchema,
    to: AddressSchema,
    parcel: ParcelSchema,
    options: OptionsSchema.optional(),
  })
  .openapi("CreateShipmentRequest");
const ShipmentAck = z.object({ id: z.string() }).openapi("ShipmentAck");
const RateSchema = z.object({
  remoteId: z.string(),
  carrier: z.string(),
  service: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
  deliveryDays: z.number().nullable(),
  estDeliveryDate: z.string().nullable(),
});
const RatesResponse = z
  .object({ remoteShipmentId: z.string(), rates: z.array(RateSchema) })
  .openapi("ShipmentRates");
```

```typescript
const createShipmentRoute = defineOpenAPIRoute(writeMeta("shipping.createShipment"), {
  method: "post",
  path: "/api/v1/shipments",
  description:
    "Creates a draft shipment (recipient, package, options) optionally linked to a matter.",
  request: {
    body: { content: { "application/json": { schema: CreateShipmentRequest } }, required: true },
  },
  responses: {
    201: { description: "Draft created", content: { "application/json": { schema: ShipmentAck } } },
  },
});

app.openapi(
  { ...createShipmentRoute, middleware: chokepointMiddleware(chokepoint, createShipmentRoute) },
  async (c) => {
    const firm = requireChokepointFirmContext(c);
    const userId = requireChokepointUserId(c);
    const idempotency = requireChokepointIdempotency(c);
    const body = c.req.valid("json");
    const now = () => new Date().toISOString();
    const result = await runIdempotentEffect({
      database: firm.firmDatabase,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now,
      effect: async () => {
        const created = await createShipmentDraft(
          firm.firmDatabase,
          {
            matterRef: (body.matterRef ?? null) as never,
            fromAddress: JSON.stringify(body.from),
            toAddress: JSON.stringify(body.to),
            parcel: JSON.stringify(body.parcel),
            options: JSON.stringify(body.options ?? {}),
          },
          { clock: { now }, actorUserId: userId },
        );
        return {
          write: created.effect,
          responseCode: 201,
          responseBody: canonicalJsonStringify({ id: created.shipmentId }),
        };
      },
    });
    if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
      return problemForIdempotency(c, result);
    return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof ShipmentAck>, 201);
  },
);
```

Rate-shop is a read-through to EasyPost (no persistence — rates are ephemeral). It is a POST (it sends the package) but `idempotency: "optional"`, `audited: false`:

```typescript
const rateRoute = defineOpenAPIRoute(
  {
    operationId: "shipping.rateShipment",
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  },
  {
    method: "post",
    path: "/api/v1/shipments/{id}/rates",
    description: "Returns live carrier rates for the draft shipment.",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: "Rates", content: { "application/json": { schema: RatesResponse } } },
    },
  },
);

app.openapi(
  { ...rateRoute, middleware: chokepointMiddleware(chokepoint, rateRoute) },
  async (c) => {
    const firm = requireChokepointFirmContext(c);
    const id = c.req.valid("param").id as never; // ShipmentId
    const secrets = deps.secretStoreForFirm(firm.firmDatabase);
    const registry = buildShippingRegistry(firm.firmDatabase, secrets, deps.httpClient);
    const resolved = await registry.resolve<ShippingPort>("shipping", { firmId: firm.firmId });
    if (!resolved.ok) return shippingDispatchProblem(c, resolved);
    const { results } = await selectShipmentStatement(firm.firmDatabase, id).all<{
      from_address: string;
      to_address: string;
      parcel: string;
      options: string;
    }>();
    const draft = results[0];
    if (draft === undefined) return notFoundProblem(c);
    const rated = await resolved.value.port.rateShipment({
      from: JSON.parse(draft.from_address),
      to: JSON.parse(draft.to_address),
      parcel: JSON.parse(draft.parcel),
      options: JSON.parse(draft.options),
    });
    if (!rated.ok) return shippingDispatchProblem(c, rated);
    return c.json({ remoteShipmentId: rated.value.remoteId, rates: rated.value.rates }, 200);
  },
);
```

Add the imports at the top of the file:

```typescript
import { selectShipmentStatement } from "@magna-carta/data-access/shipment-statements";
import {
  createShipmentDraft,
  recordPurchase,
  recordRefund,
} from "@magna-carta/data-access/shipment-service";
import { buildShippingRegistry } from "../shipping/registry.ts";
import type { ShippingPort } from "@magna-carta/shipping/port";
```

> **Build note:** write the two small helpers `shippingDispatchProblem(c, dispatch)` (maps a non-ok `Dispatch` — `not-connected` → 409 problem; `capability-unsupported` → 422; `adapter-error` → map `problem.category` onto the worker problem module via its status) and `notFoundProblem(c)` using the worker's `problemJson` (see `apps/worker/src/contracts/problem.ts`). Keep them at the bottom of `shipping.ts`.

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm check`
Expected: PASS.

```bash
git add apps/worker/src/routes/communications/shipping.ts
git commit -m "feat(worker): create-draft + rate-shop shipping routes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Purchase route (buy label, copy to R2, record)

**Files:** Modify `apps/worker/src/routes/communications/shipping.ts`.

- [ ] **Step 1: Add the purchase route**

The chokepoint idempotency key doubles as the EasyPost `Idempotency-Key`, so a retry never double-buys. The label PDF is fetched from EasyPost's transient URL and written to per-firm R2; the R2 key is derived from the shipment id (stable across retries → idempotent put).

```typescript
const PurchaseRequest = z
  .object({
    remoteShipmentId: z.string(),
    remoteRateId: z.string(),
    serviceFeeMinor: z.number().int().nonnegative().default(0),
  })
  .openapi("PurchaseRequest");
const PurchaseAck = z
  .object({ id: z.string(), trackingCode: z.string(), labelId: z.string() })
  .openapi("PurchaseAck");

const purchaseRoute = defineOpenAPIRoute(writeMeta("shipping.purchase"), {
  method: "post",
  path: "/api/v1/shipments/{id}/purchase",
  description: "Buys the chosen rate, stores the label PDF, and records postage + service fee.",
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { "application/json": { schema: PurchaseRequest } }, required: true },
  },
  responses: {
    200: { description: "Purchased", content: { "application/json": { schema: PurchaseAck } } },
  },
});

app.openapi(
  { ...purchaseRoute, middleware: chokepointMiddleware(chokepoint, purchaseRoute) },
  async (c) => {
    const firm = requireChokepointFirmContext(c);
    const userId = requireChokepointUserId(c);
    const idempotency = requireChokepointIdempotency(c);
    const id = c.req.valid("param").id as never; // ShipmentId
    const body = c.req.valid("json");
    const now = () => new Date().toISOString();
    const secrets = deps.secretStoreForFirm(firm.firmDatabase);
    const registry = buildShippingRegistry(firm.firmDatabase, secrets, deps.httpClient);
    const resolved = await registry.resolve<ShippingPort>("shipping", { firmId: firm.firmId });
    if (!resolved.ok) return shippingDispatchProblem(c, resolved);

    const result = await runIdempotentEffect({
      database: firm.firmDatabase,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now,
      effect: async () => {
        const bought = await resolved.value.port.buyLabel({
          remoteShipmentId: body.remoteShipmentId,
          remoteRateId: body.remoteRateId,
          idempotencyKey: idempotency.key,
        });
        if (!bought.ok) throw new ShippingDispatchError(bought);
        const label = bought.value;
        // Copy the label bytes from EasyPost's transient URL into per-firm R2.
        const labelResponse = await fetch(label.labelUrl);
        const r2Key = `labels/${id}.pdf`;
        await c.env.R2.put(r2Key, await labelResponse.arrayBuffer(), {
          httpMetadata: { contentType: label.labelFormat },
        });
        const recorded = await recordPurchase(
          firm.firmDatabase,
          {
            shipmentId: id,
            remoteShipmentId: label.remoteId,
            carrier: label.carrier,
            service: label.service,
            trackingCode: label.trackingCode,
            labelFormat: label.labelFormat,
            r2Key,
            postageCostMinor: label.costMinor,
            serviceFeeMinor: body.serviceFeeMinor,
            currency: label.currency,
          },
          { clock: { now }, actorUserId: userId },
        );
        return {
          write: recorded.effect,
          responseCode: 200,
          responseBody: canonicalJsonStringify({
            id,
            trackingCode: label.trackingCode,
            labelId: recorded.labelId,
          }),
        };
      },
    }).catch((caught) => {
      if (caught instanceof ShippingDispatchError) return caught;
      throw caught;
    });
    if (result instanceof ShippingDispatchError) return shippingDispatchProblem(c, result.dispatch);
    if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
      return problemForIdempotency(c, result);
    return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof PurchaseAck>, 200);
  },
);
```

Add at the bottom of the file:

```typescript
// Carries a non-ok Dispatch out of the idempotent-effect callback so the route can map it to a problem.
class ShippingDispatchError extends Error {
  constructor(public readonly dispatch: { ok: false; reason: string; problem?: unknown }) {
    super("shipping dispatch error");
  }
}
```

> **Build note:** confirm `runIdempotentEffect`'s thrown-error semantics in `packages/data-access/src/run-idempotent-effect.ts` — if a throw inside `effect` aborts without writing a completed record (so a retry re-runs), the EasyPost `Idempotency-Key` (set above) is what prevents a double-charge on that retry. Document this inline.

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm check`
Expected: PASS.

```bash
git add apps/worker/src/routes/communications/shipping.ts
git commit -m "feat(worker): purchase route — buy label, store to R2, record postage + fee

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Label download, tracking (pull), and refund routes

**Files:** Modify `apps/worker/src/routes/communications/shipping.ts`.

- [ ] **Step 1: Add the three routes**

```typescript
const TrackingResponse = z
  .object({
    events: z.array(
      z.object({
        status: z.string(),
        occurredAt: z.string().nullable(),
        location: z.string().nullable(),
        message: z.string().nullable(),
      }),
    ),
  })
  .openapi("TrackingResponse");
const RefundAck = z.object({ id: z.string(), status: z.string() }).openapi("RefundAck");

// GET label PDF — streamed from per-firm R2.
const labelRoute = defineOpenAPIRoute(
  {
    operationId: "shipping.label",
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  },
  {
    method: "get",
    path: "/api/v1/shipments/{id}/label",
    description: "Streams the shipment's label PDF.",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: "Label PDF", content: { "application/pdf": { schema: z.string() } } },
    },
  },
);
app.openapi(
  { ...labelRoute, middleware: chokepointMiddleware(chokepoint, labelRoute) },
  async (c) => {
    const id = c.req.valid("param").id;
    const object = await c.env.R2.get(`labels/${id}.pdf`);
    if (object === null) return notFoundProblem(c);
    return new Response(object.body, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="label-${id}.pdf"`,
      },
    });
  },
);

// Pull tracking live, cache events, return them. POST (it calls EasyPost) but unaudited, optional idempotency.
const trackingRoute = defineOpenAPIRoute(
  {
    operationId: "shipping.tracking",
    surface: "app",
    authenticated: true,
    permission: MANAGE,
    resource: "firm",
    audited: false,
    idempotency: "optional",
    rateLimit: "default",
  },
  {
    method: "post",
    path: "/api/v1/shipments/{id}/tracking",
    description: "Pulls and returns current tracking events.",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: "Tracking events",
        content: { "application/json": { schema: TrackingResponse } },
      },
    },
  },
);
app.openapi(
  { ...trackingRoute, middleware: chokepointMiddleware(chokepoint, trackingRoute) },
  async (c) => {
    const firm = requireChokepointFirmContext(c);
    const id = c.req.valid("param").id as never; // ShipmentId
    const now = () => new Date().toISOString();
    const { results } = await selectShipmentStatement(firm.firmDatabase, id).all<{
      tracking_code: string | null;
    }>();
    const shipmentRow = results[0];
    if (shipmentRow?.tracking_code == null) return notFoundProblem(c);
    const registry = buildShippingRegistry(
      firm.firmDatabase,
      deps.secretStoreForFirm(firm.firmDatabase),
      deps.httpClient,
    );
    const resolved = await registry.resolve<ShippingPort>("shipping", { firmId: firm.firmId });
    if (!resolved.ok) return shippingDispatchProblem(c, resolved);
    const tracked = await resolved.value.port.getTracking(shipmentRow.tracking_code);
    if (!tracked.ok) return shippingDispatchProblem(c, tracked);
    // Cache each event (INSERT OR IGNORE dedups by remote_id); a single batch.
    const inserts = tracked.value.map((event) =>
      insertTrackingEventStatement(firm.firmDatabase, {
        id: newIdentifier("trackingEvent"),
        shipmentRef: id,
        remoteId: event.remoteId,
        status: event.status,
        occurredAt: event.occurredAt,
        location: event.location,
        message: event.message,
        createdAt: now(),
      }),
    );
    if (inserts.length > 0) await firm.firmDatabase.batch(inserts);
    return c.json(
      {
        events: tracked.value.map((e) => ({
          status: e.status,
          occurredAt: e.occurredAt,
          location: e.location,
          message: e.message,
        })),
      },
      200,
    );
  },
);

// Refund/void an unused label.
const refundRoute = defineOpenAPIRoute(writeMeta("shipping.refund"), {
  method: "post",
  path: "/api/v1/shipments/{id}/refund",
  description: "Voids/refunds the shipment's label.",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: {
      description: "Refund submitted",
      content: { "application/json": { schema: RefundAck } },
    },
  },
});
app.openapi(
  { ...refundRoute, middleware: chokepointMiddleware(chokepoint, refundRoute) },
  async (c) => {
    const firm = requireChokepointFirmContext(c);
    const userId = requireChokepointUserId(c);
    const idempotency = requireChokepointIdempotency(c);
    const id = c.req.valid("param").id as never; // ShipmentId
    const now = () => new Date().toISOString();
    const { results } = await selectShipmentStatement(firm.firmDatabase, id).all<{
      remote_shipment_id: string | null;
    }>();
    const remote = results[0]?.remote_shipment_id;
    if (remote == null) return notFoundProblem(c);
    const registry = buildShippingRegistry(
      firm.firmDatabase,
      deps.secretStoreForFirm(firm.firmDatabase),
      deps.httpClient,
    );
    const resolved = await registry.resolve<ShippingPort>("shipping", { firmId: firm.firmId });
    if (!resolved.ok) return shippingDispatchProblem(c, resolved);
    const refunded = await resolved.value.port.refundLabel(remote);
    if (!refunded.ok) return shippingDispatchProblem(c, refunded);
    const result = await runIdempotentEffect({
      database: firm.firmDatabase,
      key: idempotency.key,
      fingerprint: idempotency.fingerprint,
      now,
      effect: async () => {
        const recorded = await recordRefund(firm.firmDatabase, id, {
          clock: { now },
          actorUserId: userId,
        });
        return {
          write: recorded.effect,
          responseCode: 200,
          responseBody: canonicalJsonStringify({ id, status: refunded.value.status }),
        };
      },
    });
    if (result.kind === "in-progress" || result.kind === "fingerprint-mismatch")
      return problemForIdempotency(c, result);
    return c.json(JSON.parse(result.responseBody ?? "{}") as z.infer<typeof RefundAck>, 200);
  },
);
```

Add the import: `import { insertTrackingEventStatement } from "@magna-carta/data-access/shipment-statements";`.

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm check`
Expected: PASS.

```bash
git add apps/worker/src/routes/communications/shipping.ts
git commit -m "feat(worker): label download, pull-tracking, and refund shipping routes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Miniflare end-to-end

**Files:** Create `apps/worker/test/shipping-e2e.test.ts`.

- [ ] **Step 1: Write the e2e (fake EasyPost http + in-memory secret store injected through createApp)**

```typescript
// apps/worker/test/shipping-e2e.test.ts
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { HttpClient } from "@magna-carta/shipping/easypost/http";
import type { SecretStore } from "@magna-carta/data-access/firm-secret-credential-store";
import { createApp } from "../src/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { seedCredentialedUser, mirrorMemberWithOwnerRole, PASSWORD } from "./support/test-auth.ts";

function memorySecretStore(): SecretStore {
  const map = new Map<string, string>();
  return {
    getSecret: async (r) => map.get(r) ?? null,
    putSecret: async (r, v) => void map.set(r, v),
  };
}

// A fake EasyPost: rate → buy → tracking, by URL.
function fakeEasyPost(): HttpClient {
  return {
    async request(req) {
      if (req.url.endsWith("/shipments") && req.method === "POST")
        return {
          status: 201,
          json: async () => ({
            id: "shp_1",
            rates: [
              { id: "rate_1", carrier: "USPS", service: "Priority", rate: "7.45", currency: "USD" },
            ],
          }),
        };
      if (req.url.includes("/buy"))
        return {
          status: 200,
          json: async () => ({
            id: "shp_1",
            tracking_code: "9400111",
            selected_rate: { carrier: "USPS", service: "Priority", rate: "7.45", currency: "USD" },
            postage_label: {
              label_url: "https://easypost.test/label.pdf",
              label_file_type: "application/pdf",
            },
          }),
        };
      if (req.url.includes("/trackers"))
        return {
          status: 200,
          json: async () => ({
            trackers: [
              {
                tracking_details: [
                  {
                    status: "in_transit",
                    datetime: "2026-06-17T00:00:00Z",
                    message: "Departed",
                    tracking_location: { city: "Reno", state: "NV" },
                  },
                ],
              },
            ],
          }),
        };
      return { status: 404, json: async () => ({}) };
    },
  };
}

const secrets = memorySecretStore();
const app = createApp({
  shipping: { secretStoreForFirm: () => secrets, httpClient: fakeEasyPost() },
});

// Also stub global fetch for the R2 label copy (the purchase route fetches label_url).
beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  globalThis.fetch = (async () =>
    new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 })) as typeof fetch; // "%PDF"
});

async function authedHeaders(): Promise<Record<string, string>> {
  const { userId } = await seedCredentialedUser("ship@example.com");
  await mirrorMemberWithOwnerRole(userId, "Ship User");
  // Obtain a session cookie via Better Auth sign-in (mirror an existing authed integration test's helper).
  // Replace with the repo's session-cookie helper used by other chokepoint route tests.
  throw new Error(
    "use the repo's existing authed-request helper to mint a session cookie + Idempotency-Key",
  );
}

describe("shipping e2e", () => {
  it("connect → create → rate → purchase → label → tracking", async () => {
    const headers = await authedHeaders();
    const base = "https://example.com/api/v1";
    const json = { "content-type": "application/json", ...headers };

    const connect = await app.request(
      `${base}/integrations/shipping/connection`,
      { method: "POST", headers: json, body: JSON.stringify({ apiKey: "ezk_test" }) },
      env,
    );
    expect(connect.status).toBe(201);

    const addr = {
      name: "Jane",
      street1: "1 Main St",
      city: "Reno",
      state: "NV",
      zip: "89501",
      country: "US",
    };
    const create = await app.request(
      `${base}/shipments`,
      {
        method: "POST",
        headers: json,
        body: JSON.stringify({
          from: addr,
          to: addr,
          parcel: { weightOz: 8 },
          options: { certifiedMail: true },
        }),
      },
      env,
    );
    expect(create.status).toBe(201);
    const { id } = (await create.json()) as { id: string };

    const rates = await app.request(
      `${base}/shipments/${id}/rates`,
      { method: "POST", headers: json },
      env,
    );
    expect(rates.status).toBe(200);
    const rated = (await rates.json()) as {
      remoteShipmentId: string;
      rates: { remoteId: string }[];
    };

    const purchase = await app.request(
      `${base}/shipments/${id}/purchase`,
      {
        method: "POST",
        headers: json,
        body: JSON.stringify({
          remoteShipmentId: rated.remoteShipmentId,
          remoteRateId: rated.rates[0].remoteId,
          serviceFeeMinor: 5,
        }),
      },
      env,
    );
    expect(purchase.status).toBe(200);
    expect((await purchase.json()) as { trackingCode: string }).toMatchObject({
      trackingCode: "9400111",
    });

    const label = await app.request(
      `${base}/shipments/${id}/label`,
      { method: "GET", headers },
      env,
    );
    expect(label.status).toBe(200);
    expect(label.headers.get("content-type")).toBe("application/pdf");

    const tracking = await app.request(
      `${base}/shipments/${id}/tracking`,
      { method: "POST", headers: json },
      env,
    );
    expect(tracking.status).toBe(200);
    expect(((await tracking.json()) as { events: unknown[] }).events.length).toBeGreaterThan(0);
  });
});
```

> **Build note:** the `authedHeaders` stub marks the one repo-specific gap — reuse the existing session-cookie + `Idempotency-Key` helper that the other chokepoint route tests use (find it in a sibling test that POSTs an authed `/api/v1` route, e.g. the matters or locations integration test). Do not hand-roll auth.

- [ ] **Step 2: Run the e2e**

Run: `pnpm --filter @magna-carta/worker exec vitest run test/shipping-e2e.test.ts`
Expected: PASS once the auth helper is wired.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/test/shipping-e2e.test.ts
git commit -m "test(worker): shipping e2e — connect, create, rate, purchase, label, tracking

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Load-profile extension (shipments + tracking volume)

Per the accretion rule, the slice extends the volume harness in-area. Follow `packages/fixtures/CLAUDE.md` and the `matters-measurements.ts` pattern.

**Files:** Create `packages/fixtures/src/load-profile/shipping-measurements.ts`; extend the generator + profile + smoke list (per `packages/fixtures/CLAUDE.md` "Extending the load profile").

- [ ] **Step 1: Generation** — add shipment volume through the real write paths (`createShipmentDraft` + `recordPurchase` via `commitEffectBatch`), sized like an established firm (e.g. a few hundred shipments across matters, a handful of tracking events each). Record probe identifiers (the busiest matter's shipment, a multi-event shipment) into the snapshot manifest. All randomness from the one `FixtureContext`; bump the profile `version` (new counts) or `GENERATOR_VERSION` (logic change).

- [ ] **Step 2: Measured set** — in `shipping-measurements.ts`, define `Measurement` objects for the volume-shaped reads:

```typescript
// packages/fixtures/src/load-profile/shipping-measurements.ts
import { listTrackingEventsStatement } from "@magna-carta/data-access/shipment-statements";
import { explainStatement, type LabeledPlan, type Measurement } from "./runner.ts";
import type { LoadedSnapshot } from "./snapshot.ts";
import type { MattersMeasurementHandle } from "./matters-measurements.ts";

// Shipments-per-matter list + a shipment's tracking history — both cost depends on data shape.
export const shippingMeasurements: readonly Measurement<MattersMeasurementHandle, unknown>[] = [
  {
    name: "list-shipments.by-matter",
    operation: async (handle) => {
      await handle.snapshot.database
        .prepare(
          "SELECT id, status, tracking_code, carrier, service FROM shipment WHERE matter_ref = ?1 ORDER BY created_at DESC LIMIT 51",
        )
        .bind(handle.snapshot.manifest.shippingProbes.busiestMatterId)
        .all();
    },
  },
  {
    name: "list-tracking-events.by-shipment",
    operation: async (handle) => {
      await listTrackingEventsStatement(
        handle.snapshot.database,
        handle.snapshot.manifest.shippingProbes.multiEventShipmentId,
      ).all();
    },
  },
];

export function shippingHotPathPlans(snapshot: LoadedSnapshot): LabeledPlan[] {
  const { shippingProbes } = snapshot.manifest;
  const byMatter = snapshot.database
    .prepare("SELECT id FROM shipment WHERE matter_ref = ?1 ORDER BY created_at DESC LIMIT 51")
    .bind(shippingProbes.busiestMatterId) as unknown as { sql: string; bindings: unknown[] };
  const byShipment = listTrackingEventsStatement(
    snapshot.database,
    shippingProbes.multiEventShipmentId,
  ) as unknown as { sql: string; bindings: unknown[] };
  return [
    {
      label: "list-shipments.by-matter",
      details: explainStatement(snapshot.raw, byMatter.sql, byMatter.bindings),
    },
    {
      label: "list-tracking-events.by-shipment",
      details: explainStatement(snapshot.raw, byShipment.sql, byShipment.bindings),
    },
  ];
}
```

> Both plans must walk an index (the `shipment_matter_ref_index` and the `tracking_event` unique index/`shipment_ref`), not a full scan — neither is allowlisted. If an EXPLAIN shows a scan, add the missing index in `per-firm-schema.ts` (regenerate the migration) before baselining.

- [ ] **Step 3: Wire + baseline** — add `shippingProbes` to the manifest type, register the measurements + plans where `mattersMeasurements`/`practiceHotPathPlans` are aggregated, add the two operation names to the smoke test's expected list, then:

Run: `pnpm --filter @magna-carta/fixtures run measure`
Expected: regenerated baseline (version bump renames the baseline file); no unexpected scans.

- [ ] **Step 4: Commit**

```bash
git add packages/fixtures/
git commit -m "perf(fixtures): shipping volume + measured set in the load profile

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Documentation + status + final gate

**Files:** `ROADMAP.md`, `STATUS.md`, `CHANGELOG.md`, `docs/Magna-Carta-White-Paper.md`, `docs/user/` (shipping user guide stub — full guide ships with the UI).

- [ ] **Step 1: Update the living docs**

- `STATUS.md`: Shipping & postage row → Built `[~]`→`[x]` for the backend slice; note "UI plan after 0·7a", "webhook push + Phase-3 cost recovery deferred", "Load profile `[x]`".
- `ROADMAP.md`: shipping backend shipped under integrations.
- `CHANGELOG.md`: shipment schema + service + worker routes (connect/create/rate/purchase/label/tracking/refund) + R2 label storage + load profile.
- White paper _Integrations_: add the shipping feature (one paragraph; reference EasyPost as the provider and certified-mail support — no process refs).
- `docs/user/`: a short shipping page stub (the full user guide ships with the UI).

- [ ] **Step 2: Final full gate**

Run:

```
pnpm check && pnpm run lint:process-refs && \
pnpm --filter @magna-carta/shipping exec vitest run && \
pnpm --filter @magna-carta/data-access exec vitest run && \
pnpm --filter @magna-carta/worker exec vitest run && \
pnpm --filter @magna-carta/fixtures exec vitest run
```

Expected: all green; `lint:process-refs` clean.

- [ ] **Step 3: Validate the worker deploy contract**

Run: `pnpm --filter @magna-carta/worker exec wrangler deploy --dry-run`
Expected: succeeds (the OpenAPI document includes the new shipping operations; the committed snapshot + client were regenerated if the contract gates require it — run the snapshot/client regen scripts if CI flags drift).

- [ ] **Step 4: Commit**

```bash
git add ROADMAP.md STATUS.md CHANGELOG.md docs/Magna-Carta-White-Paper.md docs/user/
git commit -m "docs(shipping): status, changelog, white paper for the shipping backend slice

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (B-backend portion of the design):**

- §1 module placement — shipping tables (Task 2), shipment statements/service (Tasks 4–5), worker routes + composition (Tasks 6–11), identifiers (Task 1). ✓
- §4 vertical slice — schema incl. cost columns + matter link (Task 2); routes for create, rate, idempotent purchase with R2 label copy, label, tracking, refund (Tasks 9–11); connection management (Task 8). ✓
- §6 cross-cutting — money as minor units (Tasks 2,4,5); purchase idempotent end-to-end (chokepoint key + EasyPost `Idempotency-Key`, Tasks 3,10); secret never logged (the key only ever flows into `putSecret`). ✓
- §7 testing + load profile — shipment-service unit (Task 5), Miniflare e2e (Task 12), load-profile accretion (Task 13). ✓
- §5 piece C — cost columns + the `shipment.purchased` outbox payload ship as the seam (Tasks 2,5); the disbursement posting is built with Phase 3. ✓

**Deliberate scope refinements (flagged):**

- **Tracking is pull-based**, not push-webhook. At firm mailing volume, on-demand pull (Task 11) is sufficient and avoids building cross-firm webhook routing for Forge's single parent webhook. **Deferred follow-up:** a `POST /v1/webhooks/easypost/{token}` ingress — per-firm opaque token on the connection + a control-plane token→firm route table + HMAC-SHA256 verification (`crypto.subtle`) + `INSERT OR IGNORE` tracking append. This is the one design item (§4 webhook) intentionally pushed to its own task; everything else in B-backend is built here.
- **Live `firm_secret` backing** is injected through the `secretStoreForFirm` seam (Task 6); production uses `firmSecretStoreNotYetAvailable` until slice 1·2 lands, then swaps to the real store (one line). Tests use an in-memory fake, so the slice is fully testable now.

**Placeholder scan:** the three `> Build note` callouts (Tasks 8, 10, 12) point at _named existing files_ to copy an exact helper from (idempotency-conflict response; `runIdempotentEffect` throw semantics; the authed-request helper) rather than inventing a divergent copy — these are "use the canonical version" instructions, not deferred work. The `problemForIdempotency` / `shippingDispatchProblem` / `notFoundProblem` helpers are specified by behavior and built over the existing `problemJson`. No `TBD`/`TODO`.

**Type consistency:** `ShipmentId`/`ShipmentLabelId`/`TrackingEventId` (Task 1) used in Tasks 2,4,5. `createShipmentDraft`/`recordPurchase`/`recordRefund` signatures (Task 5) match their callers (Tasks 9–11). `buildShippingRegistry(firmDatabase, secretStore, http)` (Task 6) called identically in Tasks 9–11. `ShippingPort`/`BuyLabelRequest.idempotencyKey` (Plan 1 + Task 3) consumed in Task 10. `SecretStore` (Plan 1 Task 12) threaded through Tasks 6,8,12. R2 key `labels/${shipmentId}.pdf` identical in Tasks 10 (put) and 11 (get).
