import { describe, expect, it } from "vitest";
import { errorCaptured, requestCompleted } from "../src/events.ts";
import { createWorkersLogger, type AnalyticsEngineDataset } from "../src/workers-logger.ts";

const context = { correlationId: "correlation_abc", now: "2026-06-13T00:00:00.000Z" };

// A recording sink — typed string[] so indexed access stays type-safe under noUncheckedIndexedAccess.
function recordingEmit() {
  const lines: string[] = [];
  return { emit: (line: string) => void lines.push(line), lines };
}

function fakeAnalyticsEngine() {
  const points: Array<{ blobs?: string[]; doubles?: number[]; indexes?: string[] }> = [];
  const dataset: AnalyticsEngineDataset = {
    writeDataPoint: (point) => void points.push(point),
  };
  return { dataset, points };
}

describe("createWorkersLogger — the one console.* site", () => {
  it("emits one JSON line per event through the injected sink", () => {
    const { emit, lines } = recordingEmit();
    const logger = createWorkersLogger(undefined, emit);
    logger.log(
      requestCompleted(context, { route: "/x", method: "GET", status: 200, durationMs: 1 }),
    );
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      name: "request.completed",
      correlationId: "correlation_abc",
      fields: { route: "/x", status: 200 },
    });
  });

  it("SCRUBS the event before emitting (the backstop runs on the way out)", () => {
    const { emit, lines } = recordingEmit();
    const logger = createWorkersLogger(undefined, emit);
    logger.log(
      errorCaptured(context, {
        errorId: "error_1",
        route: "/x",
        method: "POST",
        errorName: "Error",
        messageHead: "mailto leak@example.com here",
      }),
    );
    const line = lines[0] ?? "";
    expect(line).toContain("[scrubbed]");
    expect(line).not.toContain("leak@example.com");
  });

  it("counts a telemetry.scrubbed metric per trip when an Analytics Engine is supplied", () => {
    const { dataset, points } = fakeAnalyticsEngine();
    const { emit } = recordingEmit();
    const logger = createWorkersLogger(dataset, emit);
    logger.log(
      errorCaptured(context, {
        errorId: "error_1",
        route: "/x",
        method: "POST",
        errorName: "Error",
        messageHead: "leak@example.com",
      }),
    );
    const scrubPoints = points.filter((p) => p.indexes?.[0] === "telemetry.scrubbed");
    expect(scrubPoints).toHaveLength(1);
    expect(scrubPoints[0]?.blobs).toContain("messageHead");
  });

  it("does not throw when no Analytics Engine binding is supplied (degrades silently)", () => {
    const { emit } = recordingEmit();
    const logger = createWorkersLogger(undefined, emit);
    expect(() => logger.count("requests", { route: "/x" })).not.toThrow();
  });

  it("writes a counter to the Analytics Engine with metric as blob and index", () => {
    const { dataset, points } = fakeAnalyticsEngine();
    const { emit } = recordingEmit();
    const logger = createWorkersLogger(dataset, emit);
    logger.count("requests", { route: "/x", status: "200" }, 1);
    const requestPoints = points.filter((p) => p.indexes?.[0] === "requests");
    expect(requestPoints).toHaveLength(1);
    expect(requestPoints[0]?.blobs).toEqual(["requests", "/x", "200"]);
    expect(requestPoints[0]?.doubles).toEqual([1]);
  });
});
