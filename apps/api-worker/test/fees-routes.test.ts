import { env, SELF } from "cloudflare:test";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

/*
 * THE FEE ROUTES — the store a recorded charge lives in, and both shapes over it.
 *
 * A fee is a flat charge for professional services, typed by hand. It is NEVER computed from time
 * entries: an hourly matter's fee value is the time ledger's and a flat-fee arrangement's amount is
 * the arrangement's, so what these routes hold is the third thing neither of those covers.
 *
 * ITS OWN FIRM, following the cost and time period suites: the rate limiter's default bucket is per
 * principal, so a suite that shares a session with another one can push that one's later cases into
 * a 429 — a failure that looks exactly like a real defect.
 */

const OWNER_DISPLAY_NAME = "Fee Suite Owner";

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let pembertonMatterId: string;
let harlowMatterId: string;
let firmDatabase: ReturnType<typeof firmDatabaseFor>;

function authHeaders(cookie: string, withKey = false): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie,
    ...(withKey ? { "Idempotency-Key": crypto.randomUUID() } : {}),
  };
}

async function get(path: string, cookie = ownerCookie): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie },
  });
}

async function post(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: authHeaders(ownerCookie, true),
    body: JSON.stringify(body),
  });
}

async function patch(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PATCH",
    headers: authHeaders(ownerCookie, true),
    body: JSON.stringify(body),
  });
}

async function remove(path: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "DELETE",
    headers: authHeaders(ownerCookie, true),
  });
}

async function record(
  matterId: string,
  serviceDate: string,
  description: string,
  billable = true,
  amountMinor = 50_000,
): Promise<string> {
  const response = await post("/api/v1/fees", {
    matterId,
    serviceDate,
    timekeeperUserId: ownerUserId,
    description,
    amountMinor,
    currency: "USD",
    billable,
  });
  if (response.status !== 201) {
    throw new Error(`seeding ${description} failed with ${String(response.status)}`);
  }
  return ((await response.json()) as { feeEntryId: string }).feeEntryId;
}

async function openMatter(title: string): Promise<string> {
  const created = await SELF.fetch("https://example.com/api/v1/matters", {
    method: "POST",
    headers: authHeaders(ownerCookie, true),
    body: JSON.stringify({ title, status: "open", responsibleMemberId: ownerUserId }),
  });
  return ((await created.json()) as { matterId: string }).matterId;
}

interface ListedFee {
  readonly id: string;
  readonly matterId: string;
  readonly serviceDate: string;
  readonly description: string;
  readonly amountMinor: number;
  readonly billable: boolean;
  readonly status: string;
  readonly kickBackReason: string | null;
  readonly timekeeperName: string | null;
  readonly createdByName: string | null;
  readonly createdAt: string;
  readonly matterNumber: string | null;
  readonly matterTitle: string | null;
}

async function listed(response: Response): Promise<readonly ListedFee[]> {
  const body = (await response.json()) as { data: ListedFee[] };
  return body.data;
}

// The firm's review setting is not on the contract, so the suite writes it directly — through the
// Durable Object proxy every statement module resolves a firm's database with, never a binding.
async function setReviewGate(value: string): Promise<void> {
  await firmDatabase
    .prepare(
      "INSERT INTO setting (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind("billing.approval_required", value, new Date().toISOString())
    .run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Fee Suite Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, poolFirmId);

  const owner = await seedCredentialedUser("fee-suite-owner@example.com", {
    userName: OWNER_DISPLAY_NAME,
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, OWNER_DISPLAY_NAME, poolFirmId);
  ownerCookie = await signInForSessionCookie("fee-suite-owner@example.com");

  // A matter cannot be opened until a numbering scheme exists.
  await SELF.fetch("https://example.com/api/v1/numbering-scheme", {
    method: "PUT",
    headers: authHeaders(ownerCookie, true),
    body: JSON.stringify({
      segments: [
        { kind: "literal", text: "FEE-" },
        { kind: "counter", padWidth: 4 },
      ],
    }),
  });

  pembertonMatterId = await openMatter("Pemberton Estate");
  harlowMatterId = await openMatter("Harlow Acquisition");
});

describe("recording a fee", () => {
  it("stores the amount exactly as given and reads it back with every name resolved", async () => {
    const id = await record(pembertonMatterId, "2026-07-10", "Settlement agreement, drafting");

    const body = (await (await get(`/api/v1/fees/${id}`)).json()) as ListedFee;
    // The amount is what somebody decided to charge — nothing multiplies anything here.
    expect(body.amountMinor).toBe(50_000);
    expect(body.status).toBe("draft");
    // The three names resolved beside the record rather than by a read per row.
    expect(body.timekeeperName).toBe(OWNER_DISPLAY_NAME);
    expect(body.createdByName).toBe(OWNER_DISPLAY_NAME);
    expect(body.matterTitle).toBe("Pemberton Estate");
    expect(body.matterNumber).toMatch(/^FEE-/);
    // The two dates are different facts, and only both together say when the charge was captured.
    expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.createdAt.slice(0, 10)).not.toBe(body.serviceDate);
  });

  it("refuses a charge of nothing", async () => {
    const response = await post("/api/v1/fees", {
      matterId: pembertonMatterId,
      serviceDate: "2026-07-11",
      description: "A charge of nothing",
      amountMinor: 0,
      currency: "USD",
      billable: true,
    });
    // The contract's own `positive()` catches this before the service does; either way it is a 422.
    expect(response.status).toBe(422);
  });
});

