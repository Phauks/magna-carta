import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { ShipmentId } from "@magna-carta/identifiers/types";
import { runScheduledSweep } from "../../src/background/scheduled.ts";
import {
  perFirmQueue,
  type PerFirmQueueMessage,
} from "../../src/background/costs/recoverable-charge-consumer.ts";
import { firmDatabaseFor } from "../../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "../support/apply-control-plane-migrations.ts";
import {
  captureResetToken,
  liveCookie,
  PASSWORD,
  postJson,
  setCookies,
  signIn,
} from "../support/test-auth.ts";

// The capstone: one costs/disbursement journey over the REAL HTTP surface (SELF fetch) and the REAL
// per-firm queue consumer, as a sequence of `it` steps over module-level state. A firm is provisioned,
// its owner activated, a matter created; then the slice composes: a manual capture to draft, the
// review-gate lifecycle (submit -> approve) under an opted-in firm, a bulk grid batch, a receipt
// attach, the shipping cost-recovery seam (a shipment.purchased event minting a postage disbursement,
// the firm policy gating whether the platform service fee is also recovered, a null-matter shipment
// minting nothing), and the freeze seam (a billed row refusing a draft update). Money is integer-minor
// throughout. The consumer is invoked directly with a fake MessageBatch exactly as production's queue()
// branch routes it (Miniflare cannot deliver real relay sends).

interface ProvisionResponseBody {
  id: string;
  name: string;
  status: string;
  owner: { id: string; email: string; name: string };
}

const FIRM_INPUT = {
  name: "Costs Capstone Firm",
  owner: { email: "costs-capstone-owner@example.com", name: "Costs Capstone Owner" },
};

const SHIPPING_SERVICE_FEE_SETTING_KEY = "cost.recover_platform_fee.shipping_service_fee";
const APPROVAL_REQUIRED_SETTING_KEY = "billing.approval_required";
const TS = "2026-06-26T12:00:00.000Z";

let firm: ProvisionResponseBody;
let ownerCookie = "";
let matterId = "";
let vendorId = "";
let manualCostId = "";

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

function authHeaders(): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie: ownerCookie,
    "Idempotency-Key": crypto.randomUUID(),
  };
}

async function post(path: string, body: unknown, idempotencyKey?: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": idempotencyKey ?? crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

async function patch(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
}

async function get(path: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie: ownerCookie },
  });
}

