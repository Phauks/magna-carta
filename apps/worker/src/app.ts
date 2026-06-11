import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { createAuth } from "./auth.ts";
import { createLoggingEmailAdapter } from "./email-port.ts";

// The Worker's runtime bindings, declared once here (the no-barrel single home for the app's env shape).
// worker-env.d.ts mirrors this into the ambient `Cloudflare.Env` the vitest-pool-workers harness types `env` as.
export type Bindings = {
  ASSETS: Fetcher;
  DB_CONTROL: D1Database;
  R2: R2Bucket;
  QUEUE: Queue;
  // Better Auth's signing/encryption secret. Local dev + tests load it from .dev.vars;
  // production sets it with `wrangler secret put AUTH_SECRET`.
  AUTH_SECRET: string;
};

// One Better Auth instance per worker env: the env object is stable across requests within an
// isolate, so a WeakMap-keyed cache builds the auth context once instead of on every request.
// The dev logging email adapter is wired here for now; slice 0·6 swaps in real transactional
// email behind the same SendEmail port.
const authInstanceByEnv = new WeakMap<Bindings, ReturnType<typeof createAuth>>();

function authForEnv(env: Bindings): ReturnType<typeof createAuth> {
  let auth = authInstanceByEnv.get(env);
  if (auth === undefined) {
    auth = createAuth(env, createLoggingEmailAdapter());
    authInstanceByEnv.set(env, auth);
  }
  return auth;
}

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

  // Better Auth owns everything under its default basePath, /api/auth/* — its router serves
  // only GET and POST. Registered before the catch-all asset fallthrough.
  app.on(["GET", "POST"], "/api/auth/*", (c) => authForEnv(c.env).handler(c.req.raw));

  app.doc31("/api/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Magna Carta API", version: "0.0.0" },
  });

  // Everything not handled above falls through to the static-asset SPA (Workers Static Assets binding).
  app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

  return app;
}
