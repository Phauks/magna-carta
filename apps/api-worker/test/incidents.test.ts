import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import { runScheduledSweep } from "../src/background/scheduled.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  seedFirmKey,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// POST /api/v1/incidents: the user-initiated incident write through the chokepoint.
// Firm A (DB_FIRM_POOL_1) carries the happy path / DB assertions / validation; firm B
// (DB_FIRM_POOL_2) is reserved for the rate-limit test so its own per-firm bucket is not consumed by
// the other tests (the rate-limit key is tenant-scoped).
let firmAId: FirmId;
let firmBId: FirmId;

const VALID_BODY = {
  errorIds: [] as string[],
  breadcrumbs: [{ at: "2026-06-13T00:00:00.000Z", action: "click:save", route: "/matters/:id" }],
  description: "The save button spun forever and nothing happened.",
  context: { route: "/matters/:id", appVersion: "0.0.0", clientAt: "2026-06-13T00:00:00.000Z" },
};

function postIncident(body: unknown, cookie?: string): Promise<Response> {
  return SELF.fetch("https://example.com/api/v1/incidents", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
  firmAId = (await seedFirm({ name: "Incident Firm A", databaseIdentifier: "DB_FIRM_POOL_1" }))
    .firmId;
  firmBId = (await seedFirm({ name: "Incident Firm B", databaseIdentifier: "DB_FIRM_POOL_2" }))
    .firmId;
  // The incident-intake route encrypts the description under the firm key, so both firms need a
  // minted wrapped key (seedFirm inserts none).
  await seedFirmKey(firmAId);
  await seedFirmKey(firmBId);
});

describe("POST /api/v1/incidents", () => {
  it("records the incident row + an incident.created outbox row, and the relay dispatches it (not dead-lettered)", async () => {
    const { userId } = await seedCredentialedUser("incident-reporter@example.com", {
      userName: "Incident Reporter",
      firmId: firmAId,
    });
    await mirrorMemberWithOwnerRole(userId, "Incident Reporter", firmAId);
    const cookie = await signInForSessionCookie("incident-reporter@example.com");

    const response = await postIncident(
      { ...VALID_BODY, errorIds: [], description: "Save spun forever." },
      cookie,
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; status: string };
    expect(body.id).toMatch(/^incident_/);
    expect(body.status).toBe("open");

    // The per-firm incident row landed, redacted-by-construction JSON columns and all. The
    // description is encrypted-only: the plaintext column is NULL and description_ciphertext holds
    // the sealed value (never the plaintext words).
    const { results: incidentResults } = await firmDatabaseFor(env.FIRM_DATABASE, firmAId)
      .prepare(
        "SELECT id, error_ids, description, description_ciphertext, reported_by, status FROM incident WHERE id = ?1",
      )
      .bind(body.id)
      .all<{
        id: string;
        error_ids: string;
        description: string | null;
        description_ciphertext: string | null;
        reported_by: string;
        status: string;
      }>();
    const row = incidentResults[0];
    expect(row).toBeDefined();
    expect(row?.error_ids).toBe("[]");
    expect(row?.description).toBeNull();
    expect(row?.description_ciphertext).toEqual(expect.any(String));
    expect(row?.description_ciphertext).not.toContain("Save spun forever.");
    expect(row?.reported_by).toBe(userId);
    expect(row?.status).toBe("open");

    // The incident.created outbox row rode the same batch; the relay sweep dispatches it to the
    // Queue and marks it dispatched — never dead-lettered by mere non-consumption.
    const { results: pendingResults } = await firmDatabaseFor(env.FIRM_DATABASE, firmAId)
      .prepare("SELECT status FROM outbox WHERE topic = 'incident.created'")
      .all<{ status: string }>();
    const pending = pendingResults[0];
    expect(pending?.status).toBe("pending");

    await runScheduledSweep(env);

    const { results: sweptResults } = await firmDatabaseFor(env.FIRM_DATABASE, firmAId)
      .prepare("SELECT status, attempts FROM outbox WHERE topic = 'incident.created'")
      .all<{ status: string; attempts: number }>();
    const swept = sweptResults[0];
    expect(swept?.status).toBe("dispatched");
  });

  it("answers an unauthenticated request with a 401 problem", async () => {
    const response = await postIncident(VALID_BODY);
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["errorId"]).toMatch(/^error_/);
  });

  it("rejects an over-cap breadcrumb array with a 422 validation problem", async () => {
    const { userId } = await seedCredentialedUser("incident-overcap@example.com", {
      userName: "Over Cap",
      firmId: firmAId,
    });
    await mirrorMemberWithOwnerRole(userId, "Over Cap", firmAId);
    const cookie = await signInForSessionCookie("incident-overcap@example.com");

    const tooMany = Array.from({ length: 51 }, () => ({
      at: "2026-06-13T00:00:00.000Z",
      action: "scroll",
      route: "/x",
    }));
    const response = await postIncident({ ...VALID_BODY, breadcrumbs: tooMany }, cookie);
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["type"]).toBe("https://api.magnacarta.esq/problems/validation");
  });

  it("trips the incident-report rate bucket (5 / 300s) on the sixth report", async () => {
    const { userId } = await seedCredentialedUser("incident-rate@example.com", {
      userName: "Rate Limited",
      firmId: firmBId,
    });
    // Firm B's member lives in its own DO-backed database — mirror there, not the default.
    await mirrorMemberWithOwnerRole(userId, "Rate Limited", firmBId);
    const cookie = await signInForSessionCookie("incident-rate@example.com");

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (await postIncident({ ...VALID_BODY, description: `report ${i}` }, cookie)).status,
      );
    }
    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses[5]).toBe(429);
  });
});
