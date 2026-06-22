import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { usageReachedMiddleware } from "../../src/usage/reached-middleware.ts";

function harness(opts: {
  setContext: boolean;
  route: string;
  log: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
}) {
  // The app is untyped so test-harness context-stashing is unchecked; the middleware under test
  // reads these via its own typed accessors and the assertions validate the right values reach it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = new Hono() as any;
  app.use("*", async (c: any, next: () => Promise<void>) => {
    c.set("correlationId", "correlation_x");
    c.set("logger", { log: opts.log, count: opts.count });
    if (opts.setContext) {
      c.set("chokepointFirmId", "firm_a");
      c.set("chokepointFirmContext", {
        firmDatabase: {},
        firmName: "Firm A",
        bucketName: null,
      });
      c.set("chokepointUserId", "user_a");
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
  app.get(opts.route, (c: { text: (body: string) => Response }) => c.text("ok"));
  return app;
}

describe("usageReachedMiddleware", () => {
  it("emits a reached event for a mapped route with chokepoint context", async () => {
    const log = vi.fn();
    const count = vi.fn();
    await harness({ setContext: true, route: "/api/v1/matters", log, count }).request(
      "/api/v1/matters",
    );
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]![0].fields.feature).toBe("matters.list");
    expect(log.mock.calls[0]![0].fields.phase).toBe("reached");
  });
  it("emits nothing for an unmapped route", async () => {
    const log = vi.fn();
    const count = vi.fn();
    await harness({ setContext: true, route: "/api/v1/whatever", log, count }).request(
      "/api/v1/whatever",
    );
    expect(log).not.toHaveBeenCalled();
  });
  it("emits nothing when chokepoint context is absent (public/401)", async () => {
    const log = vi.fn();
    const count = vi.fn();
    await harness({ setContext: false, route: "/api/v1/matters", log, count }).request(
      "/api/v1/matters",
    );
    expect(log).not.toHaveBeenCalled();
  });
});
