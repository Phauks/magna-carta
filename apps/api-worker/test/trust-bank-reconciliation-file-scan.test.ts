import { todayInUtc } from "@magna-carta/civil-time/civil-date";
import { env, SELF } from "cloudflare:test";
import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
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
import type { ProblemBody } from "../src/http/contracts/problem.ts";

// A statement attached to a reconciliation goes through the malware scan before it is kept. The test
// pool's scan stub answers "infected" for a body carrying the MALWARE_EICAR marker and "no engine"
// otherwise, so a flagged file is refused with nothing stored and an ordinary one is kept unscanned,
// the same as every other upload path when no engine is deployed.

let ownerCookie: string;
let reconciliationId: string;

const clock = { now: () => new Date().toISOString(), today: () => todayInUtc() };

function post(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.com",
      cookie: ownerCookie,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

function pdfBase64(text: string): string {
  return btoa(`%PDF-1.7\n${text}\n%%EOF\n`);
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  const firmId: FirmId = (
    await seedFirm({ name: "Statement Scan Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
  ).firmId;
  const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
  await env.DB_CONTROL.prepare("UPDATE firm SET bucket_name = 'R2' WHERE id = ?1")
    .bind(firmId)
    .run();
  const owner = await seedCredentialedUser("statement-scan-owner@example.com", {
    userName: "Statement Scan Owner",
    firmId,
  });
  await mirrorMemberWithOwnerRole(owner.userId, "Statement Scan Owner", firmId);
  ownerCookie = await signInForSessionCookie("statement-scan-owner@example.com");

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

async function fileNames(): Promise<string[]> {
  const response = await SELF.fetch(
    `https://example.com/api/v1/trust/bank-reconciliations/${reconciliationId}`,
    { headers: { origin: "https://example.com", cookie: ownerCookie } },
  );
  expect(response.status).toBe(200);
  const detail = await readJson<{ files: { name: string }[] }>(response);
  return detail.files.map((file) => file.name);
}

describe("attaching a statement to a reconciliation", () => {
  it("refuses a file the malware scan flags and keeps nothing", async () => {
    const response = await post(`/api/v1/trust/bank-reconciliations/${reconciliationId}/files`, {
      name: "flagged-statement.pdf",
      contentType: "application/pdf",
      dataBase64: pdfBase64("MALWARE_EICAR"),
    });
    expect(response.status).toBe(422);
    const problem = await readJson<ProblemBody>(response);
    expect(problem.title).toBe("This file failed the malware scan");
    expect(await fileNames()).not.toContain("flagged-statement.pdf");
  });

  it("keeps an ordinary statement", async () => {
    const response = await post(`/api/v1/trust/bank-reconciliations/${reconciliationId}/files`, {
      name: "october-statement.pdf",
      contentType: "application/pdf",
      dataBase64: pdfBase64("Statement for October"),
    });
    expect(response.status).toBe(201);
    expect(await fileNames()).toContain("october-statement.pdf");
  });
});
