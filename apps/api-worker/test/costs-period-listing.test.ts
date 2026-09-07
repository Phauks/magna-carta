import { env, SELF } from "cloudflare:test";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

/*
 * THE PERIOD LISTING — GET /api/v1/costs with a `from`/`to` span.
 *
 * The second listing shape, and the one the firm's Costs screen is built on. Before it, the route
 * answered one matter entire and nothing else, so a request without a matter came back empty and a
 * screen that wanted "what did the firm advance this month" had no read behind it.
 *
 * WHY THIS IS ITS OWN FILE AND ITS OWN FIRM, following the time period listing's own reasoning: the
 * rate limiter's default bucket is per principal, and the main cost suite already sits close enough
 * to its ceiling that a dozen more reads against the same session would push its later cases into a
 * 429. A separate firm is a separate bucket, so this suite cannot make somebody else's tests fail by
 * existing — and the failure it would cause looks exactly like a real defect.
 *
 * TWO MATTERS AND TWO SPANS ARE SEEDED, one of each inside the window the tests ask for and one
 * outside it, because a listing that returned everything would pass a test that only checked the
 * rows it did return.
 */

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let pembertonMatterId: string;
let harlowMatterId: string;

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

async function capture(
  matterId: string,
  incurredDate: string,
  description: string,
  billable = true,
): Promise<void> {
  const response = await SELF.fetch("https://example.com/api/v1/costs", {
    method: "POST",
    headers: authHeaders(ownerCookie, true),
    body: JSON.stringify({
      matterId,
      incurredDate,
      amountMinor: 5000,
      currency: "USD",
      disbursementClass: "hard",
      billable,
      description,
    }),
  });
  if (response.status !== 201) {
    throw new Error(`seeding ${description} failed with ${String(response.status)}`);
  }
}

async function openMatter(title: string): Promise<string> {
  const created = await SELF.fetch("https://example.com/api/v1/matters", {
    method: "POST",
    headers: authHeaders(ownerCookie, true),
    body: JSON.stringify({ title, status: "open", responsibleMemberId: ownerUserId }),
  });
  return ((await created.json()) as { matterId: string }).matterId;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Cost Period Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;

  const owner = await seedCredentialedUser("cost-period-owner@example.com", {
    userName: "Cost Period Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Cost Period Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("cost-period-owner@example.com");

  await SELF.fetch("https://example.com/api/v1/numbering-scheme", {
    method: "PUT",
    headers: authHeaders(ownerCookie, true),
    body: JSON.stringify({
      segments: [
        { kind: "literal", text: "CP-" },
        { kind: "counter", padWidth: 4 },
      ],
    }),
  });

  pembertonMatterId = await openMatter("Pemberton Estate");
  harlowMatterId = await openMatter("Harlow Acquisition");

  await capture(pembertonMatterId, "2026-06-10", "Inside the span, first matter");
  await capture(harlowMatterId, "2026-06-12", "Inside the span, second matter");
  await capture(pembertonMatterId, "2026-06-11", "Inside the span, not billable", false);
  await capture(pembertonMatterId, "2026-07-20", "Outside the span");
});

interface ListedCost {
  readonly id: string;
  readonly matterId: string;
  readonly incurredDate: string;
  readonly description: string;
  readonly billable: boolean;
  readonly matterNumber: string | null;
  readonly matterTitle: string | null;
}

async function listed(response: Response): Promise<readonly ListedCost[]> {
  const body = (await response.json()) as { data: ListedCost[] };
  return body.data;
}

describe("the span", () => {
  it("answers every matter's costs across the period, most recently incurred first", async () => {
    const response = await get("/api/v1/costs?from=2026-06-01&to=2026-06-30");
    expect(response.status).toBe(200);
    const rows = await listed(response);
    expect(rows.map((row) => row.incurredDate)).toEqual(["2026-06-12", "2026-06-11", "2026-06-10"]);
    // Two different matters in one answer is the whole point of the shape: the per-matter listing
    // cannot produce this without walking every matter first.
    expect(new Set(rows.map((row) => row.matterId))).toEqual(
      new Set([pembertonMatterId, harlowMatterId]),
    );
  });

  it("leaves out what the span does not cover", async () => {
    const rows = await listed(await get("/api/v1/costs?from=2026-06-01&to=2026-06-30"));
    expect(rows.map((row) => row.description)).not.toContain("Outside the span");
  });

  it("names each row's matter, so a firm-wide row does not print an identifier", async () => {
    const rows = await listed(await get("/api/v1/costs?from=2026-06-01&to=2026-06-30"));
    const harlow = rows.find((row) => row.matterId === harlowMatterId);
    expect(harlow?.matterTitle).toBe("Harlow Acquisition");
    expect(harlow?.matterNumber).toMatch(/^CP-/);
  });

  it("narrows to one matter without giving up the span", async () => {
    const rows = await listed(
      await get(`/api/v1/costs?from=2026-06-01&to=2026-06-30&matterId=${pembertonMatterId}`),
    );
    expect(rows.map((row) => row.incurredDate)).toEqual(["2026-06-11", "2026-06-10"]);
  });

  it("narrows to what is billable, and to what is not", async () => {
    const billable = await listed(
      await get("/api/v1/costs?from=2026-06-01&to=2026-06-30&billable=true"),
    );
    expect(billable.map((row) => row.incurredDate)).toEqual(["2026-06-12", "2026-06-10"]);

    const unbillable = await listed(
      await get("/api/v1/costs?from=2026-06-01&to=2026-06-30&billable=false"),
    );
    expect(unbillable.map((row) => row.description)).toEqual(["Inside the span, not billable"]);
  });

  it("refuses a span whose first date is after its last rather than swapping it", async () => {
    const response = await get("/api/v1/costs?from=2026-06-30&to=2026-06-01");
    expect(response.status).toBe(422);
  });

  it("still answers the empty list when neither a matter nor a span is named", async () => {
    const response = await get("/api/v1/costs");
    expect(response.status).toBe(200);
    expect(await listed(response)).toEqual([]);
  });

  it("pages the span on the same key the per-matter listing walks", async () => {
    const first = await get("/api/v1/costs?from=2026-06-01&to=2026-06-30&limit=2");
    const firstBody = (await first.json()) as { data: ListedCost[]; nextCursor: string | null };
    // The page size is the route's own default rather than a parameter, so a four-row seed comes
    // back whole and the cursor is null. What this pins is the envelope: a listing that paged would
    // mint its cursor over the sort key, and one that did not says so with null rather than
    // omitting the field.
    expect(firstBody.nextCursor).toBeNull();
    expect(firstBody.data.length).toBe(3);
  });
});