describe("the two listing shapes", () => {
  it("answers one matter entire, in every status", async () => {
    const rows = await listed(await get(`/api/v1/fees?matterId=${harlowMatterId}`));
    // Seeded below in the span case; this one asserts the shape answers at all for its matter.
    expect(rows.every((row) => row.matterId === harlowMatterId)).toBe(true);
  });

  it("answers a span across every matter, most recent service date first", async () => {
    await record(pembertonMatterId, "2026-08-03", "Inside the span, first matter");
    await record(harlowMatterId, "2026-08-05", "Inside the span, second matter");
    await record(pembertonMatterId, "2026-08-04", "Inside the span, absorbed", false);
    await record(pembertonMatterId, "2026-09-20", "Outside the span");

    const rows = await listed(await get("/api/v1/fees?from=2026-08-01&to=2026-08-31"));
    expect(rows.map((row) => row.serviceDate)).toEqual(["2026-08-05", "2026-08-04", "2026-08-03"]);
    // Two matters in one answer is the whole point of the shape.
    expect(new Set(rows.map((row) => row.matterId))).toEqual(
      new Set([pembertonMatterId, harlowMatterId]),
    );
    expect(rows.map((row) => row.description)).not.toContain("Outside the span");
  });

  it("narrows a span to what is billable, and to what is not", async () => {
    const billable = await listed(
      await get("/api/v1/fees?from=2026-08-01&to=2026-08-31&billable=true"),
    );
    expect(billable.map((row) => row.serviceDate)).toEqual(["2026-08-05", "2026-08-03"]);

    const absorbed = await listed(
      await get("/api/v1/fees?from=2026-08-01&to=2026-08-31&billable=false"),
    );
    expect(absorbed.map((row) => row.description)).toEqual(["Inside the span, absorbed"]);
  });

  it("refuses a span whose first date is after its last rather than swapping it", async () => {
    expect((await get("/api/v1/fees?from=2026-08-31&to=2026-08-01")).status).toBe(422);
  });

  it("answers empty when neither a matter nor a span is named", async () => {
    const response = await get("/api/v1/fees");
    expect(response.status).toBe(200);
    expect(await listed(response)).toEqual([]);
  });
});

describe("the chain, over HTTP", () => {
  it("carries a reviewer's reason back to draft and clears it on the next submission", async () => {
    await setReviewGate("true");
    const id = await record(pembertonMatterId, "2026-07-20", "Sent back once");

    expect((await post(`/api/v1/fees/${id}/submit`, {})).status).toBe(200);
    expect(
      (await post(`/api/v1/fees/${id}/kick-back`, { reason: "This is the Harlow engagement." }))
        .status,
    ).toBe(200);

    const returned = (await (await get(`/api/v1/fees/${id}`)).json()) as ListedFee;
    expect(returned.status).toBe("draft");
    expect(returned.kickBackReason).toBe("This is the Harlow engagement.");

    expect((await post(`/api/v1/fees/${id}/submit`, {})).status).toBe(200);
    const resent = (await (await get(`/api/v1/fees/${id}`)).json()) as ListedFee;
    expect(resent.status).toBe("submitted");
    expect(resent.kickBackReason).toBeNull();

    await setReviewGate("false");
  });

  it("freezes a voided fee against every further act", async () => {
    const id = await record(pembertonMatterId, "2026-07-21", "Withdrawn");
    expect((await post(`/api/v1/fees/${id}/void`, {})).status).toBe(200);

    // A withdrawn charge stays on the ledger and nothing moves it afterwards.
    expect((await patch(`/api/v1/fees/${id}`, { description: "edited" })).status).toBe(409);
    expect((await post(`/api/v1/fees/${id}/void`, {})).status).toBe(409);
  });
});

describe("deleting a draft, which is not voiding it", () => {
  it("removes a draft nobody has seen", async () => {
    const id = await record(pembertonMatterId, "2026-07-22", "Typed by mistake");
    expect((await remove(`/api/v1/fees/${id}`)).status).toBe(200);
    expect((await get(`/api/v1/fees/${id}`)).status).toBe(404);
  });

  it("refuses anything that entered review, which is voided instead", async () => {
    await setReviewGate("true");
    const id = await record(pembertonMatterId, "2026-07-23", "Already submitted");
    expect((await post(`/api/v1/fees/${id}/submit`, {})).status).toBe(200);

    // The record somebody may be asked to account for is never deleted.
    expect((await remove(`/api/v1/fees/${id}`)).status).toBe(409);
    expect((await get(`/api/v1/fees/${id}`)).status).toBe(200);

    await setReviewGate("false");
  });
});

describe("an unknown fee", () => {
  it("is a 404 on the read and on every act", async () => {
    const phantom = "feeEntry_000000000000000000000";
    expect((await get(`/api/v1/fees/${phantom}`)).status).toBe(404);
    expect((await post(`/api/v1/fees/${phantom}/void`, {})).status).toBe(404);
  });
});
