import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

// The Worker's runtime bindings, declared once here (the no-barrel single home for the app's env shape).
// worker-env.d.ts mirrors this into the ambient `Cloudflare.Env` the vitest-pool-workers harness types `env` as.
export type Bindings = {
  ASSETS: Fetcher;
  DB_CONTROL: D1Database;
  R2: R2Bucket;
  QUEUE: Queue;
  // "development" enables the dev-only response validator (chokepoint/response-validator.ts);
  // unset in production (wrangler.jsonc declares no var), set locally via .dev.vars when the
  // validator is wired into route registration (slice 0·5 Task 8).
  ENVIRONMENT?: string;
};

const Health = z
  .object({ status: z.literal("ok"), version: z.string(), time: z.string() })
  .openapi("Health");

const healthRoute = createRoute({
  method: "get",
  path: "/api/health",
  responses: {
    200: {
      description: "Service health",
      content: { "application/json": { schema: Health } },
    },
  },
});

export function createApp() {
  const app = new OpenAPIHono<{ Bindings: Bindings }>();

  app.openapi(healthRoute, async (c) => {
    // Prove the control-plane D1 binding works end-to-end (the walking-skeleton's round trip).
    await c.env.DB_CONTROL.prepare("SELECT 1").first();
    // Skeleton timestamp; Temporal.Instant adoption is a later slice.
    return c.json({ status: "ok" as const, version: "0.0.0", time: new Date().toISOString() }, 200);
  });

  app.doc31("/api/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Magna Carta API", version: "0.0.0" },
  });

  // Everything not handled above falls through to the static-asset SPA (Workers Static Assets binding).
  app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

  return app;
}
