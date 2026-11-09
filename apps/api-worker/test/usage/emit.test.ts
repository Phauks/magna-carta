// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@magna-carta/telemetry/logger";
import { emitUsage } from "../../src/usage/emit.ts";

const baseParams = {
  pepper: "pepper",
  correlationId: "correlation_x",
  now: "2026-06-18T00:00:00.000Z",
  feature: "matters.list" as const,
  phase: "reached" as const,
  surface: null,
  appVersion: null,
  firmId: "firm_a",
  userId: "user_a",
};

describe("emitUsage", () => {
  it("logs the event and counts the metric when consented", async () => {
    const log = vi.fn();
    const count = vi.fn();
    const logger = { log, count } as unknown as Logger;
    await emitUsage({ ...baseParams, logger, consented: true });
    expect(log).toHaveBeenCalledOnce();
    expect(count).toHaveBeenCalledWith("usage", {
      feature: "matters.list",
      phase: "reached",
      surface: "none",
    });
    const event = log.mock.calls[0]![0];
    expect(event.fields.firmIdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(event.fields.userIdHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("emits nothing when not consented", async () => {
    const log = vi.fn();
    const count = vi.fn();
    const logger = { log, count } as unknown as Logger;
    await emitUsage({ ...baseParams, logger, consented: false });
    expect(log).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });
  it("fails closed when the pepper is missing (no event)", async () => {
    const log = vi.fn();
    const count = vi.fn();
    const logger = { log, count } as unknown as Logger;
    await emitUsage({ ...baseParams, pepper: undefined, logger, consented: true });
    expect(log).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });
  it("passes a null userId through as a null hash (firm-level completed)", async () => {
    const log = vi.fn();
    const count = vi.fn();
    const logger = { log, count } as unknown as Logger;
    await emitUsage({ ...baseParams, phase: "completed", userId: null, logger, consented: true });
    const event = log.mock.calls[0]![0];
    expect(event.fields.userIdHash).toBeNull();
    expect(count).toHaveBeenCalledOnce();
  });
});
