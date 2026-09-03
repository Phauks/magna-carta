import { env, SELF } from "cloudflare:test";
import {
  insertMemberStatement,
  insertRoleAssignmentStatement,
} from "@magna-carta/data-access/member-statements";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { appendRate, createRateCard } from "@magna-carta/timekeeping/rate-service";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { assertIdentifier } from "@magna-carta/identifiers/validate";
import type { FirmId, RateCardId, UserId } from "@magna-carta/identifiers/types";
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
 * Three things a draft's money and lifecycle owe the person correcting them, over real bindings.
 *
 *   THE RATE IS SETTABLE. Capture has always taken an override and the chain has always ranked it
 *   first; the update route now takes the same field, so an entry captured at the wrong rate is
 *   corrected rather than voided and typed again.
 *
 *   THE AMOUNT FOLLOWS ITS INPUTS. Changing the time worked used to write raw_duration_minutes and
 *   leave the billed duration and the amount where they stood, so an entry corrected from one hour
 *   to two stayed billed at one. Both inputs to the product are now re-derived whenever either
 *   moves, which is the only way "set the rate" can mean anything.
 *
 *   A VOID CAN BE UNDONE, EXCEPT THE ONE THAT MUST NOT BE. A mistaken void is repaired in place,
 *   with the entry's number and history intact; an entry whose value became a cost stays void,
 *   because restoring it would charge the same work twice.
 *
 * These live in their own file rather than beside the other route tests deliberately: that file
 * shares one rate-limit window across everything in it, and a block appended to the end of it
 * starves the blocks that follow.
 */

let poolFirmId: FirmId;
let ownerCookie: string;
let ownerUserId: UserId;
let matterId: string;
let rateCardId: RateCardId;

const clock = { now: () => new Date().toISOString() };

async function mirrorMemberWithRole(userId: UserId, displayName: string, roleName: string) {
  const role = await firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
    .prepare("SELECT id FROM role WHERE name = ?1")
    .bind(roleName)
    .first<{ id: string }>();
  if (role === null) throw new Error(`seeded role ${roleName} missing`);
  await insertMemberStatement(firmDatabaseFor(env.FIRM_DATABASE, poolFirmId), {
    userId,
    displayName,
    now: new Date().toISOString(),
  }).run();
  await insertRoleAssignmentStatement(firmDatabaseFor(env.FIRM_DATABASE, poolFirmId), {
    id: newIdentifier("memberRole"),
    memberUserId: userId,
    roleId: assertIdentifier(role.id, "role"),
  }).run();
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  poolFirmId = (await seedFirm({ name: "Rate Test Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(poolFirmId)
    .run();

  const owner = await seedCredentialedUser("rate-owner@example.com", {
    userName: "Rate Owner",
    firmId: poolFirmId,
  });
  ownerUserId = owner.userId;
  await mirrorMemberWithOwnerRole(owner.userId, "Rate Owner", poolFirmId);
  ownerCookie = await signInForSessionCookie("rate-owner@example.com");
  void mirrorMemberWithRole;

  await SELF.fetch("https://example.com/api/v1/numbering-scheme", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      segments: [
        { kind: "literal", text: "RT-" },
        { kind: "counter", padWidth: 4 },
      ],
    }),
  });

  const created = await SELF.fetch("https://example.com/api/v1/matters", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      title: "Rate v. Duration",
      status: "open",
      responsibleMemberId: ownerUserId,
    }),
  });
  matterId = ((await created.json()) as { matterId: string }).matterId;

  const card = await createRateCard(
    firmDatabaseFor(env.FIRM_DATABASE, poolFirmId),
    { name: "Standard" },
    { clock, actorUserId: ownerUserId },
  );
  await commitEffectBatch(firmDatabaseFor(env.FIRM_DATABASE, poolFirmId), card.effect, {
    now: clock.now,
  });
  rateCardId = card.rateCardId;
  const rate = await appendRate(
    firmDatabaseFor(env.FIRM_DATABASE, poolFirmId),
    {
      rateCardId: card.rateCardId,
      tier: "timekeeper",
      scopedId: ownerUserId,
      rateE4: 3_000_000, // $300.00/hour
      currency: "USD",
      validFrom: "2026-01-01",
    },
    { clock, actorUserId: ownerUserId },
  );
  await commitEffectBatch(firmDatabaseFor(env.FIRM_DATABASE, poolFirmId), rate.effect, {
    now: clock.now,
  });
});

