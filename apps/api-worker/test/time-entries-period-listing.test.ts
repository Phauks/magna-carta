import { env, SELF } from "cloudflare:test";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { appendRate, createRateCard } from "@magna-carta/timekeeping/rate-service";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { beforeAll, describe, expect, it } from "vitest";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

/*
 * THE PERIOD LISTING — GET /api/v1/time-entries with a `from`/`to` span.
 *
 * The third listing shape, and the one the firm-wide time surface is built on. Before it, the route
 * answered one timekeeper on one day or one matter entire, and a request for a span came back empty
 * — so a screen that wanted "what time was recorded this week" had no read behind it.
 *
 * WHY THIS IS ITS OWN FILE AND ITS OWN FIRM. The rate limiter's default bucket is a hundred
 * requests a minute per principal, and the main time-entry suite already sits close enough to that
 * ceiling that eight more reads against the same session pushed three of its later cases into a 429.
 * A separate firm is a separate bucket, so this suite cannot make somebody else's tests fail by
 * existing — and the failure it would have caused looks exactly like a real defect, which is the
 * worst kind of shared state.
 *
 * TWO SPANS ARE SEEDED, ONE INSIDE THE WINDOW THE TESTS ASK FOR AND ONE OUTSIDE IT, because a
 * listing that returned everything would pass a test that only checked the rows it did return.
 */

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let colleagueCookie: string;
let colleagueUserId: UserId;
let matterId: string;

const clock = { now: () => new Date().toISOString() };

