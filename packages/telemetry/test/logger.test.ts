import { describe, expect, it } from "vitest";
import { requestCompleted } from "../src/events.ts";
import { createMemoryLogger } from "../src/logger.ts";

const context = { correlationId: "cor_abc", now: "2026-06-13T00:00:00.000Z" };

describe("createMemoryLogger — the test adapter", () => {
  it("records logged events in order", () => {
    const logger = createMemoryLogger();
    logger.log(
      requestCompleted(context, { route: "/x", method: "GET", status: 200, durationMs: 1 }),
    );
    logger.log(
      requestCompleted(context, { route: "/y", method: "GET", status: 404, durationMs: 2 }),
    );
    expect(logger.events.map((e) => e.fields.route)).toEqual(["/x", "/y"]);
  });

  it("records counts with metric, dimensions, and value", () => {
    const logger = createMemoryLogger();
    logger.count("requests", { route: "/x", status: "200" });
    logger.count("errors", { route: "/y" }, 3);
    expect(logger.counts).toEqual([
      { metric: "requests", dimensions: { route: "/x", status: "200" }, value: 1 },
      { metric: "errors", dimensions: { route: "/y" }, value: 3 },
    ]);
  });
});
