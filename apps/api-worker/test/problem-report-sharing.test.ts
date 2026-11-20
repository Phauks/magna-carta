import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { insertPlatformOperatorStatement } from "@magna-carta/data-access/platform-operator-statements";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { FirmId, UserId } from "@magna-carta/identifiers/types";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import {
  mirrorMemberWithOwnerRole,
  mirrorMemberWithRole,
  seedCredentialedUser,
  seedFirm,
  seedFirmKey,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// A firm's problem reports reaching Magna Carta: the firm's switch, which reports it shares, what
// the operator's list carries, and the audited read of one report.

let firmId: FirmId;
let reporterCookie: string;
let answererCookie: string;
let operatorCookie: string;
let operatorId: string;
let sharedId: string;

function call(path: string, cookie: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...(init.headers ?? {}) },
  });
}

async function file(description: string): Promise<string> {
  const filed = await call("/api/v1/incidents", reporterCookie, {
    method: "POST",
    body: JSON.stringify({
      errorIds: [],
      breadcrumbs: [],
      description,
      context: { route: "/calendar", appVersion: "0.0.0", clientAt: "2026-11-20T19:00:00.000Z" },
    }),
  });
  expect(filed.status).toBe(201);
  return ((await filed.json()) as { id: string }).id;
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Sharing Firm", databaseIdentifier: "DB_FIRM_POOL_1" })).firmId;
  await seedFirmKey(firmId);

  const reporter = await seedCredentialedUser("share-sender@example.com", {
    userName: "Ana Cruz",
    firmId,
  });
  await mirrorMemberWithRole(reporter.userId, "Ana Cruz", firmId, "Paralegal");
  reporterCookie = await signInForSessionCookie("share-sender@example.com");

  const answerer = await seedCredentialedUser("share-answerer@example.com", {
    userName: "Ben Ito",
    firmId,
  });
  await mirrorMemberWithOwnerRole(answerer.userId, "Ben Ito", firmId);
  answererCookie = await signInForSessionCookie("share-answerer@example.com");

  const operator = await seedCredentialedUser("share-operator@example.com");
  operatorId = operator.userId;
  operatorCookie = await signInForSessionCookie("share-operator@example.com");
  await env.DB_CONTROL.prepare("UPDATE user SET two_factor_enabled = 1 WHERE id = ?1")
    .bind(operator.userId)
    .run();
  await insertPlatformOperatorStatement(env.DB_CONTROL, {
    userId: operator.userId as UserId,
    grantedByUserId: newIdentifier("user") as UserId,
    grantedAt: new Date().toISOString(),
    expiresAt: null,
    note: "problem report sharing test",
  }).run();
});

describe("the firm's switch", () => {
  it("is on by default, read by every member, and turned only by whoever answers reports", async () => {
    const read = await call("/api/v1/incidents/sharing", reporterCookie);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ sharesWithMagnaCarta: true });

    const refused = await call("/api/v1/incidents/sharing", reporterCookie, {
      method: "PUT",
      body: JSON.stringify({ sharesWithMagnaCarta: false }),
    });
    expect(refused.status).toBe(403);
  });
});

describe("a shared report", () => {
  it("is listed for Magna Carta without its words", async () => {
    sharedId = await file("The calendar lost my 3pm hearing.");
    const listed = await call("/api/v1/platform/problem-reports", operatorCookie);
    expect(listed.status).toBe(200);
    const body = await listed.text();
    expect(body).not.toContain("hearing");
    const { reports } = JSON.parse(body) as { reports: Record<string, unknown>[] };
    expect(reports).toContainEqual({
      incidentId: sharedId,
      firmId,
      firmName: "Sharing Firm",
      sentAt: expect.any(String),
      route: "/calendar",
      errorIdCount: 0,
      status: "open",
    });
  });

  it("is refused to a member who is not a platform operator", async () => {
    expect((await call("/api/v1/platform/problem-reports", answererCookie)).status).toBe(403);
  });

  it("opens through an audited read the firm can see", async () => {
    const opened = await call(`/api/v1/platform/problem-reports/${firmId}/${sharedId}`, operatorCookie);
    expect(opened.status).toBe(200);
    expect(await opened.json()).toMatchObject({
      firmName: "Sharing Firm",
      report: { id: sharedId, description: "The calendar lost my 3pm hearing." },
    });
    const audit = await firmDatabaseFor(env.FIRM_DATABASE, firmId)
      .prepare("SELECT actor_user_id FROM audit_log WHERE event = 'protected.decrypt' AND subject_id = ?1")
      .bind(sharedId)
      .all<{ actor_user_id: string }>();
    expect(audit.results.map((row) => row.actor_user_id)).toContain(operatorId);
  });

  it("follows the firm's answer", async () => {
    const answered = await call(`/api/v1/incidents/${sharedId}`, answererCookie, {
      method: "PATCH",
      body: JSON.stringify({ status: "investigating" }),
    });
    expect(answered.status).toBe(200);
    const { reports } = (await (
      await call("/api/v1/platform/problem-reports", operatorCookie)
    ).json()) as { reports: { incidentId: string; status: string }[] };
    expect(reports.find((report) => report.incidentId === sharedId)?.status).toBe("investigating");
  });
});

describe("turning the switch off", () => {
  it("withdraws every shared report and shares none sent after", async () => {
    const off = await call("/api/v1/incidents/sharing", answererCookie, {
      method: "PUT",
      body: JSON.stringify({ sharesWithMagnaCarta: false }),
    });
    expect(off.status).toBe(200);
    expect(
      (await call(`/api/v1/platform/problem-reports/${firmId}/${sharedId}`, operatorCookie)).status,
    ).toBe(404);

    const unshared = await file("Sent while sharing is off.");
    const on = await call("/api/v1/incidents/sharing", answererCookie, {
      method: "PUT",
      body: JSON.stringify({ sharesWithMagnaCarta: true }),
    });
    expect(on.status).toBe(200);
    const { reports } = (await (
      await call("/api/v1/platform/problem-reports", operatorCookie)
    ).json()) as { reports: { incidentId: string }[] };
    const listed = reports.map((report) => report.incidentId);
    expect(listed).not.toContain(unshared);
    expect(listed).not.toContain(sharedId);
  });
});
