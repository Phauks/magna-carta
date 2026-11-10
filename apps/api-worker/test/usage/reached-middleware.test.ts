// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { usageReachedMiddleware } from "../../src/http/usage-reached-middleware.ts";

// The middleware emits AFTER the response is committed and off the response path, so the harness
// supplies an execution context that records the scheduled work and awaits it before asserting —
// exactly what the runtime does with waitUntil.
function harness(opts: {
  setContext: boolean;
  route: string;
  log: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  resolveConsent?: () => Promise<boolean>;
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
      consent: { resolve: opts.resolveConsent ?? (async () => true) },
      now: () => "2026-06-18T00:00:00.000Z",
    }),
  );
  app.get(opts.route, (c: { text: (body: string) => Response }) => c.text("ok"));

  const scheduled: Promise<unknown>[] = [];
  const executionContext = {
    waitUntil: (work: Promise<unknown>) => {
      scheduled.push(work);
    },
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  return {
    async request(path: string): Promise<Response> {
      const response = (await app.request(path, undefined, {}, executionContext)) as Response;
      await Promise.all(scheduled);
      return response;
    },
  };
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
  it("a failing consent read leaves the committed response intact and reports the failure", async () => {
    const log = vi.fn();
    const count = vi.fn();
    const response = await harness({
      setContext: true,
      route: "/api/v1/matters",
      log,
      count,
      resolveConsent: async () => {
        throw new Error("consent read failed");
      },
    }).request("/api/v1/matters");
    // The handler already produced its 200 — telemetry cannot downgrade it to a 500.
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    // The failure is reported through the standard background-failure pipeline, not thrown.
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]![0].name).toBe("operation.failed");
    expect(log.mock.calls[0]![0].fields.operation).toBe("usage-reached");
    expect(count).not.toHaveBeenCalled();
  });
});
