import { env } from "cloudflare:test";
import { createMemoryLogger } from "@magna-carta/telemetry/logger";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/http/app.ts";
import { applyControlPlaneMigrations } from "./support/apply-control-plane-migrations.ts";
import { firmDatabaseFor } from "../src/firm-database/firm-database-proxy.ts";
import {
  mirrorMemberWithOwnerRole,
  seedCredentialedUser,
  seedFirm,
  seedFirmKey,
  signInForSessionCookie,
} from "./support/test-auth.ts";

// The telemetry correlation story end to end: a request
// fails → the telemetry boundary mints an Error ID, logs error.captured, and returns the RFC 9457
// 500 carrying that Error ID and the correlation ID → the user quotes the Error ID in an incident
// report → it lands a firm-scoped row + an incident.created outbox row. One app instance with a
// memory logger (to assert the events) and the telemetry probes (to force the failure), driven with
// app.request over the real Miniflare bindings.

beforeAll(async () => {
  await applyControlPlaneMigrations(env.DB_CONTROL);
});

describe("slice 0·6 end-to-end — the correlation story", () => {
  it("an escaped error's Error ID joins error.captured AND is quotable in an incident that lands a firm-scoped row + queue seam", async () => {
    const firmId = (
      await seedFirm({ name: "E2E Telemetry Firm", databaseIdentifier: "DB_FIRM_POOL_1" })
    ).firmId;
    // The incident route now encrypts the description, so the firm needs a minted key (the
    // provisioner mints it in production; a directly-seeded test firm mints it here).
    await seedFirmKey(firmId);
    const { userId } = await seedCredentialedUser("e2e-telemetry@example.com", {
      userName: "E2E Reporter",
      firmId,
    });
    await mirrorMemberWithOwnerRole(userId, "E2E Reporter", firmId);
    const cookie = await signInForSessionCookie("e2e-telemetry@example.com");

    const memory = createMemoryLogger();
    const app = createApp({ loggerForEnv: () => memory, includeTelemetryProbes: true });

    // 1. A request fails: the onError boundary returns the RFC 9457 500 with an Error ID + correlation
    //    ID, and logs error.captured with the SAME Error ID.
    const failure = await app.request("https://example.com/api/v1/__telemetry-throw", {}, env);
    expect(failure.status).toBe(500);
    const failureBody = (await failure.json()) as { errorId: string; correlationId: string };
    expect(failureBody.errorId).toMatch(/^error_/);
    expect(failureBody.correlationId).toMatch(/^correlation_/);

    const captured = memory.events.find((event) => event.name === "error.captured");
    expect(captured?.fields.errorId).toBe(failureBody.errorId);

    // 2. The user quotes that Error ID in an incident report.
    const report = await app.request(
      "https://example.com/api/v1/incidents",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          errorIds: [failureBody.errorId],
          breadcrumbs: [{ at: "2026-06-13T00:00:00.000Z", action: "click:save", route: "/x" }],
          description: "It crashed; here is the error id from the screen.",
          context: { route: "/x", appVersion: "0.0.0", clientAt: "2026-06-13T00:00:00.000Z" },
        }),
      },
      env,
    );
    expect(report.status).toBe(201);
    const incidentId = ((await report.json()) as { id: string }).id;
    expect(incidentId).toMatch(/^incident_/);

    // incident.created logged with the new incident's id.
    const incidentEvent = memory.events.find((event) => event.name === "incident.created");
    expect(incidentEvent?.fields.incidentId).toBe(incidentId);

    // 3. The firm-scoped row carries the quoted Error ID, and the incident.created outbox row rode
    //    the same batch — the queue seam the diagnostics agent will consume.
    const firmDatabase = firmDatabaseFor(env.FIRM_DATABASE, firmId);
    const incidentResults = await firmDatabase
      .prepare("SELECT error_ids FROM incident WHERE id = ?1")
      .bind(incidentId)
      .all<{ error_ids: string }>();
    const row = incidentResults.results[0] ?? null;
    expect(JSON.parse(row?.error_ids ?? "[]")).toEqual([failureBody.errorId]);

    const outboxResults = await firmDatabase
      .prepare("SELECT topic FROM outbox WHERE topic = 'incident.created'")
      .all<{ topic: string }>();
    const outbox = outboxResults.results[0] ?? null;
    expect(outbox?.topic).toBe("incident.created");
  });
});
