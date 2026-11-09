// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@magna-carta/telemetry/logger";
import { maybeEmitCompleted } from "../../src/usage/completed.ts";

const base = {
  pepper: "pepper",
  correlationId: "correlation_x",
  now: "2026-06-18T00:00:00.000Z",
  firmId: "firm_a",
  consented: true,
};

describe("maybeEmitCompleted", () => {
  it("emits a firm-level completed event for a mapped topic", async () => {
    const log = vi.fn();
    const count = vi.fn();
    const logger = { log, count } as unknown as Logger;
    await maybeEmitCompleted({
      ...base,
      logger,
      topic: "matter.closed",
    });
    expect(log).toHaveBeenCalledOnce();
    expect(count).toHaveBeenCalledOnce();
    const event = log.mock.calls[0]![0];
    expect(event.fields.feature).toBe("matters.detail");
    expect(event.fields.phase).toBe("completed");
    expect(event.fields.userIdHash).toBeNull();
    expect(event.fields.firmIdHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("emits nothing for an unmapped topic", async () => {
    const log = vi.fn();
    const count = vi.fn();
    const logger = { log, count } as unknown as Logger;
    await maybeEmitCompleted({
      ...base,
      logger,
      topic: "nothing.here",
    });
    expect(log).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });
  it("emits nothing when usage analytics is disabled (not consented)", async () => {
    const log = vi.fn();
    const count = vi.fn();
    const logger = { log, count } as unknown as Logger;
    await maybeEmitCompleted({
      ...base,
      consented: false,
      logger,
      topic: "matter.closed",
    });
    expect(log).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });
});
