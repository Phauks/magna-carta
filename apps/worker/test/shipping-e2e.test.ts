import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { SecretStore } from "@magna-carta/data-access/firm-secret-credential-store";
import type { HttpClient } from "@magna-carta/integrations/http";
import { createApp } from "../src/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

function memorySecretStore(): SecretStore {
  const map = new Map<string, string>();
  return {
    getSecret: async (ref) => map.get(ref) ?? null,
    putSecret: async (ref, value) => void map.set(ref, value),
  };
}

// A fake EasyPost: rate -> buy -> tracking, routed by URL.
function fakeEasyPost(): HttpClient {
  return {
    async request(req) {
      if (req.url.endsWith("/shipments") && req.method === "POST") {
        return {
          status: 201,
          json: async () => ({
            id: "shp_1",
            rates: [
              { id: "rate_1", carrier: "USPS", service: "Priority", rate: "7.45", currency: "USD" },
            ],
          }),
        };
      }
      if (req.url.includes("/buy")) {
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
      }
      if (req.url.includes("/trackers")) {
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
      }
      return { status: 404, json: async () => ({}) };
    },
  };
}

const secrets = memorySecretStore();
const app = createApp({
  pluginRuntime: { secretStoreForFirm: () => secrets, httpClient: fakeEasyPost() },
});

let poolFirmId: FirmId;
// A second, unrelated firm — the one that must not be able to read the first firm's label.
let otherFirmId: FirmId;
// The purchased shipment, carried from the happy-path test into the cross-firm test below.
let purchasedShipmentId: string | undefined;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Ship Firm", databaseIdentifier: "DB_FIRM_POOL_1" })).firmId;
  otherFirmId = (await seedFirm({ name: "Other Ship Firm", databaseIdentifier: "DB_FIRM_POOL_2" }))
    .firmId;
  // Label bytes live in the firm's own bucket, so each firm needs one recorded. They differ, as
  // provisioning makes them differ; the test pool binds a single bucket that stands in for both.
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = ?2 WHERE id = ?1")
    .bind(poolFirmId, "ship-firm-bucket")
    .run();
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = ?2 WHERE id = ?1")
    .bind(otherFirmId, "other-ship-firm-bucket")
    .run();
  // The purchase route copies the label bytes from EasyPost's transient URL into R2 via global fetch;
  // stub it to return a minimal PDF. SELF.fetch (sign-in) dispatches to the worker, not global fetch.
  globalThis.fetch = (async () =>
    new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 })) as typeof fetch; // "%PDF"
});

let keyCounter = 0;
function authedJson(cookie: string, withIdempotencyKey: boolean): Record<string, string> {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(withIdempotencyKey ? { "Idempotency-Key": `ship-e2e-${keyCounter++}` } : {}),
  };
}

describe("shipping e2e", () => {
  it("connect -> create -> rate -> purchase -> label -> tracking", async () => {
    const { userId } = await seedCredentialedUser("ship@example.com", {
      userName: "Ship User",
      firmId: poolFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Ship User", poolFirmId);
    const cookie = await signInForSessionCookie("ship@example.com");
    const base = "https://example.com/api/v1";

    const connect = await app.request(
      `${base}/integrations/shipping/connection`,
      {
        method: "POST",
        headers: authedJson(cookie, true),
        body: JSON.stringify({ apiKey: "ezk_test" }),
      },
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
        headers: authedJson(cookie, true),
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
      { method: "POST", headers: authedJson(cookie, false) },
      env,
    );
    expect(rates.status).toBe(200);
    const rated = (await rates.json()) as {
      remoteShipmentId: string;
      rates: { remoteId: string }[];
    };
    expect(rated.rates.length).toBeGreaterThan(0);

    const purchase = await app.request(
      `${base}/shipments/${id}/purchase`,
      {
        method: "POST",
        headers: authedJson(cookie, true),
        body: JSON.stringify({
          remoteShipmentId: rated.remoteShipmentId,
          remoteRateId: rated.rates[0]?.remoteId,
          serviceFeeMinor: 5,
        }),
      },
      env,
    );
    expect(purchase.status).toBe(200);
    expect((await purchase.json()) as { trackingCode: string }).toMatchObject({
      trackingCode: "9400111",
    });
    // Handed to the cross-firm test below, which asks whether another firm can read this label.
    purchasedShipmentId = id;

    const label = await app.request(
      `${base}/shipments/${id}/label`,
      { method: "GET", headers: { cookie } },
      env,
    );
    expect(label.status).toBe(200);
    expect(label.headers.get("content-type")).toBe("application/pdf");

    // The stored object is keyed under the owning firm, so no two firms can ever name one label.
    expect(await env.R2.get(`labels/${poolFirmId}/${id}.pdf`)).not.toBeNull();

    const tracking = await app.request(
      `${base}/shipments/${id}/tracking`,
      { method: "POST", headers: authedJson(cookie, false) },
      env,
    );
    expect(tracking.status).toBe(200);
    expect(((await tracking.json()) as { events: unknown[] }).events.length).toBeGreaterThan(0);
  });

  it("refuses another firm's shipment label", async () => {
    expect(purchasedShipmentId).toBeDefined();
    // A member of a different firm, with the shipping permission in their OWN firm — the permission
    // is not the question; whether the label belongs to their firm is.
    const { userId } = await seedCredentialedUser("outsider@example.com", {
      userName: "Outsider",
      firmId: otherFirmId,
    });
    await mirrorMemberWithOwnerRole(userId, "Outsider", otherFirmId);
    const cookie = await signInForSessionCookie("outsider@example.com");

    // Plant bytes at the key a read path would derive straight from the URL parameter. The answer
    // must still be 404: ownership is proved by finding the label row in the CALLER's own firm
    // database, never by an object happening to exist under a derivable key.
    await env.R2.put(
      `labels/${purchasedShipmentId ?? ""}.pdf`,
      new TextEncoder().encode("%PDF-1.4 another firm's label"),
    );

    const label = await app.request(
      `https://example.com/api/v1/shipments/${purchasedShipmentId}/label`,
      { method: "GET", headers: { cookie } },
      env,
    );
    // 404, not 403: a shipment outside the caller's firm does not exist as far as they are
    // concerned, and a distinguishable refusal would confirm the id names something real.
    expect(label.status).toBe(404);
    expect(label.headers.get("content-type")).toContain("application/problem+json");
    // Nothing of the other firm's label came back.
    expect(await label.text()).not.toContain("%PDF");
  });
});
