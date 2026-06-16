import { describe, expect, it } from "vitest";
import { createMemoryLogger } from "../src/logger.ts";
import { logOperationFailed, MESSAGE_HEAD_LENGTH } from "../src/operation.ts";

describe("logOperationFailed — the one background-failure emitter", () => {
  it("logs an operation.failed event with the operation label, error name, message head, and an error_ id", () => {
    const logger = createMemoryLogger();
    logOperationFailed(logger, "cron:per-firm-sweep", new TypeError("boom"));
    const event = logger.events.find((e) => e.name === "operation.failed");
    expect(event?.fields.operation).toBe("cron:per-firm-sweep");
    expect(event?.fields.errorName).toBe("TypeError");
    expect(event?.fields.messageHead).toBe("boom");
    expect(String(event?.fields.errorId)).toMatch(/^error_/);
    expect(event?.correlationId).toMatch(/^correlation_/);
  });

  it("coerces a non-Error throw and caps the message head at MESSAGE_HEAD_LENGTH", () => {
    const logger = createMemoryLogger();
    const long = "x".repeat(500);
    logOperationFailed(logger, "op", long);
    const event = logger.events.find((e) => e.name === "operation.failed");
    expect(event?.fields.errorName).toBe("Error");
    expect(String(event?.fields.messageHead)).toHaveLength(MESSAGE_HEAD_LENGTH);
  });

  it("uses a supplied correlation id when given (a cron pass groups its events)", () => {
    const logger = createMemoryLogger();
    logOperationFailed(logger, "op", new Error("x"), "correlation_passScoped00000000");
    const event = logger.events.find((e) => e.name === "operation.failed");
    expect(event?.correlationId).toBe("correlation_passScoped00000000");
  });
});