// Writes a firm setting into the per-firm `setting` table the same way the costs routes read it
// (readFirmSetting): canonical-JSON value, upserted by key. The provisioned firm's per-firm data lives
// in its FirmDatabase Durable Object, addressed by firm.id — the same store the worker resolves.
async function setFirmSetting(key: string, value: string): Promise<void> {
  await firmDatabaseFor(env.FIRM_DATABASE, firm.id)
    .prepare(
      "INSERT INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key, value, TS)
    .run();
}

// Seeds a purchased shipment row. The adapter reads only matter_ref back from it (the amounts ride the
// queue payload), but the row carries the NOT-NULL columns so the insert is valid.
async function seedShipment(shipmentId: string, matterRef: string | null): Promise<void> {
  await firmDatabaseFor(env.FIRM_DATABASE, firm.id)
    .prepare(
      "INSERT INTO shipment (id, matter_ref, status, from_address, to_address, parcel, options, postage_cost_minor, service_fee_minor, currency, created_at, updated_at) VALUES (?1, ?2, 'purchased', '{}', '{}', '{}', '{}', ?3, ?4, 'USD', ?5, ?5)",
    )
    .bind(shipmentId, matterRef, 1299, 150, TS)
    .run();
}

function purchasedMessage(shipmentId: string): PerFirmQueueMessage {
  return {
    id: `outbox_${shipmentId}`,
    firmId: firm.id,
    topic: "shipment.purchased",
    payload: JSON.stringify({
      shipmentId,
      postageCostMinor: 1299,
      serviceFeeMinor: 150,
      currency: "USD",
    }),
    aggregateKey: null,
    seq: null,
  };
}

// A fake MessageBatch over the per-firm queue, capturing ack()/retry() so the journey can assert the
// terminal disposition without a real queue.
function makeBatch(message: PerFirmQueueMessage) {
  const acks: string[] = [];
  const retries: string[] = [];
  const batch = {
    queue: "magna-carta-production-platform-jobs",
    messages: [
      {
        id: message.id,
        timestamp: new Date(),
        attempts: 1,
        body: message,
        ack: () => acks.push(message.id),
        retry: () => retries.push(message.id),
      },
    ],
  } as unknown as MessageBatch<PerFirmQueueMessage>;
  return { batch, acks, retries };
}

interface CostRow {
  recovery_category: string | null;
  disbursement_class: string;
  billable: number;
  recovery_ref: string | null;
  amount_minor: number;
  source: string;
  matter_id: string;
}

async function recoveryRowsForShipment(shipmentId: string): Promise<CostRow[]> {
  const { results } = await firmDatabaseFor(env.FIRM_DATABASE, firm.id)
    .prepare(
      "SELECT recovery_category, disbursement_class, billable, recovery_ref, amount_minor, source, matter_id FROM cost_entry WHERE recovery_ref LIKE ?1 ORDER BY recovery_ref",
    )
    .bind(`${shipmentId}:%`)
    .all<CostRow>();
  return results;
}

interface CostSummary {
  id: string;
  matterId: string;
  vendorId: string | null;
  amountMinor: number;
  disbursementClass: string;
  billable: boolean;
  status: string;
  source: string;
}

describe("costs end-to-end", () => {
  it("provisions a firm, activates its owner, and creates a matter", async () => {
    const provisionResponse = await SELF.fetch("https://example.com/api/v1/firms", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Platform-Admin-Key": env.PLATFORM_ADMIN_KEY,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(FIRM_INPUT),
    });
    expect(provisionResponse.status).toBe(201);
    firm = (await provisionResponse.json()) as ProvisionResponseBody;
    expect(firm.status).toBe("active");

    const { token } = await captureResetToken(FIRM_INPUT.owner.email);
    expect(
      (await postJson("/api/auth/reset-password", { newPassword: PASSWORD, token })).status,
    ).toBe(200);
    const signInResponse = await signIn(FIRM_INPUT.owner.email);
    expect(signInResponse.status).toBe(200);
    ownerCookie = liveCookie(setCookies(signInResponse), "session_token")?.pair ?? "";
    expect(ownerCookie).not.toBe("");
    const report = await runScheduledSweep(env);
    expect(report.controlPlane.failed).toBe(0);

    // A numbering scheme is required before an open (numbered) matter can be created.
    const schemeResponse = await SELF.fetch("https://example.com/api/v1/numbering-scheme", {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({
        segments: [
          { kind: "literal", text: "CC-" },
          { kind: "counter", padWidth: 4 },
        ],
      }),
    });
    expect(schemeResponse.status).toBe(200);

    const matterResponse = await post("/api/v1/matters", {
      title: "Costs Capstone Matter",
      status: "open",
      responsibleMemberId: firm.owner.id,
    });
    expect(matterResponse.status).toBe(201);
    matterId = ((await matterResponse.json()) as { matterId: string }).matterId;
    expect(matterId).toMatch(/^matter_/);
  });

  it("captures a manual hard, billable disbursement as draft and persists it", async () => {
    // vendor_id is a bare nullable Directory-entity reference (no FK), so a minted directory id models
    // a vendor on the disbursement without standing up a Directory organization.
    vendorId = newIdentifier("directory");
    const createResponse = await post("/api/v1/costs", {
      matterId,
      vendorId,
      incurredDate: "2026-06-26",
      amountMinor: 4200,
      currency: "USD",
      disbursementClass: "hard",
      billable: true,
      description: "Certified mail to opposing counsel",
    });
    expect(createResponse.status).toBe(201);
    manualCostId = ((await createResponse.json()) as { costEntryId: string }).costEntryId;
    expect(manualCostId).toMatch(/^costEntry_/);

    const getResponse = await get(`/api/v1/costs/${manualCostId}`);
    expect(getResponse.status).toBe(200);
    const summary = (await getResponse.json()) as CostSummary;
    expect(summary).toMatchObject({
      matterId,
      vendorId,
      amountMinor: 4200,
      disbursementClass: "hard",
      billable: true,
      status: "draft",
      source: "manual",
    });
    expect(Number.isInteger(summary.amountMinor)).toBe(true);
  });

  it("advances the draft through the review gate: submit then approve", async () => {
    // Opt the firm into the billing review gate; submit is only legal when the gate is on.
    await setFirmSetting(APPROVAL_REQUIRED_SETTING_KEY, "true");

    const submitResponse = await post(`/api/v1/costs/${manualCostId}/submit`, {});
    expect(submitResponse.status).toBe(200);
    let summary = (await (await get(`/api/v1/costs/${manualCostId}`)).json()) as CostSummary;
    expect(summary.status).toBe("submitted");

    const approveResponse = await post(`/api/v1/costs/${manualCostId}/approve`, {});
    expect(approveResponse.status).toBe(200);
    summary = (await (await get(`/api/v1/costs/${manualCostId}`)).json()) as CostSummary;
    expect(summary.status).toBe("approved");
  });

  it("captures a bulk grid batch in one write", async () => {
    const row = (amountMinor: number, klass: "hard" | "soft") => ({
      matterId,
      incurredDate: "2026-06-26",
      amountMinor,
      currency: "USD",
      disbursementClass: klass,
      billable: true,
      description: "Bulk-entered disbursement",
    });
    const batchResponse = await post("/api/v1/costs/batch", {
      rows: [row(150, "hard"), row(875, "soft"), row(300, "hard")],
    });
    expect(batchResponse.status).toBe(201);
    const { costEntryIds } = (await batchResponse.json()) as { costEntryIds: string[] };
    expect(costEntryIds).toHaveLength(3);

    // The grid source is set server-side, not from the request body.
    const { results } = await firmDatabaseFor(env.FIRM_DATABASE, firm.id)
      .prepare(
        "SELECT source, amount_minor FROM cost_entry WHERE id IN (?1, ?2, ?3) ORDER BY amount_minor",
      )
      .bind(costEntryIds[0], costEntryIds[1], costEntryIds[2])
      .all<{ source: string; amount_minor: number }>();
    expect(results.map((r) => r.source)).toEqual(["grid", "grid", "grid"]);
    expect(results.map((r) => r.amount_minor)).toEqual([150, 300, 875]);
  });

  it("attaches a receipt file to a draft cost", async () => {
    // A fresh draft to attach to (the manual cost is already approved/frozen for new draft edits).
    const fileId = newIdentifier("file");
    const created = await post("/api/v1/costs", {
      matterId,
      incurredDate: "2026-06-26",
      amountMinor: 999,
      currency: "USD",
      disbursementClass: "soft",
      billable: false,
      description: "Filing fee with receipt",
    });
    const costId = ((await created.json()) as { costEntryId: string }).costEntryId;

    const attachResponse = await post(`/api/v1/costs/${costId}/receipt`, { fileId });
    expect(attachResponse.status).toBe(200);

    const { results } = await firmDatabaseFor(env.FIRM_DATABASE, firm.id)
      .prepare("SELECT receipt_file_id FROM cost_entry WHERE id = ?1")
      .bind(costId)
      .all<{ receipt_file_id: string | null }>();
    expect(results[0]?.receipt_file_id).toBe(fileId);
  });

  it("recovers only the postage disbursement from a shipment.purchased while the fee policy is off", async () => {
    const shipmentId = newIdentifier("shipment") as ShipmentId;
    await seedShipment(shipmentId, matterId);

    const { batch, acks, retries } = makeBatch(purchasedMessage(shipmentId));
    await perFirmQueue(batch, env);

    const rows = await recoveryRowsForShipment(shipmentId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recovery_category: "postage",
      disbursement_class: "hard",
      billable: 1,
      recovery_ref: `${shipmentId}:postage`,
      amount_minor: 1299,
      source: "recovery",
      matter_id: matterId,
    });
    expect(acks).toEqual([`outbox_${shipmentId}`]);
    expect(retries).toEqual([]);
  });

  it("also recovers the platform service fee once the firm opts the policy on", async () => {
    await setFirmSetting(SHIPPING_SERVICE_FEE_SETTING_KEY, "true");
    const shipmentId = newIdentifier("shipment") as ShipmentId;
    await seedShipment(shipmentId, matterId);

    await perFirmQueue(makeBatch(purchasedMessage(shipmentId)).batch, env);

    const rows = await recoveryRowsForShipment(shipmentId);
    expect(rows.map((r) => r.recovery_category)).toEqual(["postage", "shipping_service_fee"]);
    expect(rows.find((r) => r.recovery_category === "shipping_service_fee")).toMatchObject({
      recovery_ref: `${shipmentId}:shipping_service_fee`,
      disbursement_class: "hard",
      billable: 1,
      amount_minor: 150,
      source: "recovery",
    });
  });

  it("recovers nothing from a firm-administrative shipment with no matter", async () => {
    const shipmentId = newIdentifier("shipment") as ShipmentId;
    await seedShipment(shipmentId, null);

    await perFirmQueue(makeBatch(purchasedMessage(shipmentId)).batch, env);

    expect(await recoveryRowsForShipment(shipmentId)).toHaveLength(0);
  });

  it("freezes a billed cost against a draft update (409)", async () => {
    // No costs route sets status='billed' (that is the future billing slice's bill action); drive the
    // approved cost to billed directly to exercise the freeze guard the WIP store enforces.
    await firmDatabaseFor(env.FIRM_DATABASE, firm.id)
      .prepare("UPDATE cost_entry SET status = 'billed', updated_at = ?2 WHERE id = ?1")
      .bind(manualCostId, TS)
      .run();

    const patchResponse = await patch(`/api/v1/costs/${manualCostId}`, { amountMinor: 5000 });
    expect(patchResponse.status).toBe(409);

    // The frozen row's business columns are unchanged.
    const { results } = await firmDatabaseFor(env.FIRM_DATABASE, firm.id)
      .prepare("SELECT amount_minor, status FROM cost_entry WHERE id = ?1")
      .bind(manualCostId)
      .all<{ amount_minor: number; status: string }>();
    expect(results[0]).toMatchObject({ amount_minor: 4200, status: "billed" });
  });
});
