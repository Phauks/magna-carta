import { env } from "cloudflare:test";
import { createMemoryLogger, type MemoryLogger } from "@magna-carta/telemetry/logger";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";

// A deterministic epoch-ms clock: each read advances 5ms, so a request's duration is exactly 5.
function steppingClock(startMs = 1_700_000_000_000) {
  let t = startMs;
  return () => (t += 5);
}

// Build the app with an injected memory logger (so emitted events are directly inspectable) and the
// telemetry probe routes mounted. app.request(..., env) backs it with the real Miniflare bindings.
function appWithMemoryLogger(): { app: ReturnType<typeof createApp>; logger: MemoryLogger } {
  const logger = createMemoryLogger();
  const app = createApp({
    loggerForEnv: () => logger,
    clock: steppingClock(),
    includeTelemetryProbes: true,
  });
  return { app, logger };
}

describe("telemetry middleware (slice 0·6 spec §2)", () => {
  it("logs request.completed with a cor_ correlation id, the route TEMPLATE, status, and duration", async () => {
    const { app, logger } = appWithMemoryLogger();
    const response = await app.request(
      "https://example.com/api/v1/__telemetry-probe/abc123",
      {},
      env,
    );
    expect(response.status).toBe(200);

    const completed = logger.events.find((event) => event.name === "request.completed");
    expect(completed).toBeDefined();
    expect(completed?.correlationId).toMatch(/^cor_/);
    // The TEMPLATE, never the concrete id (decided #2): :probeId, not abc123.
    expect(completed?.fields.route).toBe("/api/v1/__telemetry-probe/:probeId");
    expect(completed?.fields.method).toBe("GET");
    expect(completed?.fields.status).toBe(200);
    expect(completed?.fields.durationMs).toBe(5);
  });

  it("turns an escaped exception into a 500 problem whose errorId equals the error.captured event's", async () => {
    const { app, logger } = appWithMemoryLogger();
    const response = await app.request("https://example.com/api/v1/__telemetry-throw", {}, env);
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/problem+json");

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "https://api.magnacarta.esq/problems/internal",
      title: "Internal server error",
      status: 500,
    });
    expect(body["errorId"]).toMatch(/^err_/);
    expect(body["correlationId"]).toMatch(/^cor_/);

    const captured = logger.events.find((event) => event.name === "error.captured");
    expect(captured).toBeDefined();
    // The 500 the client sees and the logged event join on the SAME Error ID (the correlation story).
    expect(captured?.fields.errorId).toBe(body["errorId"]);
    // And on the same correlation id.
    expect(captured?.correlationId).toBe(body["correlationId"]);
    expect(captured?.fields.errorName).toBe("Error");
    // messageHead is the raw head here (the WorkersLogger is what scrubs on the way out — that
    // backstop is proven in packages/telemetry workers-logger.test.ts).
    expect(String(captured?.fields.messageHead)).toContain("telemetry probe boom");
  });

  it("did not emit request.completed for the thrown request (error.captured is its terminal event)", async () => {
    const { app, logger } = appWithMemoryLogger();
    await app.request("https://example.com/api/v1/__telemetry-throw", {}, env);
    expect(logger.events.some((event) => event.name === "request.completed")).toBe(false);
    expect(logger.events.some((event) => event.name === "error.captured")).toBe(true);
  });
});
