import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { usageReachedMiddleware } from "../../src/usage/reached-middleware.ts";

function harness(opts: {
  setContext: boolean;
  route: string;
  logger: { log: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
}) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("correlationId", "correlation_x" as never);
    c.set("logger", opts.logger as never);
    if (opts.setContext) {
      c.set("chokepointFirmId", "firm_a" as never);
      c.set("chokepointFirmContext", { firmDatabase: {}, firmName: "Firm A", bucketName: null } as never);
      c.set("chokepointUserId", "user_a" as never);
    }
    await next();
  });
  app.use(
    "*",
    usageReachedMiddleware({
      pepperFor: () => "pepper",
      consent: { resolve: async () => true },
      now: () => "2026-06-18T00:00:00.000Z",
    }),
  );
  app.get(opts.route, (c) => c.text("ok"));
  return app;
}

describe("usageReachedMiddleware", () => {
  it("emits a reached event for a mapped route with chokepoint context", async () => {
    const logger = { log: vi.fn(), count: vi.fn() };
    await harness({ setContext: true, route: "/api/v1/matters", logger }).request("/api/v1/matters");
    expect(logger.log).toHaveBeenCalledOnce();
    expect(logger.log.mock.calls[0][0].fields.feature).toBe("matters.list");
    expect(logger.log.mock.calls[0][0].fields.phase).toBe("reached");
  });
  it("emits nothing for an unmapped route", async () => {
    const logger = { log: vi.fn(), count: vi.fn() };
    await harness({ setContext: true, route: "/api/v1/whatever", logger }).request("/api/v1/whatever");
    expect(logger.log).not.toHaveBeenCalled();
  });
  it("emits nothing when chokepoint context is absent (public/401)", async () => {
    const logger = { log: vi.fn(), count: vi.fn() };
    await harness({ setContext: false, route: "/api/v1/matters", logger }).request("/api/v1/matters");
    expect(logger.log).not.toHaveBeenCalled();
  });
});
