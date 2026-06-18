import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@magna-carta/telemetry/logger";
import { maybeEmitCompleted } from "../../src/usage/completed.ts";

function recordingLogger() {
  return { log: vi.fn(), count: vi.fn() };
}

const base = {
  pepper: "pepper",
  correlationId: "correlation_x",
  now: "2026-06-18T00:00:00.000Z",
  firmId: "firm_a",
  consented: true,
};

describe("maybeEmitCompleted", () => {
  it("emits a firm-level completed event for a mapped topic", async () => {
    const logger = recordingLogger();
    await maybeEmitCompleted({ ...base, logger: logger as unknown as Logger, topic: "matter.closed" });
    expect(logger.log).toHaveBeenCalledOnce();
    expect(logger.count).toHaveBeenCalledOnce();
    const event = logger.log.mock.calls[0][0];
    expect(event.fields.feature).toBe("matters.detail");
    expect(event.fields.phase).toBe("completed");
    expect(event.fields.userIdHash).toBeNull();
    expect(event.fields.firmIdHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("emits nothing for an unmapped topic", async () => {
    const logger = recordingLogger();
    await maybeEmitCompleted({ ...base, logger: logger as unknown as Logger, topic: "nothing.here" });
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.count).not.toHaveBeenCalled();
  });
  it("emits nothing when usage analytics is disabled (not consented)", async () => {
    const logger = recordingLogger();
    await maybeEmitCompleted({ ...base, consented: false, logger: logger as unknown as Logger, topic: "matter.closed" });
    expect(logger.log).not.toHaveBeenCalled();
  });
});
