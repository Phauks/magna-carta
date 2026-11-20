// The one fact a signed-out screen needs before it can show the bot check: the Turnstile site key.
//
// The site key is public by design (Cloudflare puts it in every page that renders the widget), so
// it is answered to anyone. It is served from here rather than baked into the web build because it
// lives in the Secrets Store beside its secret, and the pair has to switch on together: this route
// answers a key only when BOTH keys are set (human-verification-wiring.ts), which is the same rule
// that switches the server-side check on. A screen that is handed `null` renders no widget, and a
// server with no pair asks for no solution, so the two halves can never disagree.

import { z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Bindings } from "../../../bindings.ts";
import type { Chokepoint } from "../../chokepoint/chokepoint.ts";
import type { AppVariables } from "../../chokepoint/ports.ts";
import { chokepointMiddleware } from "../../chokepoint/register.ts";
import { Problem } from "../../contracts/problem.ts";
import { defineOpenAPIRoute, type RouteMeta } from "../../contracts/route-meta.ts";
import { resolveTurnstileKeys } from "../../human-verification/human-verification-wiring.ts";

const HumanVerificationSettings = z
  .object({
    siteKey: z.string().nullable().openapi({
      description:
        "The Cloudflare Turnstile site key the browser renders the widget with, or null when the bot check is not set up and no widget should be shown.",
    }),
  })
  .openapi("HumanVerificationSettings");

export const humanVerificationSettingsMeta: RouteMeta = {
  operationId: "humanVerification.settings",
  // Read before anybody has a session: the sign-in, registration and invitation screens ask it.
  surface: "public",
  authenticated: false,
  permission: null,
  resource: "firm",
  audited: false,
  idempotency: "optional",
  rateLimit: "default",
};

export const humanVerificationSettingsRoute = defineOpenAPIRoute(humanVerificationSettingsMeta, {
  method: "get",
  path: "/api/v1/human-verification",
  description:
    "The public Turnstile site key the signed-out screens render the bot check with. Null while the bot check is not set up.",
  responses: {
    200: {
      description: "The site key, or null",
      content: { "application/json": { schema: HumanVerificationSettings } },
    },
    429: {
      description: "Rate limit exceeded",
      content: { "application/problem+json": { schema: Problem } },
    },
  },
});

export function registerHumanVerificationSettingsRoute(
  app: OpenAPIHono<{ Bindings: Bindings; Variables: AppVariables }>,
  chokepoint: Chokepoint,
): void {
  app.openapi(
    {
      ...humanVerificationSettingsRoute,
      middleware: chokepointMiddleware(chokepoint, humanVerificationSettingsRoute),
    },
    (c) => {
      const keys = resolveTurnstileKeys(c.env);
      // A short public cache: the key changes only when the owner replaces the widget, and every
      // signed-out page load asks for it.
      c.header("cache-control", "public, max-age=300");
      return c.json({ siteKey: keys?.siteKey ?? null }, 200);
    },
  );
}
