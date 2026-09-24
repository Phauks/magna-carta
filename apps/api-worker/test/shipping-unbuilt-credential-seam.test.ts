import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import type { HttpClient } from "@magna-carta/integrations/http";
import { createApp } from "../src/http/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  readJson,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";
import type { ProblemBody } from "../src/http/contracts/problem.ts";

// The shipping surface with NO secret store injected — the production wiring, where the per-firm
// credential read is still a seam. shipping-e2e.test.ts injects an in-memory store and therefore
// never exercises this path, which is how the sequence below survived: a draft is accepted, and the
// first call that needs a carrier is where the member learns nothing can be bought.
//
// An http client is still supplied so a reached carrier would answer; the point is that none of
// these requests ever reach it.
const unreachedCarrier: HttpClient = {
  request: async () => {
    throw new Error("the carrier must not be reached with no credential read wired");
  },
};

const app = createApp({ pluginRuntime: { httpClient: unreachedCarrier } });

let firmId: FirmId;
let cookie: string;

const address = {
  name: "Jane",
  street1: "1 Main St",
  city: "Reno",
  state: "NV",
  zip: "89501",
  country: "US",
};

let keyCounter = 0;
function authedJson(withIdempotencyKey: boolean): Record<string, string> {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(withIdempotencyKey ? { "Idempotency-Key": `ship-seam-${keyCounter++}` } : {}),
  };
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Seam Firm", databaseIdentifier: "DB_FIRM_POOL_1" })).firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = ?2 WHERE id = ?1")
    .bind(firmId, "seam-firm-bucket")
    .run();
  const { userId } = await seedCredentialedUser("seam@example.com", {
    userName: "Seam User",
    firmId,
  });
  await mirrorMemberWithOwnerRole(userId, "Seam User", firmId);
  cookie = await signInForSessionCookie("seam@example.com");
});

const base = "https://example.com/api/v1";

describe("shipping with the per-firm credential read unbuilt", () => {
  it("refuses to connect a postage account, in a shape a surface can render", async () => {
    const connect = await app.request(
      `${base}/integrations/shipping/connection`,
      {
        method: "POST",
        headers: authedJson(true),
        body: JSON.stringify({ apiKey: "ezk_test" }),
      },
      env,
    );
    // The first thing a member does is the first thing that has to answer honestly. A 500 here is
    // the platform telling somebody their key was wrong.
    expect(connect.status).toBe(501);
    expect(connect.headers.get("content-type")).toContain("application/problem+json");
    const problem = (await connect.json()) as { type: string; detail?: string };
    expect(problem.type).toContain("not-implemented");
    // Never "connect your account" — that is the very thing being refused.
    expect(problem.detail ?? "").not.toContain("Connect the firm");
  });

  it("still accepts a draft, because a draft needs no carrier", async () => {
    const create = await app.request(
      `${base}/shipments`,
      {
        method: "POST",
        headers: authedJson(true),
        body: JSON.stringify({ from: address, to: address, parcel: { weightOz: 8 } }),
      },
      env,
    );
    expect(create.status).toBe(201);
  });

  it("refuses rate, purchase, tracking and refund as a typed absence rather than a 500", async () => {
    const create = await app.request(
      `${base}/shipments`,
      {
        method: "POST",
        headers: authedJson(true),
        body: JSON.stringify({ from: address, to: address, parcel: { weightOz: 8 } }),
      },
      env,
    );
    expect(create.status).toBe(201);
    const { id } = (await create.json()) as { id: string };

    const rates = await app.request(
      `${base}/shipments/${id}/rates`,
      { method: "POST", headers: authedJson(false) },
      env,
    );
    // The defect: this was a 500 with an Error ID, so a member who had already committed to a
    // shipment was told the platform had broken rather than told what it cannot do.
    expect(rates.status).toBe(501);
    expect(rates.headers.get("content-type")).toContain("application/problem+json");
    expect((await readJson<ProblemBody>(rates)).type).toContain("not-implemented");

    const purchase = await app.request(
      `${base}/shipments/${id}/purchase`,
      {
        method: "POST",
        headers: authedJson(true),
        body: JSON.stringify({
          remoteShipmentId: "shp_1",
          remoteRateId: "rate_1",
          serviceFeeMinor: 0,
        }),
      },
      env,
    );
    expect(purchase.status).toBe(501);

    const refund = await app.request(
      `${base}/shipments/${id}/refund`,
      { method: "POST", headers: authedJson(true) },
      env,
    );
    // Refund and tracking both read the draft first and answer 404 on a shipment with no carrier
    // shipment id and no tracking code — which every draft is here, because nothing can be bought.
    // They are asserted so the sequence is recorded whole: no path in this surface reaches a 500.
    expect(refund.status).toBe(404);

    const tracking = await app.request(
      `${base}/shipments/${id}/tracking`,
      { method: "POST", headers: authedJson(false) },
      env,
    );
    expect(tracking.status).toBe(404);
  });
});
