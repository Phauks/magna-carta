import { describe, expect, it } from "vitest";
import { UNLOGGABLE_VALUE } from "../src/event.ts";
import { errorCaptured, ingestVerdict, requestCompleted } from "../src/events.ts";
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

// Every point written under one metric name, in write order.
function pointsFor(
  points: Array<{ blobs?: string[]; doubles?: number[]; indexes?: string[] }>,
  metric: string,
) {
  return points.filter((point) => point.indexes?.[0] === metric);
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
    const scrubPoints = pointsFor(points, "telemetry.scrubbed");
    expect(scrubPoints).toHaveLength(1);
    expect(scrubPoints[0]?.blobs).toEqual(["telemetry.scrubbed", "error.captured", "messageHead"]);
  });

  it("does not throw when no Analytics Engine binding is supplied (degrades silently)", () => {
    const { emit } = recordingEmit();
    const logger = createWorkersLogger(undefined, emit);
    expect(() => logger.count("usage", { feature: "matters.create" })).not.toThrow();
  });

  it("writes a counter to the Analytics Engine with metric as blob and index", () => {
    const { dataset, points } = fakeAnalyticsEngine();
    const { emit } = recordingEmit();
    const logger = createWorkersLogger(dataset, emit);
    logger.count("usage", { feature: "matters.create", phase: "reached", surface: "web" }, 1);
    const usagePoints = pointsFor(points, "usage");
    expect(usagePoints).toHaveLength(1);
    expect(usagePoints[0]?.blobs).toEqual(["usage", "matters.create", "reached", "web"]);
    expect(usagePoints[0]?.doubles).toEqual([1]);
  });
});

