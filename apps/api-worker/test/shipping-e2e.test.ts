import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { HttpClient } from "@magna-carta/integrations/http";
import { createApp } from "../src/http/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  seedFirmKey,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// Every buy the fake carrier was asked to perform, in order — the record a double-buy shows up in.
const buyRequests: { url: string; body: unknown }[] = [];

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
        buyRequests.push({
          url: req.url,
          body: req.body === undefined ? undefined : JSON.parse(req.body),
        });
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

// No credential store is injected: this drives the REAL one, over the firm's own
// integration_credential table, so the key is genuinely sealed under the firm key and genuinely
// decrypted through the permission-gated, audited chokepoint on every carrier call. A fake here would
// have proven the adapter and nothing about the seam that kept this subsystem unreachable.
const app = createApp({ pluginRuntime: { httpClient: fakeEasyPost() } });

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
  // The postage credential is sealed under the firm's own data key, so each firm needs one minted —
  // exactly as provisioning mints it. Without this the connect route fails with FirmKeyUnavailable,
  // which is the correct answer for a firm whose key was never minted or has been shredded.
  await seedFirmKey(poolFirmId);
  await seedFirmKey(otherFirmId);
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
          // The firm declares $250 of insurance on the draft; the purchase must actually buy it.
          options: { certifiedMail: true, insuranceAmountMinor: 25000 },
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
    // The declared insurance actually reached the carrier, as its dollar string — a draft that
    // records insurance but never asks for it leaves the firm believing a parcel is covered.
    expect(buyRequests).toHaveLength(1);
    expect(buyRequests[0]?.body).toMatchObject({ insurance: "250.00" });
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

  it("refuses a second purchase of an already-bought shipment, and never re-buys", async () => {
    expect(purchasedShipmentId).toBeDefined();
    const cookie = await signInForSessionCookie("ship@example.com");
    const buysBefore = buyRequests.length;

    // A fresh Idempotency-Key, so nothing replays — this is a genuinely new request against a
    // shipment whose label is already bought and billed.
    const second = await app.request(
      `https://example.com/api/v1/shipments/${purchasedShipmentId}/purchase`,
      {
        method: "POST",
        headers: authedJson(cookie, true),
        body: JSON.stringify({
          remoteShipmentId: "shp_1",
          remoteRateId: "rate_1",
          serviceFeeMinor: 5,
        }),
      },
      env,
    );
    expect(second.status).toBe(409);
    // The point of the guard: the carrier was never asked to sell a second label.
    expect(buyRequests).toHaveLength(buysBefore);
  });

  it("refuses a purchase aimed at a carrier shipment this draft was never rated against", async () => {
    const cookie = await signInForSessionCookie("ship@example.com");
    const base = "https://example.com/api/v1";
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
        body: JSON.stringify({ from: addr, to: addr, parcel: { weightOz: 8 } }),
      },
      env,
    );
    const { id } = (await create.json()) as { id: string };
    const buysBefore = buyRequests.length;

    // No rate call ran for this draft, so no carrier shipment is on file for it. Buying against an
    // id the caller supplied would spend money on another draft's package and addresses.
    const purchase = await app.request(
      `${base}/shipments/${id}/purchase`,
      {
        method: "POST",
        headers: authedJson(cookie, true),
        body: JSON.stringify({
          remoteShipmentId: "shp_someone_elses",
          remoteRateId: "rate_1",
          serviceFeeMinor: 0,
        }),
      },
      env,
    );
    expect(purchase.status).toBe(422);
    expect(buyRequests).toHaveLength(buysBefore);
  });

  it("disconnects and reconnects the postage account", async () => {
    const cookie = await signInForSessionCookie("ship@example.com");
    const base = "https://example.com/api/v1";

    const disconnect = await app.request(
      `${base}/integrations/shipping/connection`,
      { method: "DELETE", headers: authedJson(cookie, true) },
      env,
    );
    expect(disconnect.status).toBe(200);
    expect((await disconnect.json()) as { status: string }).toMatchObject({
      status: "disconnected",
    });

    // With no connection, shipping operations report the account as not connected.
    const disconnected = await app.request(
      `${base}/shipments/${purchasedShipmentId}/tracking`,
      { method: "POST", headers: authedJson(cookie, false) },
      env,
    );
    expect(disconnected.status).toBe(409);

    // Disconnecting twice is a 404, not a second success — there is nothing left to remove.
    const again = await app.request(
      `${base}/integrations/shipping/connection`,
      { method: "DELETE", headers: authedJson(cookie, true) },
      env,
    );
    expect(again.status).toBe(404);

    // Reconnecting with a rotated key must succeed rather than collide with the unique row.
    const reconnect = await app.request(
      `${base}/integrations/shipping/connection`,
      {
        method: "POST",
        headers: authedJson(cookie, true),
        body: JSON.stringify({ apiKey: "ezk_rotated" }),
      },
      env,
    );
    expect(reconnect.status).toBe(201);
    // And a third connect on top of a live connection rotates the key in place, still no collision.
    const rotate = await app.request(
      `${base}/integrations/shipping/connection`,
      {
        method: "POST",
        headers: authedJson(cookie, true),
        body: JSON.stringify({ apiKey: "ezk_rotated_again" }),
      },
      env,
    );
    expect(rotate.status).toBe(201);
    const rotated = (await rotate.json()) as { id: string; status: string };
    expect(rotated.status).toBe("connected");
    expect((await reconnect.json()) as { id: string }).toMatchObject({ id: rotated.id });

    const tracking = await app.request(
      `${base}/shipments/${purchasedShipmentId}/tracking`,
      { method: "POST", headers: authedJson(cookie, false) },
      env,
    );
    expect(tracking.status).toBe(200);
  });
});