function authHeaders(withKey = false): HeadersInit {
  return {
    "content-type": "application/json",
    origin: "https://example.com",
    cookie: ownerCookie,
    ...(withKey ? { "Idempotency-Key": crypto.randomUUID() } : {}),
  };
}
async function post(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify(body),
  });
}
async function patch(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "PATCH",
    headers: authHeaders(true),
    body: JSON.stringify(body),
  });
}
async function get(path: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    headers: { origin: "https://example.com", cookie: ownerCookie },
  });
}

interface MoneyRow {
  status: string;
  duration_minutes: number;
  raw_duration_minutes: number;
  rate_e4: number | null;
  rate_source: string | null;
  amount_minor: number | null;
  entry_number: string | null;
  narrative: string;
}

async function readRow(id: string): Promise<MoneyRow | null> {
  return firmDatabaseFor(env.FIRM_DATABASE, poolFirmId)
    .prepare(
      "SELECT status, duration_minutes, raw_duration_minutes, rate_e4, rate_source, amount_minor, entry_number, narrative FROM time_entry WHERE id = ?1",
    )
    .bind(id)
    .first<MoneyRow>();
}

async function captureHour(narrative: string, billable = true): Promise<string> {
  const created = await post("/api/v1/time-entries", {
    matterId,
    timekeeperUserId: ownerUserId,
    workDate: "2026-06-22",
    rawDurationMinutes: 60,
    narrative,
    billable,
    source: "manual",
    ...(billable ? { rateCardId } : {}),
  });
  expect(created.status).toBe(201);
  return ((await created.json()) as { timeEntryId: string }).timeEntryId;
}

describe("the rounding policy a capture screen has to know", () => {
  it("serves the increment and the direction in force, so units and rounding are not guessed", async () => {
    const response = await get(
      `/api/v1/time-entries/rounding-policy?matterId=${matterId}&timekeeperUserId=${ownerUserId}`,
    );
    expect(response.status).toBe(200);
    // The platform default: a tenth of an hour, resolved to the nearest increment. A screen that
    // assumed this instead of asking would record the wrong amount of time for a firm on quarters.
    expect(await response.json()).toEqual({ incrementMinutes: 6, roundingDirection: "nearest" });
  });
});

describe("setting a draft's rate", () => {
  it("prices the entry at the rate given, above every tier of the chain, and re-computes the amount", async () => {
    const id = await captureHour("Priced by the chain");
    const before = await readRow(id);
    expect(before?.rate_e4).toBe(3_000_000);
    expect(before?.rate_source).toBe("timekeeper");
    expect(before?.amount_minor).toBe(30_000); // one hour at $300.00

    const response = await patch(`/api/v1/time-entries/${id}`, { overrideRateE4: 5_000_000 });
    expect(response.status).toBe(200);

    const after = await readRow(id);
    expect(after?.rate_e4).toBe(5_000_000);
    expect(after?.rate_source).toBe("override");
    expect(after?.amount_minor).toBe(50_000); // one hour at $500.00
  });

  it("clears back to the chain when the override is set to null", async () => {
    const id = await captureHour("Priced then unpriced");
    await patch(`/api/v1/time-entries/${id}`, { overrideRateE4: 5_000_000 });
    const response = await patch(`/api/v1/time-entries/${id}`, { overrideRateE4: null });
    expect(response.status).toBe(200);

    const after = await readRow(id);
    expect(after?.rate_e4).toBe(3_000_000);
    expect(after?.rate_source).toBe("timekeeper");
    expect(after?.amount_minor).toBe(30_000);
  });

  it("carries a standing override through an unrelated edit rather than silently re-pricing", async () => {
    // The hole this closes: correcting the work date of an entry somebody had deliberately priced
    // used to re-ask the chain WITHOUT the override and put the card's answer back, so a
    // correction to one field quietly changed what the client is charged.
    const id = await captureHour("Priced, then corrected");
    await patch(`/api/v1/time-entries/${id}`, { overrideRateE4: 5_000_000 });

    const response = await patch(`/api/v1/time-entries/${id}`, { workDate: "2026-06-23" });
    expect(response.status).toBe(200);

    const after = await readRow(id);
    expect(after?.rate_e4).toBe(5_000_000);
    expect(after?.rate_source).toBe("override");
  });
});

