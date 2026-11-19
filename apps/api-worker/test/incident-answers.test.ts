import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
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

// Answering a problem report, and the reporter hearing back: who may read which report, the sealed
// answer note, the once-only screenshot, and the outbox rows the two notifications ride.

// A one-pixel PNG: the smallest image the screenshot route's byte reader accepts.
const PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

let firmId: FirmId;
let reporterCookie: string;
let reporterId: string;
let answererCookie: string;
let bystanderCookie: string;
let incidentId: string;

function call(path: string, cookie: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...init.headers },
  });
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmId = (await seedFirm({ name: "Report Answer Firm", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  await seedFirmKey(firmId);

  const reporter = await seedCredentialedUser("report-sender@example.com", {
    userName: "Sam Ortiz",
    firmId,
  });
  reporterId = reporter.userId;
  await mirrorMemberWithRole(reporter.userId, "Sam Ortiz", firmId, "Paralegal");
  reporterCookie = await signInForSessionCookie("report-sender@example.com");

  const answerer = await seedCredentialedUser("report-answerer@example.com", {
    userName: "Dana Reyes",
    firmId,
  });
  await mirrorMemberWithOwnerRole(answerer.userId, "Dana Reyes", firmId);
  answererCookie = await signInForSessionCookie("report-answerer@example.com");

  const bystander = await seedCredentialedUser("report-bystander@example.com", {
    userName: "Lee Park",
    firmId,
  });
  await mirrorMemberWithRole(bystander.userId, "Lee Park", firmId, "Paralegal");
  bystanderCookie = await signInForSessionCookie("report-bystander@example.com");

  const filed = await call("/api/v1/incidents", reporterCookie, {
    method: "POST",
    body: JSON.stringify({
      errorIds: ["error_0mwfnax8napiSlVeIBqj4"],
      breadcrumbs: [{ at: "2026-11-19T19:00:00.000Z", action: "click:preview", route: "/billing" }],
      description: "The invoice preview went blank after I changed the client.",
      context: {
        route: "/billing/invoices/new",
        appVersion: "0.0.0",
        clientAt: "2026-11-19T19:00:00.000Z",
      },
    }),
  });
  expect(filed.status).toBe(201);
  incidentId = ((await filed.json()) as { id: string }).id;
});

describe("a filed report", () => {
  it("names its sender on the outbox row, so the receipt reaches them", async () => {
    const { results } = await firmDatabaseFor(env.FIRM_DATABASE, firmId)
      .prepare("SELECT payload FROM outbox WHERE topic = 'incident.created'")
      .all<{ payload: string }>();
    const payloads = results.map((row) => JSON.parse(row.payload) as Record<string, unknown>);
    expect(payloads).toContainEqual(
      expect.objectContaining({ incidentId, reportedBy: reporterId, errorIdCount: 1 }),
    );
  });

  it("is listed for the answerer with its words, and refused to a member without the permission", async () => {
    const listed = await call("/api/v1/incidents", answererCookie);
    expect(listed.status).toBe(200);
    const { incidents } = (await listed.json()) as {
      incidents: {
        id: string;
        summary: string;
        reporterName: string;
        status: string;
        route: string;
      }[];
    };
    expect(incidents.find((entry) => entry.id === incidentId)).toMatchObject({
      summary: "The invoice preview went blank after I changed the client.",
      reporterName: "Sam Ortiz",
      status: "open",
      route: "/billing/invoices/new",
    });

    expect((await call("/api/v1/incidents", reporterCookie)).status).toBe(403);
  });

  it("is the sender's own to read, and not found for anybody else's own list", async () => {
    const mine = await call("/api/v1/incidents/mine", reporterCookie);
    expect(mine.status).toBe(200);
    const { incidents } = (await mine.json()) as { incidents: { id: string }[] };
    expect(incidents.map((entry) => entry.id)).toContain(incidentId);

    const theirs = await call("/api/v1/incidents/mine", bystanderCookie);
    expect(((await theirs.json()) as { incidents: unknown[] }).incidents).toEqual([]);
    expect((await call(`/api/v1/incidents/mine/${incidentId}`, bystanderCookie)).status).toBe(404);
  });
});

describe("the screenshot", () => {
  it("is attached once by the sender and read back by both sides", async () => {
    const body = JSON.stringify({ imageBase64: PIXEL_PNG });
    const path = `/api/v1/incidents/mine/${incidentId}/screenshot`;
    expect((await call(path, bystanderCookie, { method: "PUT", body })).status).toBe(404);
    expect((await call(path, reporterCookie, { method: "PUT", body })).status).toBe(204);
    expect((await call(path, reporterCookie, { method: "PUT", body })).status).toBe(409);

    const answererView = await call(`/api/v1/incidents/${incidentId}/screenshot`, answererCookie);
    expect(answererView.status).toBe(200);
    expect(answererView.headers.get("content-type")).toBe("image/png");
    expect((await answererView.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const ownView = await call(path, reporterCookie);
    expect(ownView.status).toBe(200);
  });

  it("keeps exactly one of two uploads racing for the same report", async () => {
    const filed = await call("/api/v1/incidents", reporterCookie, {
      method: "POST",
      body: JSON.stringify({
        errorIds: [],
        breadcrumbs: [],
        description: "Two windows sent the same picture.",
        context: { route: "/matters", appVersion: "0.0.0", clientAt: "2026-11-19T19:05:00.000Z" },
      }),
    });
    const raced = ((await filed.json()) as { id: string }).id;
    const path = `/api/v1/incidents/mine/${raced}/screenshot`;
    const body = JSON.stringify({ imageBase64: PIXEL_PNG });
    const statuses = (
      await Promise.all([
        call(path, reporterCookie, { method: "PUT", body }),
        call(path, reporterCookie, { method: "PUT", body }),
      ])
    )
      .map((response) => response.status)
      .sort();
    expect(statuses).toEqual([204, 409]);

    // The loser's object is removed, so the bucket holds only the picture the row points at.
    const listed = await env.R2.list({ prefix: `incidents/${raced}/` });
    expect(listed.objects).toHaveLength(1);
  });
});

describe("answering", () => {
  it("seals the note, tells the sender without the note, and shows it on their report", async () => {
    const answered = await call(`/api/v1/incidents/${incidentId}`, answererCookie, {
      method: "PATCH",
      body: JSON.stringify({
        status: "fixed",
        note: "Fixed in today's update. Refresh to get it.",
      }),
    });
    expect(answered.status).toBe(200);
    expect(await answered.json()).toMatchObject({
      status: "fixed",
      statusNote: "Fixed in today's update. Refresh to get it.",
      answeredByName: "Dana Reyes",
      hasScreenshot: true,
    });

    const database = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    const row = await database
      .prepare("SELECT status, status_note_ciphertext FROM incident WHERE id = ?1")
      .bind(incidentId)
      .first<{ status: string; status_note_ciphertext: string }>();
    expect(row?.status).toBe("fixed");
    expect(row?.status_note_ciphertext).not.toContain("Refresh");

    const { results } = await database
      .prepare("SELECT payload FROM outbox WHERE topic = 'incident.answered'")
      .all<{ payload: string }>();
    expect(results).toHaveLength(1);
    expect(JSON.parse(results[0]!.payload)).toEqual({
      incidentId,
      reportedBy: reporterId,
      status: "fixed",
      noted: true,
    });

    const own = await call(`/api/v1/incidents/mine/${incidentId}`, reporterCookie);
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({
      status: "fixed",
      statusNote: "Fixed in today's update. Refresh to get it.",
      description: "The invoice preview went blank after I changed the client.",
    });
  });

  it("is refused to the sender, who reads but does not answer", async () => {
    const refused = await call(`/api/v1/incidents/${incidentId}`, reporterCookie, {
      method: "PATCH",
      body: JSON.stringify({ status: "closed" }),
    });
    expect(refused.status).toBe(403);
  });
});