// The counter path is an allowlist too: a metric is declared in metrics.ts with its ORDERED
// dimension keys, and the blob layout is read from that declaration rather than from whatever order
// the call site wrote its object literal in.
describe("createWorkersLogger — the counter emission path is guarded", () => {
  it("lays blobs out in DECLARED key order, not the caller's object-literal order", () => {
    const { dataset, points } = fakeAnalyticsEngine();
    const logger = createWorkersLogger(dataset, recordingEmit().emit);
    // Same three dimensions, written in a deliberately scrambled order.
    logger.count("usage", { surface: "portal", feature: "matters.create", phase: "completed" });
    expect(pointsFor(points, "usage")[0]?.blobs).toEqual([
      "usage",
      "matters.create",
      "completed",
      "portal",
    ]);
  });

  it("gives a declared dimension the caller omitted an empty column, keeping row width fixed", () => {
    const { dataset, points } = fakeAnalyticsEngine();
    const logger = createWorkersLogger(dataset, recordingEmit().emit);
    logger.count("usage", { feature: "matters.create", phase: "reached" });
    expect(pointsFor(points, "usage")[0]?.blobs).toEqual([
      "usage",
      "matters.create",
      "reached",
      "",
    ]);
  });

  it("SCRUBS a dimension value and raises the metric-scrub tripwire", () => {
    const { dataset, points } = fakeAnalyticsEngine();
    const logger = createWorkersLogger(dataset, recordingEmit().emit);
    // A queue message's topic reaches this dimension verbatim — the unguarded path's real exposure.
    logger.count("costs.recovery.unhandled_topic", { topic: "client jane@example.com asked" });

    const written = pointsFor(points, "costs.recovery.unhandled_topic")[0];
    expect(written?.blobs?.[1]).toBe("client [scrubbed] asked");
    expect(written?.blobs?.[1]).not.toContain("jane@example.com");

    const tripwire = pointsFor(points, "telemetry.metric_scrubbed")[0];
    expect(tripwire?.blobs).toEqual([
      "telemetry.metric_scrubbed",
      "costs.recovery.unhandled_topic",
      "topic",
    ]);
  });

  it("scrubs a separated card number in a dimension value (the shape a person types)", () => {
    const { dataset, points } = fakeAnalyticsEngine();
    const logger = createWorkersLogger(dataset, recordingEmit().emit);
    logger.count("costs.recovery.rejected", { code: "card 4111 1111 1111 1111 declined" });
    expect(pointsFor(points, "costs.recovery.rejected")[0]?.blobs?.[1]).toBe(
      "card [scrubbed] declined",
    );
  });

  it("DROPS an undeclared metric and raises the undeclared tripwire instead", () => {
    const { dataset, points } = fakeAnalyticsEngine();
    const logger = createWorkersLogger(dataset, recordingEmit().emit);
    logger.count("not.declared.anywhere", { anything: "goes" });

    expect(pointsFor(points, "not.declared.anywhere")).toEqual([]);
    expect(pointsFor(points, "telemetry.metric_undeclared")[0]?.blobs).toEqual([
      "telemetry.metric_undeclared",
      "not.declared.anywhere",
      "",
    ]);
  });

  it("DROPS an undeclared dimension key while still writing the declared columns", () => {
    const { dataset, points } = fakeAnalyticsEngine();
    const logger = createWorkersLogger(dataset, recordingEmit().emit);
    logger.count("costs.recovery.rejected", {
      code: "amount_not_positive",
      matterId: "matter_V1StGXR8Z5jdHiopq2Cf",
    } as Record<string, string>);

    const written = pointsFor(points, "costs.recovery.rejected")[0];
    expect(written?.blobs).toEqual(["costs.recovery.rejected", "amount_not_positive"]);
    expect(JSON.stringify(written)).not.toContain("matter_V1StGXR8Z5jdHiopq2Cf");
    expect(pointsFor(points, "telemetry.metric_undeclared")[0]?.blobs).toEqual([
      "telemetry.metric_undeclared",
      "costs.recovery.rejected",
      "matterId",
    ]);
  });

  it("writes a dimension-free metric as a single-blob row", () => {
    const { dataset, points } = fakeAnalyticsEngine();
    const logger = createWorkersLogger(dataset, recordingEmit().emit);
    logger.count("reconciliation.unprovisioned", {}, 4);
    const written = pointsFor(points, "reconciliation.unprovisioned")[0];
    expect(written?.blobs).toEqual(["reconciliation.unprovisioned"]);
    expect(written?.doubles).toEqual([4]);
  });

  it("does not recurse: a tripwire whose own dimension trips raises no further tripwire", () => {
    const { dataset, points } = fakeAnalyticsEngine();
    const logger = createWorkersLogger(dataset, recordingEmit().emit);
    // Both the value AND the dimension key are undeclared/dirty, so every tripwire arm is exercised
    // at once. Terminating at all is the assertion; the counts pin it to one level.
    logger.count("costs.recovery.unhandled_topic", {
      topic: "555-123-4567",
      extra: "a@b.com",
    } as Record<string, string>);
    expect(pointsFor(points, "telemetry.metric_scrubbed")).toHaveLength(1);
    expect(pointsFor(points, "telemetry.metric_undeclared")).toHaveLength(1);
  });
});

// A declared field whose value was replaced because it was not a flat primitive. The replacement is
// the event builder's job (event.ts); the logger's job is to make it visible.
describe("createWorkersLogger — the unloggable-value tripwire", () => {
  it("never serialises a smuggled object into the log line", () => {
    const { emit, lines } = recordingEmit();
    const logger = createWorkersLogger(undefined, emit);
    logger.log(
      ingestVerdict(context, {
        outcome: "quarantine",
        scanVerdict: "infected",
        scanDetail: { fileName: "Smith v Jones settlement.pdf", signature: "Eicar-Test" },
        quarantineReason: "malware",
      } as unknown as Parameters<typeof ingestVerdict>[1]),
    );
    const line = lines[0] ?? "";
    expect(line).not.toContain("Smith v Jones");
    expect(line).not.toContain("Eicar-Test");
    expect(line).toContain(UNLOGGABLE_VALUE);
  });

  it("counts telemetry.unloggable naming the event and the offending field", () => {
    const { dataset, points } = fakeAnalyticsEngine();
    const logger = createWorkersLogger(dataset, recordingEmit().emit);
    logger.log(
      ingestVerdict(context, {
        outcome: "quarantine",
        scanVerdict: "infected",
        scanDetail: ["nested", "array"],
        quarantineReason: "malware",
      } as unknown as Parameters<typeof ingestVerdict>[1]),
    );
    expect(pointsFor(points, "telemetry.unloggable")[0]?.blobs).toEqual([
      "telemetry.unloggable",
      "ingest.verdict",
      "scanDetail",
    ]);
  });
});
