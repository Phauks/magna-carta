import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { HttpClient } from "@magna-carta/integrations/http";
import { createApp } from "../src/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  seedFirmKey,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The three reads the register and its window are built on: the firm's shipments newest-first, one
// shipment in full, and whether a postage account is connected at all.
//
// The paging assertions matter more than they look. A register is read while shipments are being
// created, so the page has to be a keyset rather than an offset — and the way that goes wrong is
// silent: rows skipped or repeated as the list moves under the reader, which nobody notices until
// somebody cannot find a parcel they posted.

const ROUTE_BASE = "https://example.com/api/v1";

function fakeEasyPost(): HttpClient {
  return {
    async request() {
      return { status: 404, json: async () => ({}) };
    },
  };
}

const app = createApp({ pluginRuntime: { httpClient: fakeEasyPost() } });

let firmId: FirmId;
let cookie: string;
let keyCounter = 0;

function authedJson(withIdempotencyKey: boolean): Record<string, string> {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(withIdempotencyKey ? { "Idempotency-Key": `ship-read-${keyCounter++}` } : {}),
  };
}

const address = {
  name: "Jane Roe",
  street1: "1 Main St",
  city: "Reno",
  state: "NV",
  zip: "89501",
  country: "US",
};

async function createDraft(recipientName: string): Promise<string> {
  const response = await app.request(
    `${ROUTE_BASE}/shipments`,
    {
      method: "POST",
      headers: authedJson(true),
      body: JSON.stringify({
        from: address,
        to: { ...address, name: recipientName },
        parcel: { weightOz: 8 },
      }),
    },
    env,
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

let firstDraftId: string;

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Register Firm", databaseIdentifier: "DB_FIRM_POOL_1" })).firmId;
  await seedFirmKey(firmId);
  const { userId } = await seedCredentialedUser("register@example.com", {
    userName: "Register User",
    firmId,
  });
  await mirrorMemberWithOwnerRole(userId, "Register User", firmId);
  cookie = await signInForSessionCookie("register@example.com");

  firstDraftId = await createDraft("First Recipient");
  await createDraft("Second Recipient");
  await createDraft("Third Recipient");
});

describe("the shipping register's reads", () => {
  it("reports no connection before one is made, and the connection after", async () => {
    const before = await app.request(
      `${ROUTE_BASE}/integrations/shipping/connection`,
      { method: "GET", headers: authedJson(false) },
      env,
    );
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({ connected: false, status: null });

    const connect = await app.request(
      `${ROUTE_BASE}/integrations/shipping/connection`,
      {
        method: "POST",
        headers: authedJson(true),
        body: JSON.stringify({ apiKey: "ezk-not-a-real-key-for-the-register-read-test" }),
      },
      env,
    );
    expect(connect.status).toBe(201);

    const after = await app.request(
      `${ROUTE_BASE}/integrations/shipping/connection`,
      { method: "GET", headers: authedJson(false) },
      env,
    );
    const state = (await after.json()) as Record<string, unknown>;
    expect(state).toMatchObject({ connected: true, status: "connected", adapterId: "easypost" });
    // Whether an account is connected is not a secret; the key it was connected with is. Nothing
    // about the credential — not the value, not its storage reference — may ride this read.
    expect(JSON.stringify(state)).not.toContain("ezk-not-a-real-key");
    expect(Object.keys(state).sort()).toEqual(["adapterId", "connected", "status"]);
  });

  it("lists the firm's shipments newest first, with the recipient's name", async () => {
    const response = await app.request(
      `${ROUTE_BASE}/shipments`,
      { method: "GET", headers: authedJson(false) },
      env,
    );
    expect(response.status).toBe(200);
    const { data, nextCursor } = (await response.json()) as {
      data: { id: string; recipientName: string | null; status: string }[];
      nextCursor: string | null;
    };
    expect(data).toHaveLength(3);
    expect(data.map((row) => row.recipientName)).toEqual([
      "Third Recipient",
      "Second Recipient",
      "First Recipient",
    ]);
    expect(data.every((row) => row.status === "draft")).toBe(true);
    // Three rows fit a default page, so there is nothing after them. A cursor here would send a
    // reader to an empty page and make the register look like it had more.
    expect(nextCursor).toBeNull();
  });

  it("pages without skipping or repeating a row", async () => {
    const first = await app.request(
      `${ROUTE_BASE}/shipments?pageSize=2`,
      { method: "GET", headers: authedJson(false) },
      env,
    );
    const firstPage = (await first.json()) as {
      data: { id: string }[];
      nextCursor: string | null;
    };
    expect(firstPage.data).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const second = await app.request(
      `${ROUTE_BASE}/shipments?pageSize=2&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
      { method: "GET", headers: authedJson(false) },
      env,
    );
    const secondPage = (await second.json()) as {
      data: { id: string }[];
      nextCursor: string | null;
    };
    expect(secondPage.data).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();

    const seen = [...firstPage.data, ...secondPage.data].map((row) => row.id);
    expect(new Set(seen).size).toBe(3);
  });

  it("refuses a cursor it did not issue rather than silently serving the first page", async () => {
    const response = await app.request(
      `${ROUTE_BASE}/shipments?cursor=not-a-cursor`,
      { method: "GET", headers: authedJson(false) },
      env,
    );
    // A malformed cursor answered with page one reads as the register having reset, which is the
    // one failure a reader cannot tell from real data.
    expect(response.status).toBe(422);
  });

  it("reads one shipment in full, and says whether a label can be fetched", async () => {
    const response = await app.request(
      `${ROUTE_BASE}/shipments/${firstDraftId}`,
      { method: "GET", headers: authedJson(false) },
      env,
    );
    expect(response.status).toBe(200);
    const detail = (await response.json()) as Record<string, unknown>;
    expect(detail).toMatchObject({ id: firstDraftId, status: "draft", hasLabel: false });
    expect(detail.toAddress).toMatchObject({ name: "First Recipient", city: "Reno" });
    expect(detail.parcel).toMatchObject({ weightOz: 8 });
    // The storage key the label lives at is server-recorded and stays server-side; a surface needs
    // to know whether to offer the label, not where it is kept.
    expect(Object.keys(detail)).not.toContain("labelRef");
  });

  it("answers 404 for a shipment this firm does not have", async () => {
    const response = await app.request(
      `${ROUTE_BASE}/shipments/shipment_notarealshipmentidatall`,
      { method: "GET", headers: authedJson(false) },
      env,
    );
    expect(response.status).toBe(404);
  });
});
