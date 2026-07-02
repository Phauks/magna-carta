import { describe, expect, it } from "vitest";
import {
  EVENT_NAMES,
  authDenied,
  emailSent,
  errorCaptured,
  incidentCreated,
  migrationApplied,
  operationFailed,
  outboxDeadLettered,
  outboxSwept,
  requestCompleted,
  usageFeature,
} from "../src/events.ts";

const context = { correlationId: "correlation_abc123", now: "2026-06-13T00:00:00.000Z" };

describe("event catalog", () => {
  it("requestCompleted carries route/method/status/durationMs", () => {
    const event = requestCompleted(context, {
      route: "/api/v1/matters/:id",
      method: "GET",
      status: 200,
      durationMs: 12,
    });
    expect(event.name).toBe("request.completed");
    expect(event.fields).toEqual({
      route: "/api/v1/matters/:id",
      method: "GET",
      status: 200,
      durationMs: 12,
    });
  });

  it("errorCaptured carries errorId/route/method/errorName/messageHead", () => {
    const event = errorCaptured(context, {
      errorId: "error_xyz",
      route: "/api/v1/things",
      method: "POST",
      errorName: "TypeError",
      messageHead: "cannot read x",
    });
    expect(event.name).toBe("error.captured");
    expect(event.fields.errorId).toBe("error_xyz");
  });

  it("outboxSwept carries database/dispatched/failed/deadLettered", () => {
    const event = outboxSwept(context, {
      database: "firm_db",
      dispatched: 3,
      failed: 0,
      deadLettered: 0,
    });
    expect(event.name).toBe("outbox.swept");
  });

  it("migrationApplied carries database/tag", () => {
    const event = migrationApplied(context, { database: "control", tag: "0001_x" });
    expect(event.name).toBe("migration.applied");
  });

  it("emailSent carries messageClass/outcome", () => {
    const event = emailSent(context, { messageClass: "password-reset", outcome: "sent" });
    expect(event.name).toBe("email.sent");
  });

  it("incidentCreated carries incidentId/errorIdCount", () => {
    const event = incidentCreated(context, { incidentId: "incident_1", errorIdCount: 2 });
    expect(event.name).toBe("incident.created");
  });

  it("authDenied carries cause/route/errorId — and has NO slot for a key (structural redaction)", () => {
    const event = authDenied(context, {
      cause: "mismatch",
      route: "/api/v1/firms",
      errorId: "error_1",
    });
    expect(event.name).toBe("auth.denied");
    expect(event.fields).toEqual({ cause: "mismatch", route: "/api/v1/firms", errorId: "error_1" });
  });

  it("operationFailed carries operation/errorName/messageHead/errorId (the background error counterpart)", () => {
    const event = operationFailed(context, {
      operation: "cron:per-firm-sweep",
      errorName: "Error",
      messageHead: "boom",
      errorId: "error_1",
    });
    expect(event.name).toBe("operation.failed");
    expect(event.fields.operation).toBe("cron:per-firm-sweep");
  });

  it("outboxDeadLettered carries scope/outboxId/topic/attempts", () => {
    const event = outboxDeadLettered(context, {
      scope: "control-plane",
      outboxId: "obx_1",
      topic: "member.provision",
      attempts: 5,
    });
    expect(event.name).toBe("outbox.deadLettered");
  });

  it("usageFeature carries exactly its allowlist and strips undeclared keys", () => {
    const event = usageFeature(
      { correlationId: "correlation_x", now: "2026-06-18T00:00:00.000Z" },
      {
        feature: "matters.list",
        phase: "reached",
        surface: null,
        firmIdHash: "abc123",
        userIdHash: null,
        appVersion: null,
      },
    );
    expect(event.name).toBe("usage.feature");
    expect(event.fields).toEqual({
      feature: "matters.list",
      phase: "reached",
      surface: null,
      firmIdHash: "abc123",
      userIdHash: null,
      appVersion: null,
    });
  });

  it("includes usage.feature in EVENT_NAMES exactly once", () => {
    const usageNames = EVENT_NAMES.filter((name) => name === "usage.feature");
    expect(usageNames).toHaveLength(1);
  });

  it("every catalog event name is unique", () => {
    expect(new Set(EVENT_NAMES).size).toBe(EVENT_NAMES.length);
  });
});