/** A member with one direct-grant permission and no role — a timekeeper without time:viewFirm. */
async function mirrorMemberWithDirectGrant(
  userId: UserId,
  displayName: string,
  permission: string,
): Promise<void> {
  await insertMemberStatement(firmDatabaseFor(env.FIRM_DATABASE, poolFirmId), {
    userId,
    displayName,
    now: new Date().toISOString(),
  }).run();
  await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
    .prepare(
      "INSERT INTO direct_grant (id, member_user_id, permission, granted_by, expires_at, created_at) VALUES (?1, ?2, ?3, ?2, NULL, ?4)",
    )
    .bind(newIdentifier("grant"), userId, permission, new Date().toISOString())
    .run();
}

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
  workDate: string,
  narrative: string,
  cookie: string,
  timekeeperUserId: UserId,
): Promise<void> {
  const response = await SELF.fetch("https://example.com/api/v1/time-entries", {
    method: "POST",
    headers: authHeaders(cookie, true),
    body: JSON.stringify({
      matterId,
      timekeeperUserId,
      workDate,
      rawDurationMinutes: 60,
      narrative,
      billable: true,
      source: "manual",
    }),
  });
  if (response.status !== 201) {
    throw new Error(`seeding ${narrative} failed with ${String(response.status)}`);
  }
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Time Period Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;

  const owner = await seedCredentialedUser("period-owner@example.com", {
    userName: "Period Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Period Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("period-owner@example.com");

  const colleague = await seedCredentialedUser("period-colleague@example.com", {
    userName: "Period Colleague",
    firmId: poolFirmId,
  });
  colleagueUserId = colleague.userId;
  await mirrorMemberWithDirectGrant(colleague.userId, "Period Colleague", "time:track");
  colleagueCookie = await signInForSessionCookie("period-colleague@example.com");

  await SELF.fetch("https://example.com/api/v1/numbering-scheme", {
    method: "PUT",
    headers: authHeaders(ownerCookie, true),
    body: JSON.stringify({
      segments: [
        { kind: "literal", text: "PD-" },
        { kind: "counter", padWidth: 4 },
      ],
    }),
  });

  const created = await SELF.fetch("https://example.com/api/v1/matters", {
    method: "POST",
    headers: authHeaders(ownerCookie, true),
    body: JSON.stringify({
      title: "Pemberton Estate",
      status: "open",
      responsibleMemberId: ownerUserId,
    }),
  });
  matterId = ((await created.json()) as { matterId: string }).matterId;

  // An open rate for both timekeepers, so a billable capture resolves rather than being refused.
  const card = await createRateCard(
    firmDatabaseFor(env.FIRM_DATABASE, poolFirmId),
    { name: "Standard" },
    { clock, actorUserId: ownerUserId },
  );
  await commitEffectBatch(firmDatabaseFor(env.FIRM_DATABASE, poolFirmId), card.effect, {
    now: clock.now,
  });
  const rate = await appendRate(
    firmDatabaseFor(env.FIRM_DATABASE, poolFirmId),
    {
      rateCardId: card.rateCardId,
      // The card's own default rate: tier "role" with no scoped id is what the resolution chain
      // reads last, so both timekeepers resolve without a per-person rate being laid down twice.
      tier: "role",
      scopedId: null,
      rateE4: 2_500_000, // $250.00/hour
      currency: "USD",
      validFrom: "2026-01-01",
    },
    { clock, actorUserId: ownerUserId },
  );
  await commitEffectBatch(firmDatabaseFor(env.FIRM_DATABASE, poolFirmId), rate.effect, {
    now: clock.now,
  });

  // Two days inside the span the tests ask for, one outside it, and one recorded by somebody else.
  await capture("2026-06-10", "Inside the span, day one", ownerCookie, ownerUserId);
  await capture("2026-06-12", "Inside the span, day two", ownerCookie, ownerUserId);
  await capture("2026-07-20", "Outside the span", ownerCookie, ownerUserId);
  await capture("2026-06-11", "The colleague's own hour", colleagueCookie, colleagueUserId);
});

interface ListedEntry {
  readonly id: string;
  readonly matterId: string;
  readonly workDate: string;
  readonly timekeeperUserId: string;
  readonly narrative: string;
}

async function listed(response: Response): Promise<readonly ListedEntry[]> {
  const body = (await response.json()) as { data: ListedEntry[] };
  return body.data;
}

describe("the span", () => {
  it("answers one timekeeper's own days across the period, newest first", async () => {
    const response = await get(
      `/api/v1/time-entries?from=2026-06-01&to=2026-06-30&timekeeperUserId=${ownerUserId}`,
    );
    expect(response.status).toBe(200);
    const rows = await listed(response);
    expect(rows.map((row) => row.workDate)).toEqual(["2026-06-12", "2026-06-10"]);
  });

  it("leaves out a day outside the span rather than answering with the whole record", async () => {
    const rows = await listed(
      await get(
        `/api/v1/time-entries?from=2026-06-01&to=2026-06-30&timekeeperUserId=${ownerUserId}`,
      ),
    );
    expect(rows.some((row) => row.workDate === "2026-07-20")).toBe(false);
  });

  it("covers every timekeeper when none is named", async () => {
    const rows = await listed(await get("/api/v1/time-entries?from=2026-06-01&to=2026-06-30"));
    expect(rows.map((row) => row.workDate)).toEqual(["2026-06-12", "2026-06-11", "2026-06-10"]);
    expect(new Set(rows.map((row) => row.timekeeperUserId))).toEqual(
      new Set([ownerUserId, colleagueUserId]),
    );
  });

  it("narrows a span to one matter when asked", async () => {
    const rows = await listed(
      await get(`/api/v1/time-entries?from=2026-06-01&to=2026-06-30&matterId=${matterId}`),
    );
    expect(rows.every((row) => row.matterId === matterId)).toBe(true);
    expect(rows.length).toBe(3);
  });

  it("refuses a span that reads backwards rather than swapping it (422)", async () => {
    const response = await get(
      `/api/v1/time-entries?from=2026-06-30&to=2026-06-01&timekeeperUserId=${ownerUserId}`,
    );
    expect(response.status).toBe(422);
  });

  it("still answers empty for a request that names no scope at all", async () => {
    const response = await get("/api/v1/time-entries");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: unknown[]; nextCursor: string | null };
    expect(body.data).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });
});

describe("who may ask for whose", () => {
  it("lets a member read their own span without time:viewFirm", async () => {
    const response = await get(
      `/api/v1/time-entries?from=2026-06-01&to=2026-06-30&timekeeperUserId=${colleagueUserId}`,
      colleagueCookie,
    );
    expect(response.status).toBe(200);
    const rows = await listed(response);
    expect(rows.every((row) => row.timekeeperUserId === colleagueUserId)).toBe(true);
  });

  it("refuses the firm's whole span to a member without time:viewFirm (403)", async () => {
    const response = await get(
      "/api/v1/time-entries?from=2026-06-01&to=2026-06-30",
      colleagueCookie,
    );
    expect(response.status).toBe(403);
  });

  it("refuses another timekeeper's span to a member without time:viewFirm (403)", async () => {
    const response = await get(
      `/api/v1/time-entries?from=2026-06-01&to=2026-06-30&timekeeperUserId=${ownerUserId}`,
      colleagueCookie,
    );
    expect(response.status).toBe(403);
  });

  it("lets a time:viewFirm holder read a colleague's span (200)", async () => {
    const response = await get(
      `/api/v1/time-entries?from=2026-06-01&to=2026-06-30&timekeeperUserId=${colleagueUserId}`,
      ownerCookie,
    );
    expect(response.status).toBe(200);
  });
});