describe("changing the time worked", () => {
  it("re-rounds the billed duration and re-computes the amount, which it used to leave stale", async () => {
    const id = await captureHour("One hour, then two");
    expect((await readRow(id))?.amount_minor).toBe(30_000);

    const response = await patch(`/api/v1/time-entries/${id}`, { rawDurationMinutes: 120 });
    expect(response.status).toBe(200);

    const after = await readRow(id);
    expect(after?.raw_duration_minutes).toBe(120);
    // Both of these were the bug: the billed duration stayed at 60 and the amount at one hour's
    // worth, so an entry corrected upward was billed at the old figure.
    expect(after?.duration_minutes).toBe(120);
    expect(after?.amount_minor).toBe(60_000);
  });

  it("rounds to the firm's increment rather than storing the raw minutes as billed", async () => {
    const id = await captureHour("Rounding");
    const response = await patch(`/api/v1/time-entries/${id}`, { rawDurationMinutes: 64 });
    expect(response.status).toBe(200);

    const after = await readRow(id);
    expect(after?.raw_duration_minutes).toBe(64);
    // 64 minutes to the nearest tenth of an hour is 66, not 64: the billed figure is a policy
    // answer and the raw one is what happened, and the row keeps both.
    expect(after?.duration_minutes).toBe(66);
    expect(after?.amount_minor).toBe(33_000);
  });

  it("leaves the money alone entirely when a patch touches neither the duration nor the rate", async () => {
    const id = await captureHour("Narrative only");
    const response = await patch(`/api/v1/time-entries/${id}`, { narrative: "Reworded" });
    expect(response.status).toBe(200);

    const after = await readRow(id);
    expect(after?.narrative).toBe("Reworded");
    expect(after?.duration_minutes).toBe(60);
    expect(after?.amount_minor).toBe(30_000);
    expect(after?.rate_source).toBe("timekeeper");
  });
});

describe("undoing a void", () => {
  it("returns the entry to draft with its number, its narrative and its money intact", async () => {
    const id = await captureHour("Voided by mistake");
    const before = await readRow(id);

    expect((await post(`/api/v1/time-entries/${id}/void`, {})).status).toBe(200);
    expect((await readRow(id))?.status).toBe("void");

    const response = await post(`/api/v1/time-entries/${id}/unvoid`, {});
    expect(response.status).toBe(200);

    const after = await readRow(id);
    expect(after?.status).toBe("draft");
    // The whole argument for undoing rather than re-typing: none of this had to be entered again.
    expect(after?.entry_number).toBe(before?.entry_number);
    expect(after?.narrative).toBe(before?.narrative);
    expect(after?.rate_e4).toBe(before?.rate_e4);
    expect(after?.amount_minor).toBe(before?.amount_minor);
  });

  it("puts the restore on the record beside the void", async () => {
    const id = await captureHour("Voided and restored");
    await post(`/api/v1/time-entries/${id}/void`, {});
    await post(`/api/v1/time-entries/${id}/unvoid`, {});

    const events = await get(`/api/v1/time-entries/${id}/events`);
    expect(events.status).toBe(200);
    const names = ((await events.json()) as { data: { event: string }[] }).data.map(
      (entry) => entry.event,
    );
    expect(names).toContain("time_entry.voided");
    expect(names).toContain("time_entry.unvoided");
  });

  it("refuses an entry that was never voided", async () => {
    const id = await captureHour("Never voided");
    const response = await post(`/api/v1/time-entries/${id}/unvoid`, {});
    expect(response.status).toBe(409);
  });

  it("refuses to restore time whose value already became a cost", async () => {
    const id = await captureHour("Converted to a cost");
    const converted = await post(`/api/v1/time-entries/${id}/convert-to-cost`, {});
    expect(converted.status).toBe(201);
    expect((await readRow(id))?.status).toBe("void");

    // Restoring this one would put the hour back on the ledger beside the cost that already
    // carries its value, and the client would be charged for the work twice.
    const response = await post(`/api/v1/time-entries/${id}/unvoid`, {});
    expect(response.status).toBe(409);
    expect((await readRow(id))?.status).toBe("void");
  });
});
