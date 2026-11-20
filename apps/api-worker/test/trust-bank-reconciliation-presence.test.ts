import { todayInUtc } from "@magna-carta/civil-time/civil-date";
import { env, SELF } from "cloudflare:test";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { insertMemberStatement } from "@magna-carta/data-access/member-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, LocationId } from "@magna-carta/identifiers/types";
import { openTrustAccount } from "@magna-carta/trust/account-tree";
import { beforeAll, describe, expect, it } from "vitest";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  readJson,
  seedCredentialedUser,
  seedFirm,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// Who else has a reconciliation open: two members touch the same period and each sees the other and
// not themselves, a leave takes a member off at once, an unknown period is refused, and a member who
// cannot read trust cannot ask.

let ownerCookie: string;
let secondCookie: string;
let noTrustCookie: string;
let reconciliationId: string;

const clock = { now: () => new Date().toISOString(), today: () => todayInUtc() };

function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: cookie ?? ownerCookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  const firmId: FirmId = (
    await seedFirm({ name: "Presence Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(firmId)
    .run();
  const owner = await seedCredentialedUser("presence-owner@example.com", {
    userName: "Presence Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Presence Owner", firmId);
  ownerCookie = await signInForSessionCookie("presence-owner@example.com");
  const second = await seedCredentialedUser("presence-second@example.com", {
    userName: "Second Reconciler",
    firmId,
  });
  await mirrorMemberWithOwnerRole(second.userId, "Second Reconciler", firmId);
  secondCookie = await signInForSessionCookie("presence-second@example.com");
  const noTrust = await seedCredentialedUser("presence-none@example.com", {
    userName: "No Trust",
    firmId,
  });
  await insertMemberStatement(firmDatabase, {
    userId: noTrust.userId,
    displayName: "No Trust",
    now: clock.now(),
  }).run();
  noTrustCookie = await signInForSessionCookie("presence-none@example.com");

  const locationId = newIdentifier("location") as LocationId;
  await firmDatabase
    .prepare(
      "INSERT INTO location (id, name, status, created_at, updated_at) VALUES (?1, ?2, 'active', ?3, ?3)",
    )
    .bind(locationId, "Reno", clock.now())
    .run();
  const opened = await openTrustAccount(
    firmDatabase,
    {
      name: "IOLTA Reno",
      locationId,
      jurisdiction: "US-NV",
      currency: "USD",
      openedOn: "2026-08-01",
    },
    { clock },
  );
  await commitEffectBatch(firmDatabase, opened.effect, { now: () => clock.now() });

  const started = await post("/api/v1/trust/bank-reconciliations", {
    trustAccountId: opened.trustAccountId,
    startDate: "2026-08-01",
    startBalanceMinor: 0,
    endDate: todayInUtc(),
    endBalanceMinor: 0,
  });
  expect(started.status).toBe(201);
  reconciliationId = (await readJson<{ trustBankReconciliationId: string }>(started))
    .trustBankReconciliationId;
});

function presence(
  method: "POST" | "DELETE",
  cookie: string,
  id = reconciliationId,
): Promise<Response> {
  return SELF.fetch(`https://example.com/api/v1/trust/bank-reconciliations/${id}/presence`, {
    method,
    headers: { origin: "https://example.com", cookie },
  });
}

async function others(cookie: string): Promise<string[]> {
  const response = await presence("POST", cookie);
  expect(response.status).toBe(200);
  const answer = await readJson<{ others: { name: string }[] }>(response);
  return answer.others.map((member) => member.name);
}

describe("who else has a reconciliation open", () => {
  it("shows each member the other, never themselves, and drops a member who leaves", async () => {
    expect(await others(ownerCookie)).toEqual([]);
    expect(await others(secondCookie)).toEqual(["Presence Owner"]);
    expect(await others(ownerCookie)).toEqual(["Second Reconciler"]);

    expect((await presence("DELETE", secondCookie)).status).toBe(204);
    expect(await others(ownerCookie)).toEqual([]);
  });

  it("refuses a period that does not exist", async () => {
    const response = await presence("POST", ownerCookie, newIdentifier("trustBankReconciliation"));
    expect(response.status).toBe(404);
  });

  it("refuses a member who cannot read trust", async () => {
    expect((await presence("POST", noTrustCookie)).status).toBe(403);
  });
});
